import { db, schema } from '$lib/server/db';
import { guildSchema, setGuild } from '$lib/server/settings';

/** FormData à partir d'un objet ; un tableau donne plusieurs valeurs pour la même clé. */
export function formData(values: Record<string, string | string[] | undefined>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue;
		for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
	}
	return form;
}

/** Compte connu du site, présent sur le serveur de guilde sauf `extra.inGuild: false`. */
export function createUser(id: string, roles: string[] = [], extra: Partial<typeof schema.users.$inferInsert> = {}) {
	return db()
		.insert(schema.users)
		.values({ discordId: id, discordUsername: `user${id}`, displayName: `Joueur ${id}`, roles, inGuild: true, ...extra })
		.returning()
		.get();
}

export function horde() {
	setGuild(guildSchema.parse({ name: 'La Horde de Test', faction: 'horde', accentColor: '#b3261e' }));
}

/**
 * Locals d'un joueur Discord ou de l'admin local, comme les fournit le hook de session.
 * Les fonctions ajoutées par Auth.js (auth, signIn…) ne servent pas au code testé.
 */
export const asMember = (id: string, permission: 'member' | 'officer' = 'member') =>
	({ user: { id, displayName: `Joueur ${id}`, avatar: null, permission }, candidate: null, admin: null }) as unknown as App.Locals;
export const asAdmin = () => ({ user: null, candidate: null, admin: { id: 1, username: 'admin' } }) as unknown as App.Locals;

/** Perso valide pour un orc chaman restauration, à surcharger au besoin. */
export const shaman = (overrides: Record<string, string | string[]> = {}) => ({
	name: 'Thrall',
	surname: 'Fils-de-Durotan',
	race: 'orc',
	class: 'shaman',
	spec: 'restoration',
	role: 'healer',
	level: '60',
	...overrides
});
