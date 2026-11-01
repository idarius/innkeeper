import { desc, sql } from 'drizzle-orm';
import { listMembers } from './bot';
import { db, schema } from './db';
import { permissionFor } from './permissions';

// Membres du serveur Discord qui ont accès au site (rôle Membre ou Officier) mais ne s'y
// sont jamais connectés : à relancer pour qu'ils créent leurs fiches.

export interface MissingAccount {
	id: string;
	name: string;
	username: string;
	avatar: string | null;
	topRole: string | null;
	permission: 'officer' | 'member';
	joinedAt: Date;
}

export async function membersWithoutAccount(): Promise<MissingAccount[]> {
	const members = await listMembers();
	const known = new Set(
		db()
			.select({ id: schema.users.discordId })
			.from(schema.users)
			.all()
			.map((u) => u.id)
	);
	// Rôles du plus haut au plus bas, pour afficher le rang de chacun.
	const roles = db()
		.select({ id: schema.discordRoles.id, name: schema.discordRoles.name, label: schema.discordRoles.label })
		.from(schema.discordRoles)
		.orderBy(desc(sql`coalesce(${schema.discordRoles.position}, -1)`))
		.all();

	return members
		.filter((m) => !m.user.bot && !known.has(m.user.id))
		.map((m) => ({ m, permission: permissionFor({ roles: m.roles, inGuild: true }) }))
		.filter((x): x is { m: (typeof members)[number]; permission: 'officer' | 'member' } => x.permission !== null)
		.map(({ m, permission }) => {
			const top = roles.find((r) => m.roles.includes(r.id));
			return {
				id: m.user.id,
				name: m.nick ?? m.user.global_name ?? m.user.username,
				username: m.user.username,
				avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : null,
				topRole: top ? (top.label ?? top.name) : null,
				permission,
				joinedAt: new Date(m.joined_at)
			};
		})
		.sort((a, b) => (a.permission === b.permission ? a.name.localeCompare(b.name, 'fr') : a.permission === 'officer' ? -1 : 1));
}
