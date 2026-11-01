import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { CLASSES } from '$lib/game/forever';
import { AXIS_LABELS, LEVEL_LABELS } from '$lib/interests';
import { ROLE_LABELS } from '$lib/roles';
import { addMember, addRole, botReady, BotError, createInvite, guildMember, postMessage, sendDirectMessage } from './bot';
import { createCharacter, type CharacterInput } from './characters';
import { db, schema } from './db';
import type { Application, CharacterDraft } from './db/schema';
import { getGuild, getRecruitment } from './settings';

const { applications, applicationVotes, users } = schema;

export type Voter = { id: string; name: string };

/** Identifiant de l'officier pour les votes et décisions : joueur Discord ou admin local. */
export function voterOf(locals: App.Locals): Voter | null {
	if (locals.admin) return { id: `admin:${locals.admin.id}`, name: locals.admin.username };
	if (locals.user?.permission === 'officer') return { id: locals.user.id, name: locals.user.displayName };
	return null;
}

export function latestApplication(userId: string) {
	return db().select().from(applications).where(eq(applications.userId, userId)).orderBy(desc(applications.id)).get();
}

/** Peut-on postuler ? Une candidature en cours ou un refus de moins de N jours l'empêchent. */
export function applyBlocker(userId: string): { reason: 'pending' | 'accepted' | 'cooldown'; until?: Date } | null {
	const last = latestApplication(userId);
	if (!last) return null;
	if (last.status === 'pending') return { reason: 'pending' };
	if (last.status === 'accepted') return { reason: 'accepted' };
	if (last.status === 'refused' && last.decidedAt) {
		const until = new Date(last.decidedAt.getTime() + getRecruitment().reapplyDays * 86_400_000);
		if (until > new Date()) return { reason: 'cooldown', until };
	}
	return null;
}

export function submitApplication(
	userId: string,
	character: CharacterDraft,
	answers: { question: string; answer: string }[],
	charterAcceptedAt: Date | null = null
) {
	const app = db().insert(applications).values({ userId, character, answers, charterAcceptedAt }).returning().get();
	void announce(app, 'new');
	return app;
}

/**
 * Pose l'issue d'une candidature encore en attente. Renvoie false si elle a déjà été tranchée
 * (deux officiers qui valident en même temps, double clic, retrait du candidat) : rien ne change.
 */
function decide(app: Application, values: Partial<Application> & { status: Exclude<Application['status'], 'pending'> }) {
	return (
		db()
			.update(applications)
			.set({ decidedAt: new Date(), ...values })
			.where(and(eq(applications.id, app.id), eq(applications.status, 'pending')))
			.run().changes > 0
	);
}

export function withdrawApplication(app: Application) {
	return decide(app, { status: 'withdrawn' });
}

export function getApplication(id: number) {
	return db().select().from(applications).where(eq(applications.id, id)).get();
}

export function votesFor(applicationId: number) {
	return db().select().from(applicationVotes).where(eq(applicationVotes.applicationId, applicationId)).all();
}

/** Liste pour les officiers, avec le candidat et le décompte des avis. */
export function listApplications(statuses: Application['status'][]) {
	const rows = db()
		.select({ app: applications, name: users.displayName, avatar: users.avatar })
		.from(applications)
		.innerJoin(users, eq(users.discordId, applications.userId))
		.where(inArray(applications.status, statuses))
		.orderBy(desc(applications.id))
		.all();
	const tally = new Map(
		db()
			.select({
				id: applicationVotes.applicationId,
				up: sql<number>`sum(case when ${applicationVotes.value} > 0 then 1 else 0 end)`,
				down: sql<number>`sum(case when ${applicationVotes.value} < 0 then 1 else 0 end)`
			})
			.from(applicationVotes)
			.groupBy(applicationVotes.applicationId)
			.all()
			.map((t) => [t.id, t])
	);
	return rows.map((r) => ({ ...r, up: tally.get(r.app.id)?.up ?? 0, down: tally.get(r.app.id)?.down ?? 0 }));
}

export const pendingCount = () =>
	db().select({ n: sql<number>`count(*)` }).from(applications).where(eq(applications.status, 'pending')).get()?.n ?? 0;

export function vote(app: Application, voter: Voter, value: 1 | -1, comment: string | null) {
	const values = { voterName: voter.name, value, comment, createdAt: new Date() };
	db()
		.insert(applicationVotes)
		.values({ applicationId: app.id, voterId: voter.id, ...values })
		.onConflictDoUpdate({ target: [applicationVotes.applicationId, applicationVotes.voterId], set: values })
		.run();
}

export const removeVote = (app: Application, voter: Voter) =>
	db()
		.delete(applicationVotes)
		.where(and(eq(applicationVotes.applicationId, app.id), eq(applicationVotes.voterId, voter.id)))
		.run();

/**
 * Acceptation : le perso de la candidature rejoint la guilde, puis le bot fait entrer la recrue.
 * Renvoie null si la candidature n'était plus en attente.
 */
export async function acceptApplication(app: Application, voter: Voter, message: string | null) {
	if (!decide(app, { status: 'accepted', decidedBy: voter.name, decisionMessage: message })) return null;
	// Premier perso du joueur : il devient son main automatiquement.
	createCharacter(app.userId, { ...(app.character as CharacterInput), isMain: false });
	const accepted = getApplication(app.id)!;
	const arrivalError = await ensureArrival(accepted);
	void announce(accepted, 'accepted');
	void notifyCandidate(accepted);
	return { arrivalError };
}

/** Refus ; renvoie false si la candidature n'était plus en attente. */
export function refuseApplication(app: Application, voter: Voter, message: string | null) {
	if (!decide(app, { status: 'refused', decidedBy: voter.name, decisionMessage: message })) return false;
	const refused = getApplication(app.id)!;
	void announce(refused, 'refused');
	void notifyCandidate(refused);
	return true;
}

/**
 * Rôle d'arrivée d'une recrue acceptée qui est déjà sur le serveur. Sinon, elle y entre
 * par le bouton de sa page (joinWithToken). Rappelée quand le candidat revient sur le
 * site, jusqu'à ce que le rôle soit attribué. Renvoie un message d'erreur, ou null.
 */
export async function ensureArrival(app: Application): Promise<string | null> {
	if (app.status !== 'accepted' || app.roleAssignedAt) return null;
	const settings = getRecruitment();
	if (!botReady()) return 'Le bot n’est pas configuré : la recrue n’a pas pu recevoir son rôle.';
	if (!settings.arrivalRoleId) return 'Aucun rôle d’arrivée n’est choisi (Admin → Recrutement).';
	try {
		const member = await guildMember(app.userId);
		if (member) {
			await addRole(app.userId, settings.arrivalRoleId);
			markArrived(app, [...member.roles, settings.arrivalRoleId]);
		}
		return null;
	} catch (e) {
		return e instanceof BotError ? e.message : 'Discord ne répond pas, réessaie dans un instant.';
	}
}

/**
 * Entrée directe sur le serveur par le bot, avec le jeton `guilds.join` de la recrue :
 * pas d'invitation, donc pas de questionnaire d'entrée Discord, et le rôle d'arrivée
 * est posé dès l'entrée. Renvoie un message d'erreur, ou null si tout va bien.
 */
export async function joinWithToken(app: Application, accessToken: string): Promise<string | null> {
	if (app.status !== 'accepted' || app.roleAssignedAt) return null;
	const roleId = getRecruitment().arrivalRoleId;
	if (!botReady() || !roleId) return 'Le recrutement n’est pas encore configuré, un officier va s’en occuper.';
	try {
		const added = await addMember(app.userId, accessToken, [roleId]);
		// Déjà sur le serveur : Discord ignore les rôles demandés, on donne le rôle à part.
		if (!added) await addRole(app.userId, roleId);
		const member = await guildMember(app.userId);
		markArrived(app, [...(member?.roles ?? []), roleId]);
		return null;
	} catch (e) {
		await fallbackInvite(app);
		return e instanceof BotError ? e.message : 'Discord ne répond pas, réessaie dans un instant.';
	}
}

// Entrée directe impossible : invitation classique à usage unique, créée une seule fois.
async function fallbackInvite(app: Application) {
	const channelId = getRecruitment().inviteChannelId;
	if (app.inviteUrl || !channelId) return;
	try {
		const inviteUrl = await createInvite(channelId);
		db().update(applications).set({ inviteUrl }).where(eq(applications.id, app.id)).run();
	} catch (e) {
		console.error('Invitation de secours impossible :', e instanceof Error ? e.message : e);
	}
}

// Mise à jour immédiate du cache des rôles : l'accès au site s'ouvre sans reconnexion.
function markArrived(app: Application, memberRoles: string[]) {
	const user = db().select({ roles: users.roles }).from(users).where(eq(users.discordId, app.userId)).get();
	const roles = [...new Set([...(user?.roles ?? []), ...memberRoles])];
	db().update(users).set({ roles, inGuild: true, rolesCheckedAt: new Date(), joinedAt: new Date() }).where(eq(users.discordId, app.userId)).run();
	db().update(applications).set({ roleAssignedAt: new Date() }).where(eq(applications.id, app.id)).run();
}

/**
 * Prévient le candidat de la décision par MP du bot. Discord ne le permet que s'il est
 * déjà sur le serveur ; sinon, il la découvre sur sa page « Ma candidature ».
 */
async function notifyCandidate(app: Application) {
	if (!botReady()) return;
	const guild = getGuild()?.name ?? 'la guilde';
	const accepted = app.status === 'accepted';
	const lines = [
		accepted
			? `Bonne nouvelle : ta candidature pour **${guild}** est acceptée, bienvenue parmi nous !`
			: `Ta candidature pour **${guild}** n’a pas été retenue cette fois-ci.`,
		...(app.decisionMessage ? [`> ${app.decisionMessage.replace(/\n/g, '\n> ')}`] : []),
		...(accepted ? [] : [`Tu pourras postuler à nouveau dans ${getRecruitment().reapplyDays} jours.`]),
		`Détails : ${env.ORIGIN ?? ''}/candidature`
	];
	try {
		if (!(await guildMember(app.userId))) return;
		await sendDirectMessage(app.userId, { content: lines.join('\n\n') });
	} catch (e) {
		console.error('MP de décision impossible :', e instanceof Error ? e.message : e);
	}
}

// Annonces dans le salon des officiers. Une erreur Discord ne bloque jamais la candidature.
async function announce(app: Application, event: 'new' | 'accepted' | 'refused') {
	const settings = getRecruitment();
	if (!botReady() || !settings.notifyChannelId) return;
	const user = db().select({ name: users.displayName }).from(users).where(eq(users.discordId, app.userId)).get();
	const c = app.character;
	const gameClass = CLASSES.find((k) => k.id === c.class);
	const spec = gameClass?.specs.find((s) => s.id === c.spec)?.name;
	const interests = (['pve', 'pvp'] as const)
		.filter((axis) => c[axis])
		.map((axis) => `${AXIS_LABELS[axis]} ${LEVEL_LABELS[c[axis]!].toLowerCase()}`)
		.join(' · ');
	const url = `${env.ORIGIN ?? ''}/admin/candidatures/${app.id}`;
	const color = parseInt((getGuild()?.accentColor ?? '#b3261e').slice(1), 16);
	const titles = {
		new: `Nouvelle candidature : ${user?.name ?? c.name}`,
		accepted: `Candidature acceptée par ${app.decidedBy} : ${user?.name ?? c.name}`,
		refused: `Candidature refusée par ${app.decidedBy} : ${user?.name ?? c.name}`
	};
	try {
		await postMessage(settings.notifyChannelId, {
			content: event === 'new' && settings.mentionRoleId ? `<@&${settings.mentionRoleId}>` : undefined,
			embeds: [
				{
					title: titles[event],
					url,
					color,
					description: `${c.name} · ${gameClass?.name ?? c.class}${spec ? ` ${spec}` : ''} (${ROLE_LABELS[c.role!]}) · niveau ${c.level}`,
					fields:
						event === 'new'
							? [
									...(interests ? [{ name: 'Intérêts', value: interests }] : []),
									...app.answers.slice(0, 3).map((a) => ({ name: a.question.slice(0, 250), value: (a.answer || '—').slice(0, 300) }))
								]
							: []
				}
			]
		});
	} catch (e) {
		console.error('Annonce de candidature impossible :', e instanceof Error ? e.message : e);
	}
}
