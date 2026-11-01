import { remember } from './bounded';

const API = 'https://raid-helper.dev/api/v4';
const CACHE_TTL_MS = 60_000;
// Événements gardés en mémoire au plus (les sorties d'une guilde tiennent largement dedans).
const CACHE_MAX = 500;

// Sous-ensemble utilisé de la réponse GET /api/v4/events/<id> (pas de clé requise).
export interface RaidHelperSignUp {
	id: number;
	userId: string;
	name: string;
	// Selon le modèle : catégorie de rôle (Tank, Healer…), statut (Late, Absence…) ou classe.
	className: string;
	specName?: string;
	status: string;
	note?: string;
	position: number;
	entryTime: number;
}

export interface RaidHelperEvent {
	id: string;
	serverId: string;
	title: string;
	displayTitle?: string;
	description?: string;
	leaderName?: string;
	leaderId?: string;
	channelId?: string;
	channelName?: string;
	startTime: number;
	endTime?: number;
	signUps: RaidHelperSignUp[];
	advancedSettings?: Record<string, unknown>;
}

/** Image affichée par Raid-Helper (grande image, sinon vignette), ou null. */
export function eventImage(e: { advancedSettings?: unknown; image?: unknown }) {
	const settings = (e.advancedSettings ?? {}) as Record<string, unknown>;
	const url = [settings.image, settings.thumbnail, e.image].find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
	return (url as string | undefined) ?? null;
}

const cache = new Map<string, { at: number; event: RaidHelperEvent | null }>();

/** Extrait l'ID d'un événement depuis un ID brut, un lien Raid-Helper ou un lien de message Discord. */
export function parseEventId(input: string) {
	const ids = input.match(/\d{17,20}/g);
	return ids ? ids[ids.length - 1] : null;
}

/** Oublie l'événement en cache : la prochaine lecture repart de Raid-Helper. */
export const forgetEvent = (id: string) => cache.delete(id);

/** Renvoie `null` si l'événement n'existe pas. Réponses gardées en cache une minute. */
export async function fetchEvent(id: string): Promise<RaidHelperEvent | null> {
	const hit = cache.get(id);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.event;

	const res = await fetch(`${API}/events/${id}`, { signal: AbortSignal.timeout(10_000) });
	if (res.status === 404) {
		remember(cache, id, { at: Date.now(), event: null }, CACHE_MAX);
		return null;
	}
	if (!res.ok) throw new Error(`Raid-Helper a répondu ${res.status}`);

	const event = (await res.json()) as RaidHelperEvent;
	remember(cache, id, { at: Date.now(), event }, CACHE_MAX);
	return event;
}

// Appels authentifiés : clé API du serveur, réglée dans Admin → Sorties.

export class RaidHelperError extends Error {}

async function authed(path: string, apiKey: string, init: RequestInit = {}) {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { Authorization: apiKey, 'Content-Type': 'application/json; charset=utf-8', ...init.headers },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 401 || res.status === 403) {
		// Un refus n'est pas forcément la clé : on garde la raison donnée par Raid-Helper.
		const body = await res.text().catch(() => '');
		const reason = (() => {
			try {
				const j = JSON.parse(body) as { error?: string; reason?: string; message?: string };
				return j.error ?? j.reason ?? j.message ?? '';
			} catch {
				return body.slice(0, 200);
			}
		})();
		console.error(`Raid-Helper ${init.method ?? 'GET'} ${path} → ${res.status} ${reason}`);
		if (res.status === 401 || /key|token|unauthori/i.test(reason)) throw new RaidHelperError('Clé API Raid-Helper refusée : vérifie-la dans Admin → Sorties.');
		throw new RaidHelperError(`Raid-Helper a refusé l'opération${reason ? ` : « ${reason} »` : ` (${res.status})`}.`);
	}
	return res;
}

/** Sortie à venir, telle que listée par Raid-Helper (sans les inscriptions détaillées). */
export interface UpcomingEvent {
	id: string;
	title: string;
	startTime: number;
	channelId: string | null;
	channelName: string | null;
	leaderName: string | null;
	signUpCount: number | null;
	image: string | null;
}

let upcoming: { at: number; key: string; events: UpcomingEvent[] } | null = null;

/** Sorties du serveur à partir d'aujourd'hui, de la plus proche à la plus lointaine. Cache d'une minute. */
export async function listUpcoming(serverId: string, apiKey: string): Promise<UpcomingEvent[]> {
	const key = `${serverId}:${apiKey}`;
	if (upcoming?.key === key && Date.now() - upcoming.at < CACHE_TTL_MS) return upcoming.events;
	const since = Math.floor(Date.now() / 1000) - 6 * 3600;
	const res = await authed(`/servers/${serverId}/events`, apiKey, { headers: { StartTimeFilter: String(since) } });
	if (!res.ok) throw new RaidHelperError(`Raid-Helper a répondu ${res.status}`);
	const body = (await res.json()) as { postedEvents?: Record<string, unknown>[] };
	const events = (body.postedEvents ?? [])
		.map((e) => ({
			id: String(e.id),
			title: String(e.displayTitle || e.title || 'Sans titre'),
			startTime: Number(e.startTime),
			channelId: e.channelId ? String(e.channelId) : null,
			channelName: typeof e.channelName === 'string' ? e.channelName : null,
			leaderName: typeof e.leaderName === 'string' ? e.leaderName : null,
			signUpCount: typeof e.signUpCount === 'number' ? e.signUpCount : Array.isArray(e.signUps) ? e.signUps.length : null,
			image: eventImage(e)
		}))
		.filter((e) => e.startTime >= since)
		.sort((a, b) => a.startTime - b.startTime);
	upcoming = { at: Date.now(), key, events };
	return events;
}

/** Vérifie une clé API en listant les événements du serveur ; renvoie un message d'erreur ou null. */
export async function verifyApiKey(serverId: string, apiKey: string) {
	try {
		const res = await authed(`/servers/${serverId}/events`, apiKey, { headers: { StartTimeFilter: String(Math.floor(Date.now() / 1000)) } });
		return res.ok ? null : `Raid-Helper a répondu ${res.status} lors de la vérification.`;
	} catch (e) {
		return e instanceof RaidHelperError ? e.message : 'Raid-Helper ne répond pas, réessaie dans un instant.';
	}
}

export interface NewEvent {
	channelId: string;
	leaderId: string;
	templateId: string;
	title: string;
	description: string;
	/** JJ-MM-AAAA et HH:mm, dans le fuseau de la guilde. */
	date: string;
	time: string;
	/** Même instant en timestamp Unix, pour corriger si Raid-Helper lit la date autrement. */
	startTime: number;
	/** Réglages Raid-Helper (places, durée, image…), facultatifs. */
	advancedSettings?: Record<string, string | number | boolean>;
}

/** Crée l'événement dans le salon indiqué ; Raid-Helper le poste sur Discord. Renvoie son ID. */
export async function createEvent(serverId: string, apiKey: string, event: NewEvent) {
	const { channelId, startTime, advancedSettings = {}, ...body } = event;
	const payload = Object.keys(advancedSettings).length ? { ...body, advancedSettings } : body;
	const res = await authed(`/servers/${serverId}/channels/${channelId}/event`, apiKey, { method: 'POST', body: JSON.stringify(payload) });
	const data = (await res.json().catch(() => ({}))) as {
		status?: string;
		event?: { id?: string; startTime?: number; advancedSettings?: Record<string, unknown> };
	};
	if (!res.ok || !data.event?.id) throw new RaidHelperError(`Raid-Helper n'a pas créé l'événement (${data.status ?? res.status}).`);
	const id = String(data.event.id);
	// Format de date du serveur différent (MM-JJ…), ou réglages ignorés à la création : on les remet.
	const fix: Record<string, unknown> = {};
	if (data.event.startTime && data.event.startTime !== startTime) fix.startTime = startTime;
	const applied = data.event.advancedSettings ?? {};
	const missing = Object.fromEntries(Object.entries(advancedSettings).filter(([k, v]) => String(applied[k]) !== String(v)));
	if (Object.keys(missing).length) fix.advancedSettings = missing;
	if (Object.keys(fix).length) await authed(`/events/${id}`, apiKey, { method: 'PATCH', body: JSON.stringify(fix) });
	upcoming = null;
	return id;
}

export interface SignUpInput {
	className: string;
	specName?: string;
	name: string;
}

/**
 * Les réponses de Raid-Helper aux inscriptions ne sont pas fiables : 200 avec un statut
 * « Event was edited », ou 400 « invalid json » alors que la modification est faite.
 * On renvoie donc juste le message d'erreur éventuel ; l'appelant relit l'événement pour
 * savoir ce qui a vraiment changé.
 */
async function signupCall(path: string, apiKey: string, init: RequestInit, eventId: string) {
	try {
		const res = await authed(path, apiKey, init);
		if (res.ok) return null;
		const data = (await res.json().catch(() => ({}))) as { error?: string };
		return data.error ?? `HTTP ${res.status}`;
	} finally {
		// La page de la sortie doit refléter le changement tout de suite.
		cache.delete(eventId);
	}
}

/** Inscrit un membre (par son ID Discord) à un événement. */
export const addSignup = (eventId: string, apiKey: string, userId: string, signup: SignUpInput) =>
	signupCall(`/events/${eventId}/signups`, apiKey, { method: 'POST', body: JSON.stringify({ userId, ...signup }) }, eventId);

export const editSignup = (eventId: string, apiKey: string, signupId: number, signup: SignUpInput) =>
	signupCall(`/events/${eventId}/signups/${signupId}`, apiKey, { method: 'PATCH', body: JSON.stringify(signup) }, eventId);

export const deleteSignup = (eventId: string, apiKey: string, signupId: number) =>
	signupCall(`/events/${eventId}/signups/${signupId}`, apiKey, { method: 'DELETE' }, eventId);

/**
 * Supprime un événement (le message Raid-Helper disparaît de Discord). La réponse n'étant
 * pas fiable, on relit l'événement : renvoie true s'il n'existe plus.
 */
export async function deleteEvent(eventId: string, apiKey: string) {
	await authed(`/events/${eventId}`, apiKey, { method: 'DELETE' });
	cache.delete(eventId);
	upcoming = null;
	return (await fetchEvent(eventId)) === null;
}

export interface EventChanges {
	title: string;
	description: string;
	startTime: number;
	leaderId: string;
}

/**
 * Modifie une sortie. Comme pour les inscriptions, la réponse n'est pas fiable : on relit
 * l'événement et on renvoie la liste des champs qui n'ont pas pris (vide = tout est passé).
 */
export async function editEvent(eventId: string, apiKey: string, changes: EventChanges) {
	await authed(`/events/${eventId}`, apiKey, { method: 'PATCH', body: JSON.stringify(changes) });
	cache.delete(eventId);
	upcoming = null;
	const event = await fetchEvent(eventId);
	if (!event) return Object.keys(changes);
	const actual: Record<keyof EventChanges, unknown> = {
		title: event.title,
		description: event.description ?? '',
		startTime: event.startTime,
		leaderId: event.leaderId
	};
	return (Object.keys(changes) as (keyof EventChanges)[]).filter((k) => String(actual[k]) !== String(changes[k]));
}
