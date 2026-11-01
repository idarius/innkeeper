import { and, eq, inArray } from 'drizzle-orm';
import { listCharacters } from './characters';
import { db, schema } from './db';
import { listRoles, permissionFor } from './permissions';

/**
 * Page d'un joueur, vue par un membre ou un officier. `null` pour un compte qui n'est pas
 * dans la guilde (candidat non accepté) : il n'a pas de page.
 */
export function getPlayer(id: string, officer: boolean) {
	const user = db().select().from(schema.users).where(eq(schema.users.discordId, id)).get();
	if (!user) return null;
	const characters = listCharacters(id);
	if (!permissionFor(user) && characters.length === 0) return null;

	// Rosters de chaque perso, limités à ceux que le visiteur a le droit de voir.
	const memberships = characters.length
		? db()
				.select({ characterId: schema.rosterMembers.characterId, name: schema.rosters.name, id: schema.rosters.id })
				.from(schema.rosterMembers)
				.innerJoin(schema.rosters, eq(schema.rosters.id, schema.rosterMembers.rosterId))
				.where(
					and(
						inArray(schema.rosterMembers.characterId, characters.map((c) => c.id)),
						officer ? undefined : eq(schema.rosters.visibility, 'members')
					)
				)
				.all()
		: [];

	const roleNames = new Map(listRoles().map((r) => [r.id, r.name ?? r.label]));

	return {
		id: user.discordId,
		displayName: user.displayName,
		avatar: user.avatar,
		roles: user.roles.map((r) => roleNames.get(r)).filter((n): n is string => Boolean(n)),
		characters: characters.map((c) => ({
			...c,
			// Les notes d'un joueur ne regardent que lui et les officiers.
			notes: officer ? c.notes : null,
			// Dernière connexion en jeu : suivi, réservé aux officiers.
			lastOnlineAt: officer ? c.lastOnlineAt : null,
			rosters: memberships.filter((m) => m.characterId === c.id).map((m) => ({ id: m.id, name: m.name }))
		})),
		// Informations de suivi, réservées aux officiers.
		officerInfo: officer ? { joinedAt: user.joinedAt ?? user.createdAt, joinedKnown: Boolean(user.joinedAt), lastLogin: user.lastLogin } : null
	};
}
