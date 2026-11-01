const API = 'https://discord.com/api/v10';

export interface GuildMember {
	nick: string | null;
	roles: string[];
}

/**
 * Lit le profil de l'utilisateur sur le serveur de guilde avec son jeton OAuth
 * (scope `guilds.members.read`). Renvoie `null` s'il n'en est pas membre.
 */
export async function fetchGuildMember(accessToken: string, guildId: string) {
	const res = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 404 || res.status === 403) return null;
	if (!res.ok) throw new Error(`Discord a répondu ${res.status} pour le serveur ${guildId}`);
	return (await res.json()) as GuildMember;
}

/** Échange un code OAuth contre un jeton d'accès (flux « authorization code »). */
export async function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
	const res = await fetch(`${API}/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Discord a refusé le code d'autorisation (${res.status}).`);
	return (await res.json()) as { access_token: string; scope: string };
}

/** Identifiant Discord du titulaire d'un jeton OAuth. */
export async function tokenOwner(accessToken: string) {
	const res = await fetch(`${API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Discord a répondu ${res.status} pour le profil.`);
	return ((await res.json()) as { id: string }).id;
}

/** Vérifie l'identifiant et la clé secrète d'une appli (grant client_credentials). */
export async function verifyApp(clientId: string, clientSecret: string) {
	const res = await fetch(`${API}/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'identify' }),
		signal: AbortSignal.timeout(10_000)
	});
	if (res.ok) return null;
	if (res.status === 401) return 'Identifiant ou clé secrète refusés par Discord.';
	return `Discord a répondu ${res.status} lors de la vérification.`;
}

// Permissions demandées à l'invitation du bot, et rien d'autre :
// créer une invitation (1) et gérer les rôles (268435456) pour faire entrer et promouvoir
// les recrues ; voir les salons (1024), envoyer des messages (2048) et intégrer des liens
// (16384) pour les annonces dans le salon des officiers ; lire l'historique (65536) pour
// retrouver les sorties postées par Raid-Helper.
const BOT_PERMISSIONS = 1 + 1024 + 2048 + 16384 + 65536 + 268435456;

export function botInviteUrl(clientId: string, guildId: string) {
	const params = new URLSearchParams({
		client_id: clientId,
		scope: 'bot',
		permissions: String(BOT_PERMISSIONS),
		guild_id: guildId,
		disable_guild_select: 'true'
	});
	return `https://discord.com/oauth2/authorize?${params}`;
}

/** Le bot est-il présent sur le serveur de la guilde ? Renvoie le nom du serveur, ou null. */
export async function botGuild(token: string, guildId: string) {
	const res = await fetch(`${API}/guilds/${guildId}`, {
		headers: { Authorization: `Bot ${token}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) return null;
	return ((await res.json()) as { name: string }).name;
}

/** Vérifie un token de bot ; renvoie un message d'erreur ou null. */
export async function verifyBot(token: string) {
	const res = await fetch(`${API}/users/@me`, {
		headers: { Authorization: `Bot ${token}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.ok) return null;
	if (res.status === 401) return 'Token de bot refusé par Discord.';
	return `Discord a répondu ${res.status} lors de la vérification du bot.`;
}
