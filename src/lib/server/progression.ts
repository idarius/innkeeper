import { and, eq, sql } from 'drizzle-orm';
import { botReady, listMembers } from './bot';
import { db, schema } from './db';
import { getRecruitment } from './settings';

const { users, characters } = schema;
const DAY = 86_400_000;
// Après « revu, on garde le rôle », le rappel revient au bout de 30 jours.
const SNOOZE_DAYS = 30;

/** Date d'arrivée retenue : arrivée enregistrée, sinon première connexion au site (approximative). */
const arrivalOf = (u: { joinedAt: Date | null; createdAt: Date }) => u.joinedAt ?? u.createdAt;

function isDue(u: { joinedAt: Date | null; createdAt: Date; reviewedAt: Date | null }, reviewDays: number, now = Date.now()) {
	if (arrivalOf(u).getTime() + reviewDays * DAY > now) return false;
	return !u.reviewedAt || u.reviewedAt.getTime() + SNOOZE_DAYS * DAY <= now;
}

function newcomersFromCache() {
	const { arrivalRoleId } = getRecruitment();
	if (!arrivalRoleId) return [];
	return db()
		.select()
		.from(users)
		.all()
		.filter((u) => u.roles.includes(arrivalRoleId));
}

/** Nombre de membres à revoir, pour le compteur du menu (sans appel à Discord). */
export function dueReviewCount() {
	const { reviewDays } = getRecruitment();
	return newcomersFromCache().filter((u) => isDue(u, reviewDays)).length;
}

/**
 * Membres portant le rôle d'arrivée, du plus ancien au plus récent. Avec le bot, leurs rôles
 * sont relus sur Discord : un membre promu entre-temps disparaît de la liste.
 */
export async function listNewcomers() {
	const { arrivalRoleId, reviewDays } = getRecruitment();
	let list = newcomersFromCache();

	if (arrivalRoleId && botReady() && list.length) {
		// Une seule liste des membres du serveur (une requête par tranche de 1000) plutôt
		// qu'un appel par nouveau membre : Discord freine les appels en rafale.
		const members = await listMembers().catch(() => null);
		if (members) {
			const rolesById = new Map(members.map((m) => [m.user.id, m.roles]));
			const refreshed = [];
			for (const u of list) {
				// Absent de la liste : il a quitté le serveur.
				const roles = rolesById.get(u.discordId) ?? [];
				db().update(users).set({ roles, inGuild: rolesById.has(u.discordId), rolesCheckedAt: new Date() }).where(eq(users.discordId, u.discordId)).run();
				if (roles.includes(arrivalRoleId)) refreshed.push({ ...u, roles });
			}
			list = refreshed;
		}
		// Discord indisponible : on garde le cache.
	}

	const now = Date.now();
	return list
		.map((u) => {
			const main = db()
				.select({ name: characters.name, class: characters.class, level: characters.level })
				.from(characters)
				.where(and(eq(characters.userId, u.discordId), eq(characters.isMain, true)))
				.get();
			const arrival = arrivalOf(u);
			// Dernière connexion en jeu, tous persos confondus (import de l'addon InnkeeperSync).
			const inGame = db()
				.select({ at: sql<number | null>`max(${characters.lastOnlineAt})` })
				.from(characters)
				.where(eq(characters.userId, u.discordId))
				.get()?.at;
			return {
				lastInGame: inGame ? new Date(inGame * 1000) : null,
				id: u.discordId,
				name: u.displayName,
				avatar: u.avatar,
				main,
				arrival,
				arrivalKnown: Boolean(u.joinedAt),
				days: Math.floor((now - arrival.getTime()) / DAY),
				due: isDue(u, reviewDays, now),
				reviewedAt: u.reviewedAt,
				reviewNote: u.reviewNote
			};
		})
		.sort((a, b) => a.arrival.getTime() - b.arrival.getTime());
}

export function markReviewed(userId: string, note: string | null) {
	db().update(users).set({ reviewedAt: new Date(), reviewNote: note }).where(eq(users.discordId, userId)).run();
}

export function setJoinedAt(userId: string, date: Date) {
	db().update(users).set({ joinedAt: date }).where(eq(users.discordId, userId)).run();
}
