import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotError, guildMember } from './bot';
import { upcomingOutings } from './outings';
import { setDiscord } from './settings';

setDiscord({ clientId: '111111111111111111', clientSecret: 'secret-secret-123', guildId: '222222222222222222', botToken: 'b' });
const limited = (retryAfter: number) => Response.json({ message: 'You are being rate limited.', retry_after: retryAfter, global: false }, { status: 429 });

describe('limite d’appels de Discord', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('attente courte demandée : le bot patiente puis réessaie', async () => {
		const fetch = vi.fn().mockResolvedValueOnce(limited(0.01)).mockResolvedValueOnce(Response.json({ nick: null, roles: ['1'] }));
		vi.stubGlobal('fetch', fetch);
		expect(await guildMember('333333333333333333')).toEqual({ nick: null, roles: ['1'] });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('attente longue : erreur claire plutôt qu’une page bloquée', async () => {
		const fetch = vi.fn(async () => limited(30));
		vi.stubGlobal('fetch', fetch);
		await expect(guildMember('333333333333333333')).rejects.toThrow(BotError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('repérage des sorties : les salons sont lus quelques-uns à la fois', async () => {
		let reading = 0;
		let most = 0;
		vi.stubGlobal('fetch', async (url: string) => {
			if (url.endsWith('/channels')) return Response.json(Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: `s${i}`, type: 0, position: i })));
			if (url.includes('/messages')) {
				most = Math.max(most, ++reading);
				await new Promise((r) => setTimeout(r, 5));
				reading--;
				return Response.json([]);
			}
			return new Response(null, { status: 404 });
		});
		await upcomingOutings();
		expect(most).toBeLessThanOrEqual(5);
	});
});
