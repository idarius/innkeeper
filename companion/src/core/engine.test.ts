import { describe, expect, it, vi } from 'vitest';
import { ApiError, type SyncResult } from './api';
import { accountOf, describeResult, SyncEngine, type EngineDeps } from './engine';

const FILE = 'C:\\WoW\\_forever_\\WTF\\Account\\COMPTE1\\SavedVariables\\InnkeeperSync.lua';
const ok: SyncResult = { scope: 'guild', unchanged: false, changed: 3, synced: 12 };

function setup(send: EngineDeps['send']) {
	let now = 1_000_000;
	let mtime = 1;
	const deps: EngineDeps = { send, find: async () => [FILE], stat: async () => ({ mtimeMs: mtime, size: 10 }), read: async () => new Uint8Array(1), now: () => now };
	const engine = new SyncEngine(deps);
	engine.configure({ siteUrl: 'https://g.fr', token: 'iks_x', gameDir: 'C:\\WoW' });
	return { engine, advance: (ms: number) => (now += ms), write: () => mtime++ };
}

describe('moteur de synchronisation', () => {
	it('attend un dossier de jeu', async () => {
		const engine = new SyncEngine({ send: vi.fn(), find: async () => [], stat: async () => null, read: async () => new Uint8Array(), now: () => 0 });
		engine.configure({ siteUrl: 'https://g.fr', token: 'iks_x', gameDir: '' });
		await engine.tick();
		expect(engine.state.status).toBe('no-game');
	});

	it('envoie un fichier stable, une seule fois, puis après chaque nouvelle écriture', async () => {
		const send = vi.fn(async () => ok);
		const { engine, write, advance } = setup(send);
		const synced = vi.fn();
		engine.onSynced(synced);
		await engine.tick();
		expect(send).not.toHaveBeenCalled(); // premier relevé : on attend de le voir stable
		await engine.tick();
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(1);
		expect(engine.state).toMatchObject({ status: 'synced', files: [FILE] });
		expect(engine.state.events[0]).toMatchObject({ account: 'COMPTE1', message: '3 persos mis à jour (guilde)', ok: true });
		expect(synced).toHaveBeenCalledWith(ok, 'COMPTE1');
		write();
		advance(5000);
		await engine.tick();
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('s’arrête sur une clé refusée', async () => {
		const send = vi.fn(async () => {
			throw new ApiError('Clé inconnue ou révoquée.', 401);
		});
		const { engine, write } = setup(send);
		await engine.tick();
		await engine.tick();
		expect(engine.state).toMatchObject({ status: 'refused', detail: 'Clé inconnue ou révoquée.' });
		write();
		await engine.tick();
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('réessaie de plus en plus tard quand le site ne répond pas', async () => {
		let fail = true;
		const send = vi.fn(async () => {
			if (fail) throw new ApiError('Site injoignable.', 0);
			return ok;
		});
		const { engine, advance } = setup(send);
		await engine.tick();
		await engine.tick();
		expect(engine.state.status).toBe('retrying');
		advance(10_000);
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(1); // trop tôt
		fail = false;
		advance(25_000);
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(2);
		expect(engine.state.status).toBe('synced');
	});

	it('un fichier illisible n’empêche pas d’envoyer ceux des autres comptes, et sera relu plus tard', async () => {
		const OTHER = 'C:\\WoW\\_forever_\\WTF\\Account\\COMPTE2\\SavedVariables\\InnkeeperSync.lua';
		let locked = true;
		let now = 1_000_000;
		const send = vi.fn(async () => ok);
		const engine = new SyncEngine({
			send,
			find: async () => [FILE, OTHER],
			stat: async () => ({ mtimeMs: 1, size: 10 }),
			// Le jeu tient encore le premier fichier (écriture en cours, antivirus…).
			read: async (path) => {
				if (path === FILE && locked) throw new Error('EBUSY: resource busy or locked');
				return new Uint8Array(1);
			},
			now: () => now
		});
		engine.configure({ siteUrl: 'https://g.fr', token: 'iks_x', gameDir: 'C:\\WoW' });
		await engine.tick();
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(1);
		expect(engine.state.events.map((e) => e.account).sort()).toEqual(['COMPTE1', 'COMPTE2']);
		expect(engine.state.events.find((e) => e.account === 'COMPTE1')).toMatchObject({ ok: false });

		locked = false;
		now += 60_000;
		await engine.tick();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('nomme le compte et résume le résultat', () => {
		expect(accountOf(FILE)).toBe('COMPTE1');
		expect(accountOf('/jeu/WTF/Account/MOI/SavedVariables/InnkeeperSync.lua')).toBe('MOI');
		expect(describeResult({ scope: 'own', unchanged: false, changed: 1, synced: 1 })).toBe('1 perso mis à jour (tes persos)');
		expect(describeResult({ ...ok, unchanged: true })).toBe('déjà à jour');
	});
});
