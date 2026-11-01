import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGuildMember } from './discord';

describe('profil du joueur sur le serveur (connexion)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('n’attend pas Discord indéfiniment : la requête a un délai maximal', async () => {
		const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ nick: null, roles: [] }));
		vi.stubGlobal('fetch', fetch);
		await fetchGuildMember('jeton', '222222222222222222');
		expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('absent du serveur : null', async () => {
		vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
		expect(await fetchGuildMember('jeton', '222222222222222222')).toBeNull();
	});
});
