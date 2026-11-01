import { getDiscord } from './settings';

// Actions du bot de la guilde (API REST de Discord, jeton du bot). Aucune connexion
// permanente : le site appelle Discord seulement quand il en a besoin.

const API = 'https://discord.com/api/v10';

export class BotError extends Error {}

function config() {
	const discord = getDiscord();
	if (!discord?.botToken) throw new BotError('Le bot n’est pas configuré (Admin → Connexion Discord).');
	return { token: discord.botToken, guildId: discord.guildId };
}

// Limite d'appels de Discord (429) : on patiente et on réessaie une fois si l'attente demandée
// est courte ; au-delà, l'erreur remonte plutôt que de laisser une page en suspens.
const MAX_RETRY_WAIT_S = 5;

/** Attente demandée par Discord, en secondes (corps JSON `retry_after`, sinon en-tête Retry-After). */
async function retryAfter(res: Response) {
	const body = (await res.clone().json().catch(() => null)) as { retry_after?: number } | null;
	const wait = Number(body?.retry_after ?? res.headers.get('Retry-After'));
	return Number.isFinite(wait) && wait >= 0 ? wait : null;
}

async function call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
	const { token } = config();
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...init.headers },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 429 && !retried) {
		const wait = await retryAfter(res);
		if (wait !== null && wait <= MAX_RETRY_WAIT_S) {
			await new Promise((r) => setTimeout(r, wait * 1000));
			return call(path, init, true);
		}
	}
	if (res.status === 403) throw new BotError('Le bot n’a pas la permission nécessaire sur Discord.');
	return res;
}

export const botReady = () => Boolean(getDiscord()?.botToken);

// Code d'erreur Discord « Unknown Guild » : le bot ne voit pas le serveur (mauvais identifiant…).
const UNKNOWN_GUILD = 10004;

/** Membre du serveur de la guilde, ou null s'il n'y est pas. */
export async function guildMember(userId: string) {
	const res = await call(`/guilds/${config().guildId}/members/${userId}`);
	if (res.status === 404) {
		// Serveur introuvable : ce n'est pas le membre qui manque, on ne conclut rien.
		const body = (await res.json().catch(() => null)) as { code?: number } | null;
		if (body?.code === UNKNOWN_GUILD) throw new BotError('Le bot ne trouve pas le serveur de la guilde.');
		return null;
	}
	if (!res.ok) throw new BotError(`Discord a répondu ${res.status}`);
	return (await res.json()) as { roles: string[]; nick: string | null };
}

/** Donne un rôle à un membre. Le rôle doit être placé sous celui du bot dans la hiérarchie. */
export async function addRole(userId: string, roleId: string) {
	const res = await call(`/guilds/${config().guildId}/members/${userId}/roles/${roleId}`, {
		method: 'PUT',
		headers: { 'X-Audit-Log-Reason': 'Candidature acceptée sur le portail de la guilde (Innkeeper)' }
	});
	if (!res.ok) throw new BotError(`Impossible d'attribuer le rôle (Discord a répondu ${res.status}). Vérifie que le rôle du bot est au-dessus.`);
}

/**
 * Fait entrer un utilisateur sur le serveur avec son jeton OAuth (scope `guilds.join`),
 * sans invitation, avec les rôles indiqués. Renvoie false s'il y était déjà
 * (Discord ignore alors les rôles).
 */
export async function addMember(userId: string, accessToken: string, roles: string[]) {
	const res = await call(`/guilds/${config().guildId}/members/${userId}`, {
		method: 'PUT',
		headers: { 'X-Audit-Log-Reason': 'Candidature acceptée sur le portail de la guilde (Innkeeper)' },
		body: JSON.stringify({ access_token: accessToken, roles })
	});
	if (res.status === 201) return true;
	if (res.status === 204) return false;
	throw new BotError(`Impossible de faire entrer la recrue sur le serveur (Discord a répondu ${res.status}).`);
}

/** Invitation à usage unique, valable 7 jours, vers le salon indiqué. */
export async function createInvite(channelId: string) {
	const res = await call(`/channels/${channelId}/invites`, {
		method: 'POST',
		body: JSON.stringify({ max_age: 7 * 86400, max_uses: 1, unique: true })
	});
	if (!res.ok) throw new BotError(`Impossible de créer l'invitation (Discord a répondu ${res.status}).`);
	return `https://discord.gg/${((await res.json()) as { code: string }).code}`;
}

/** Salons textuels du serveur, dans l'ordre de Discord. */
export async function textChannels() {
	const res = await call(`/guilds/${config().guildId}/channels`);
	if (!res.ok) throw new BotError(`Discord a répondu ${res.status}`);
	const channels = (await res.json()) as { id: string; name: string; type: number; position: number }[];
	return channels.filter((c) => c.type === 0).sort((a, b) => a.position - b.position);
}

export interface ServerMember {
	user: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
	nick: string | null;
	roles: string[];
	joined_at: string;
}

/** Tous les membres du serveur, par pages de 1000. */
export async function listMembers() {
	const members: ServerMember[] = [];
	let after = '0';
	for (;;) {
		const res = await call(`/guilds/${config().guildId}/members?limit=1000&after=${after}`);
		if (!res.ok) throw new BotError(`Discord a répondu ${res.status} à la liste des membres.`);
		const page = (await res.json()) as ServerMember[];
		members.push(...page);
		if (page.length < 1000) return members;
		after = page[page.length - 1].user.id;
	}
}

/** Derniers messages d'un salon (ID, auteur), sans leur contenu. */
export async function recentMessages(channelId: string, limit = 100) {
	const res = await call(`/channels/${channelId}/messages?limit=${limit}`);
	if (!res.ok) throw new BotError(`Discord a répondu ${res.status}`);
	return (await res.json()) as { id: string; author: { id: string; bot?: boolean } }[];
}

export interface Embed {
	title: string;
	description?: string;
	url?: string;
	color?: number;
	fields?: { name: string; value: string; inline?: boolean }[];
}

/** Poste un message (avec encadré) dans un salon. */
export async function postMessage(channelId: string, message: { content?: string; embeds?: Embed[] }) {
	const res = await call(`/channels/${channelId}/messages`, {
		method: 'POST',
		body: JSON.stringify({ ...message, allowed_mentions: { parse: ['roles'] } })
	});
	if (!res.ok) throw new BotError(`Impossible de poster le message (Discord a répondu ${res.status}).`);
}

/**
 * Message privé à un utilisateur. Discord ne l'accepte que s'il partage un serveur avec
 * le bot et n'a pas fermé ses MP.
 */
export async function sendDirectMessage(userId: string, message: { content?: string; embeds?: Embed[] }) {
	const res = await call('/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: userId }) });
	if (!res.ok) throw new BotError(`Impossible d'ouvrir la conversation privée (Discord a répondu ${res.status}).`);
	const channel = (await res.json()) as { id: string };
	await postMessage(channel.id, message);
}
