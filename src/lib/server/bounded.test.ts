import { afterEach, describe, expect, it, vi } from 'vitest';
import { remember } from './bounded';
import { fetchEvent } from './raidhelper';

describe('caches en mémoire bornés', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('retire les entrées les plus anciennes au-delà de la limite ; une entrée réécrite redevient récente', () => {
		const map = new Map<string, number>();
		remember(map, 'a', 1, 2);
		remember(map, 'b', 2, 2);
		remember(map, 'a', 3, 2);
		remember(map, 'c', 4, 2);
		expect([...map.entries()]).toEqual([
			['a', 3],
			['c', 4]
		]);
		const set = new Set<string>();
		for (const k of ['x', 'y', 'z']) remember(set, k, undefined, 2);
		expect([...set]).toEqual(['y', 'z']);
	});

	it('le cache des événements Raid-Helper ne grossit pas avec des identifiants inventés', async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 404 }));
		vi.stubGlobal('fetch', fetch);
		for (let i = 0; i < 501; i++) await fetchEvent(String(100000000000000000n + BigInt(i)));
		expect(fetch).toHaveBeenCalledTimes(501);
		// Le plus récent est encore en cache, le tout premier en est sorti.
		await fetchEvent(String(100000000000000000n + 500n));
		expect(fetch).toHaveBeenCalledTimes(501);
		await fetchEvent('100000000000000000');
		expect(fetch).toHaveBeenCalledTimes(502);
	});
});
