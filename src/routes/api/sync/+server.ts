import { json } from '@sveltejs/kit';
import { getGuild } from '$lib/server/settings';
import { ImportError } from '$lib/server/game-import';
import { authenticate, MAX_SYNC_BYTES, SyncError, syncExport } from '$lib/server/sync';
import type { RequestHandler } from './$types';

// Adresse du programme InnkeeperSync (PC du joueur). Réponses en JSON, messages en français
// affichés tels quels par le programme.

const failure = (e: unknown) => {
	if (e instanceof SyncError) return json({ error: e.message }, { status: e.status });
	if (e instanceof ImportError) return json({ error: e.message }, { status: 400 });
	throw e;
};

/** Vérifie la clé : le programme l'appelle à la configuration. */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const who = await authenticate(request.headers.get('authorization'));
		return json({
			guild: getGuild()?.name ?? null,
			player: who.user.displayName,
			scope: who.user.permission === 'officer' ? 'guild' : 'own'
		});
	} catch (e) {
		return failure(e);
	}
};

/** Reçoit le fichier InnkeeperSync.lua, brut (application/octet-stream). */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const who = await authenticate(request.headers.get('authorization'));
		if (Number(request.headers.get('content-length') ?? 0) > MAX_SYNC_BYTES) throw new SyncError('Fichier trop lourd (5 Mo maximum).', 413);
		const source = await request.text();
		if (source.length > MAX_SYNC_BYTES) throw new SyncError('Fichier trop lourd (5 Mo maximum).', 413);
		return json(syncExport(who, source));
	} catch (e) {
		return failure(e);
	}
};
