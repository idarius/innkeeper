import { describe, expect, it, vi } from 'vitest';
import { ApiError, sendExport, whoami } from './api';
import type { Platform } from './platform';

const platform = (fetch: Platform['fetch']): Platform => ({
	subdirs: async () => [],
	exists: async () => false,
	stat: async () => null,
	readFile: async () => new Uint8Array(),
	fetch,
	now: () => 0
});

describe('appels au site', () => {
	it('chaque requête a un délai maximal : un site muet ne bloque pas la synchronisation', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ scope: 'own', unchanged: true, changed: 0, synced: 0 }));
		await sendExport(platform(fetch), 'https://g.fr', 'iks_x', new Uint8Array(1));
		await whoami(platform(fetch), 'https://g.fr', 'iks_x');
		for (const [, init] of fetch.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('délai dépassé : « site injoignable », que le moteur réessaie plus tard', async () => {
		const p = platform(async () => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const error = await sendExport(p, 'https://g.fr', 'iks_x', new Uint8Array(1)).catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 0, fatal: false, rejected: false });
	});
});
