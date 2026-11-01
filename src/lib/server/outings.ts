import { and, asc, count, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { getActivity, getInstance } from '$lib/activities';
import { RAID_HELPER } from '$lib/game/forever';
import { remember } from './bounded';
import { db, schema } from './db';
import { BotError, botReady, recentMessages, textChannels } from './bot';
import { permissionFor } from './permissions';
import { eventImage, fetchEvent, listUpcoming, RaidHelperError, type UpcomingEvent } from './raidhelper';
import { getDiscord, getRaidHelper } from './settings';

// Création de sorties : modèles préremplis et formulaire envoyé à Raid-Helper.

const { outingTemplates, outings, users } = schema;

export const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

const optionalId = z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : (v ?? null)), z.string().regex(/^\d{17,20}$/, 'Salon invalide').nullable());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:mm)');
const text = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v || null);

const activity = z.preprocess((v) => (typeof v === 'string' ? v || null : (v ?? null)), z.string().refine((v) => Boolean(getActivity(v)), 'Type de sortie inconnu').nullable());
const instanceId = z.preprocess((v) => (typeof v === 'string' ? v || null : (v ?? null)), z.string().refine((v) => Boolean(getInstance(v)), 'Instance inconnue').nullable());

/** L'instance doit correspondre au type (un donjon pour « Donjon », un raid pour « Raid »). */
const instanceMatches = (o: { activity: string | null; instanceId: string | null }) =>
	!o.instanceId || getActivity(o.activity)?.instances === getInstance(o.instanceId)?.kind;

export const templateSchema = z.object({
	name: z.string().trim().min(2, 'Nom trop court').max(60),
	activity,
	instanceId,
	title: z.string().trim().min(2, 'Titre trop court').max(100),
	description: text(1500),
	channelId: optionalId,
	weekday: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(7).nullable()),
	time: z.preprocess((v) => (v === '' || v == null ? null : v), time.nullable()),
	rosterId: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive().nullable())
}).refine(instanceMatches, 'Cette instance ne correspond pas au type de sortie');
export type TemplateInput = z.output<typeof templateSchema>;

export const listTemplates = () => db().select().from(outingTemplates).orderBy(asc(outingTemplates.name)).all();
export const getTemplate = (id: number) => db().select().from(outingTemplates).where(eq(outingTemplates.id, id)).get();
export const createTemplate = (values: TemplateInput) => Number(db().insert(outingTemplates).values(values).run().lastInsertRowid);
export const updateTemplate = (id: number, values: TemplateInput) => db().update(outingTemplates).set(values).where(eq(outingTemplates.id, id)).run();
export const deleteTemplate = (id: number) => db().delete(outingTemplates).where(eq(outingTemplates.id, id)).run();

export const outingSchema = z.object({
	activity,
	instanceId,
	title: z.string().trim().min(2, 'Titre trop court').max(100),
	description: z.string().trim().max(1500).default(''),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
	time,
	channelId: z.string().regex(/^\d{17,20}$/, 'Choisis un salon'),
	leaderId: z.string().regex(/^\d{17,20}$/, 'Choisis un chef de raid')
}).refine(instanceMatches, 'Cette instance ne correspond pas au type de sortie');

/**
 * Réglages Raid-Helper d'une sortie selon son type et son instance : nombre de places
 * (taille de l'instance), durée, image. Sans type, on laisse les réglages du serveur.
 * Pas d'événement Discord sauf demande (sorties officielles, réglage de la guilde).
 * Toujours sans police décorative : Raid-Helper ne l'applique qu'aux titres courts, ce
 * qui rend les sorties incohérentes entre elles.
 */
export function advancedSettings(activityId: string | null, instance: string | null, imageUrl: string | null, discordEvent = false) {
	const a = getActivity(activityId);
	const limit = getInstance(instance)?.size ?? a?.limit;
	return {
		font_style: 'none',
		// Événement Discord en plus de l'événement Raid-Helper : seulement si la guilde l'a choisi.
		create_discordevent: discordEvent,
		...(limit ? { limit } : {}),
		...(a ? { duration: a.duration } : {}),
		...(imageUrl ? { image: imageUrl } : {})
	};
}

/** Officiers connus du site, chefs de raid possibles (Raid-Helper exige un compte Discord). */
export function officers() {
	return db()
		.select({ id: users.discordId, name: users.displayName, roles: users.roles, inGuild: users.inGuild })
		.from(users)
		.orderBy(asc(users.displayName))
		.all()
		.filter((u) => permissionFor(u) === 'officer')
		.map(({ id, name }) => ({ id, name }));
}

/** Décalage (ms) du fuseau à un instant donné : heure locale affichée − UTC. */
function offset(instant: number, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
			.formatToParts(new Date(instant))
			.map((p) => [p.type, p.value])
	);
	return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
}

/** Timestamp Unix (s) d'une date AAAA-MM-JJ et d'une heure HH:mm lues dans le fuseau donné. */
export function zonedToUnix(date: string, hhmm: string, timeZone: string) {
	const [y, m, d] = date.split('-').map(Number);
	const [h, min] = hhmm.split(':').map(Number);
	const wall = Date.UTC(y, m - 1, d, h, min);
	// Deux passes : le décalage peut changer autour d'un passage à l'heure d'été.
	let utc = wall - offset(wall, timeZone);
	utc = wall - offset(utc, timeZone);
	return Math.floor(utc / 1000);
}

/** Timestamp Unix (s) → date AAAA-MM-JJ et heure HH:mm dans le fuseau donné. */
export function unixToZoned(unix: number, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
			.formatToParts(new Date(unix * 1000))
			.map((p) => [p.type, p.value])
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Modification d'une sortie existante : ni type ni salon (Raid-Helper ne change pas les places a posteriori ici). */
export const outingEditSchema = z.object({
	title: z.string().trim().min(2, 'Titre trop court').max(100),
	description: z.string().trim().max(1500).default(''),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
	time,
	leaderId: z.string().regex(/^\d{17,20}$/, 'Choisis un chef de raid')
});

/** Date du jour (AAAA-MM-JJ) dans le fuseau donné. */
export function today(timeZone: string, now = new Date()) {
	return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Prochaine date (aujourd'hui compris) tombant le jour de semaine donné (1 = lundi). */
export function nextWeekday(weekday: number, timeZone: string, now = new Date()) {
	const [y, m, d] = today(timeZone, now).split('-').map(Number);
	const base = new Date(Date.UTC(y, m - 1, d));
	const current = ((base.getUTCDay() + 6) % 7) + 1;
	base.setUTCDate(base.getUTCDate() + ((weekday - current + 7) % 7));
	return base.toISOString().slice(0, 10);
}

/** AAAA-MM-JJ → JJ-MM-AAAA, le format de date de Raid-Helper. */
export const raidHelperDate = (date: string) => date.split('-').reverse().join('-');

let discovered: { at: number; events: UpcomingEvent[] } | null = null;
const DISCOVERY_TTL_MS = 5 * 60_000;
// Messages de bots qui ne sont pas des événements Raid-Helper : on ne les redemande jamais.
const notEvents = new Set<string>();

/**
 * Sorties à venir sans clé API : le bot parcourt les derniers messages des salons qu'il
 * voit. L'ID d'un événement Raid-Helper est celui de son message, lisible par l'API
 * publique sans clé.
 */
async function discoverWithBot(guildId: string): Promise<UpcomingEvent[]> {
	if (discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.events;
	const channels = await textChannels();
	const ids = new Set<string>();
	// Cinq salons lus à la fois au plus : tous d'un coup, Discord répond 429 sur un serveur
	// qui a beaucoup de salons, et les sorties de ces salons manquaient sans le dire.
	const pending = [...channels];
	await Promise.all(
		Array.from({ length: 5 }, async () => {
			for (let ch = pending.shift(); ch; ch = pending.shift()) {
				try {
					for (const m of await recentMessages(ch.id)) if (m.author.bot && !notEvents.has(m.id)) ids.add(m.id);
				} catch (e) {
					// Salon que le bot ne peut pas lire : on l'ignore.
					if (!(e instanceof BotError)) throw e;
				}
			}
		})
	);

	const since = Date.now() / 1000 - 6 * 3600;
	const events: UpcomingEvent[] = [];
	const queue = [...ids];
	// Cinq lectures en parallèle au plus, pour ménager l'API de Raid-Helper.
	await Promise.all(
		Array.from({ length: 5 }, async () => {
			for (let id = queue.shift(); id; id = queue.shift()) {
				const e = await fetchEvent(id).catch(() => undefined);
				if (e === null) remember(notEvents, id, undefined, 5000);
				if (!e || e.serverId !== guildId || e.startTime < since) continue;
				events.push({
					id: e.id,
					title: e.displayTitle || e.title,
					startTime: e.startTime,
					channelId: e.channelId ?? null,
					channelName: e.channelName ?? channels.find((c) => c.id === e.channelId)?.name ?? null,
					leaderName: e.leaderName ?? null,
					signUpCount: e.signUps.filter((s) => RAID_HELPER.roles[s.className]).length,
					image: eventImage(e)
				});
			}
		})
	);
	events.sort((a, b) => a.startTime - b.startTime);
	discovered = { at: Date.now(), events };
	return events;
}

/** Sorties à venir : par l'API Raid-Helper si la clé est configurée, sinon par le bot. */
export async function upcomingOutings(): Promise<{ events: UpcomingEvent[] | null; error: string | null; source: 'api' | 'bot' | null }> {
	const guildId = getDiscord()?.guildId;
	if (!guildId) return { events: null, error: null, source: null };
	const { apiKey } = getRaidHelper();
	try {
		if (apiKey) return { events: await listUpcoming(guildId, apiKey), error: null, source: 'api' };
		if (botReady()) return { events: await discoverWithBot(guildId), error: null, source: 'bot' };
		return { events: null, error: null, source: null };
	} catch (e) {
		const error = e instanceof RaidHelperError || e instanceof BotError ? e.message : 'Raid-Helper ou Discord ne répond pas, réessaie dans un instant.';
		return { events: null, error, source: apiKey ? 'api' : 'bot' };
	}
}

/** Après une création de sortie : la prochaine liste repart de zéro. */
export const forgetDiscovered = () => (discovered = null);

// Sorties officielles (officiers, salon officiel) et sorties proposées par les membres
// (salon dédié, organisées par leur créateur, sans raid ni événement Discord).

export type OutingKind = 'official' | 'member';

/** Sorties membres à venir par joueur : garde-fou contre le spam du salon. */
export const MAX_UPCOMING_MEMBER_OUTINGS = 3;

/** Activités qu'un membre peut proposer : tout sauf les raids, organisés par les officiers. */
export const memberActivityAllowed = (activity: string | null) => activity !== 'raid';

export function recordOuting(values: typeof outings.$inferInsert) {
	db().insert(outings).values(values).onConflictDoNothing().run();
}

export const getOuting = (eventId: string) => db().select().from(outings).where(eq(outings.eventId, eventId)).get();

export const updateOutingRecord = (eventId: string, values: { title: string; startTime: Date }) =>
	db().update(outings).set(values).where(eq(outings.eventId, eventId)).run();

export const deleteOutingRecord = (eventId: string) => db().delete(outings).where(eq(outings.eventId, eventId)).run();

/** Sorties membres encore à venir proposées par ce joueur. */
export function upcomingMemberOutings(userId: string, now = new Date()) {
	return (
		db()
			.select({ n: count() })
			.from(outings)
			.where(and(eq(outings.createdBy, userId), eq(outings.kind, 'member'), gt(outings.startTime, now)))
			.get()?.n ?? 0
	);
}

/** Officier, ou créateur de la sortie : peut la modifier et la supprimer. */
export function canManageOuting(locals: App.Locals, eventId: string) {
	if (locals.admin || locals.user?.permission === 'officer') return true;
	return Boolean(locals.user && getOuting(eventId)?.createdBy === locals.user.id);
}
