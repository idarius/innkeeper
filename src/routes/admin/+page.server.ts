import { asc } from 'drizzle-orm';
import { listCharacters } from '$lib/server/characters';
import { permissionFor } from '$lib/server/permissions';
import { db, schema } from '$lib/server/db';
import { requireOfficer } from '$lib/server/guards';
import { BotError, botReady } from '$lib/server/bot';
import { membersWithoutAccount, type MissingAccount } from '$lib/server/missing-accounts';
import { getDiscord } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireOfficer(locals);

	const characters = listCharacters();
	const players = db()
		.select()
		.from(schema.users)
		.orderBy(asc(schema.users.displayName))
		.all()
		.map((u) => ({
			id: u.discordId,
			displayName: u.displayName,
			username: u.discordUsername,
			avatar: u.avatar,
			permission: permissionFor(u),
			lastLogin: u.lastLogin,
			characters: characters.filter((c) => c.userId === u.discordId)
		}))
		// Les candidats (connectés sans être membres) se gèrent dans Candidatures.
		.filter((p) => p.permission || p.characters.length);

	// Membres du serveur avec accès au site mais sans compte : demande le bot.
	let missing: MissingAccount[] | null = null;
	let missingError: string | null = null;
	if (botReady()) {
		try {
			missing = await membersWithoutAccount();
		} catch (e) {
			missingError = e instanceof BotError ? e.message : 'Discord ne répond pas, la liste des membres sans compte est indisponible.';
		}
	}

	return { players, missing, missingError, welcome: url.searchParams.has('bienvenue'), discordReady: Boolean(getDiscord()) };
};
