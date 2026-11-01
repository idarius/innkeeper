import { desc, eq, sql } from 'drizzle-orm';
import { botReady, guildMember } from './bot';
import { db, schema } from './db';
import type { GuildMember } from './discord';
import { getAccess, getDiscord } from './settings';

export type Permission = 'officer' | 'member';

let rolePermissions: Map<string, string> | null = null;

function permissionsByRole() {
	rolePermissions ??= new Map(
		db()
			.select({ id: schema.discordRoles.id, permission: schema.discordRoles.permission })
			.from(schema.discordRoles)
			.all()
			.map((r) => [r.id, r.permission])
	);
	return rolePermissions;
}

/**
 * Permission sur le site d'après les rôles Discord du membre. `null` = pas d'accès.
 * Un compte absent du serveur de guilde n'a jamais accès : ses rôles en cache ne comptent plus.
 */
export function permissionFor({ roles, inGuild }: { roles: string[]; inGuild: boolean }): Permission | null {
	if (!inGuild) return null;
	const map = permissionsByRole();
	if (roles.some((r) => map.get(r) === 'officer')) return 'officer';
	if (roles.some((r) => map.get(r) === 'member')) return 'member';
	return getAccess().mode === 'all-members' ? 'member' : null;
}

/**
 * Connexion Discord : met à jour le joueur avec son profil et sa situation sur le serveur
 * (`member` : réponse de Discord, `null` s'il n'est pas sur le serveur de la guilde).
 */
export function recordDiscordLogin(
	discordId: string,
	profile: { username: string; name: string | null | undefined; image: string | null | undefined },
	member: GuildMember | null
) {
	if (member) recordSeenRoles(member.roles);
	const values = {
		discordUsername: profile.username,
		displayName: member?.nick ?? profile.name ?? profile.username,
		avatar: profile.image ?? null,
		roles: member?.roles ?? [],
		inGuild: Boolean(member),
		rolesCheckedAt: new Date(),
		lastLogin: new Date()
	};
	db()
		.insert(schema.users)
		.values({ discordId, ...values })
		.onConflictDoUpdate({ target: schema.users.discordId, set: values })
		.run();
}

// Rôles relus au plus toutes les 10 minutes par joueur : assez pour qu'un retrait de rôle
// ou une exclusion s'applique vite, sans solliciter Discord à chaque page.
const ROLES_TTL_MS = 10 * 60_000;

/**
 * Relit sur Discord, avec le bot, les rôles d'un joueur et sa présence sur le serveur, si la
 * dernière lecture date de plus de 10 minutes. Sans bot, ou si Discord ne répond pas, le cache
 * de la dernière connexion reste valable : une panne de Discord ne doit fermer le site à personne.
 */
export async function refreshMembership(discordId: string) {
	if (!botReady()) return;
	const users = schema.users;
	const user = db().select({ checkedAt: users.rolesCheckedAt }).from(users).where(eq(users.discordId, discordId)).get();
	if (!user || (user.checkedAt && Date.now() - user.checkedAt.getTime() < ROLES_TTL_MS)) return;
	let member: Awaited<ReturnType<typeof guildMember>>;
	try {
		member = await guildMember(discordId);
	} catch {
		return;
	}
	if (member) recordSeenRoles(member.roles);
	db()
		.update(users)
		.set({ roles: member?.roles ?? [], inGuild: Boolean(member), rolesCheckedAt: new Date() })
		.where(eq(users.discordId, discordId))
		.run();
}

/** Découverte progressive : enregistre les rôles vus chez un membre qui se connecte. */
export function recordSeenRoles(roles: string[]) {
	for (const id of roles) {
		db()
			.insert(schema.discordRoles)
			.values({ id })
			.onConflictDoUpdate({ target: schema.discordRoles.id, set: { lastSeen: new Date() } })
			.run();
	}
	rolePermissions = null;
}

export function updateRole(id: string, values: { label: string | null; permission: 'officer' | 'member' | 'none' }) {
	db().update(schema.discordRoles).set(values).where(eq(schema.discordRoles.id, id)).run();
	rolePermissions = null;
}

/** Rôles connus, avec le nombre de joueurs du site qui les portent. */
export function listRoles() {
	const users = db().select({ roles: schema.users.roles }).from(schema.users).all();
	return db()
		.select()
		.from(schema.discordRoles)
		.orderBy(desc(sql`coalesce(${schema.discordRoles.position}, -1)`), schema.discordRoles.id)
		.all()
		.map((r) => ({ ...r, members: users.filter((u) => u.roles.includes(r.id)).length }));
}

/** Option A : noms réels des rôles via un bot présent sur le serveur. */
export async function syncRolesFromBot() {
	const discord = getDiscord();
	if (!discord?.botToken) throw new Error('Aucun token de bot configuré');

	const res = await fetch(`https://discord.com/api/v10/guilds/${discord.guildId}/roles`, {
		headers: { Authorization: `Bot ${discord.botToken}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 401) throw new Error('Token de bot refusé par Discord');
	if (res.status === 403 || res.status === 404) throw new Error('Le bot n’est pas présent sur le serveur de la guilde');
	if (!res.ok) throw new Error(`Discord a répondu ${res.status}`);

	const roles = (await res.json()) as { id: string; name: string; position: number; managed: boolean }[];
	let count = 0;
	for (const r of roles) {
		// @everyone (même ID que le serveur) et rôles gérés par des intégrations ignorés.
		if (r.id === discord.guildId || r.managed) continue;
		db()
			.insert(schema.discordRoles)
			.values({ id: r.id, name: r.name, position: r.position })
			.onConflictDoUpdate({ target: schema.discordRoles.id, set: { name: r.name, position: r.position } })
			.run();
		count++;
	}
	rolePermissions = null;
	return count;
}
