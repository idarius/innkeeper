import { afterEach, describe, expect, it, vi } from 'vitest';
import { toRaidHelper } from '$lib/game/forever';
import { createUser, horde } from '../../test/helpers';
import { createCharacter } from './characters';
import type { RaidHelperEvent } from './raidhelper';
import { cancelSignup, saveSignup, signupPayload } from './signups';

horde();

describe('correspondance avec le modèle wowforever', () => {
	it('retrouve catégorie et spé, homonymes compris', () => {
		expect(toRaidHelper('shaman', 'restoration', 'healer')).toEqual({ className: 'Healer', specName: 'Restoration1' });
		expect(toRaidHelper('druid', 'restoration', 'healer')).toEqual({ className: 'Healer', specName: 'Restoration' });
		expect(toRaidHelper('paladin', 'protection', 'tank')).toEqual({ className: 'Tank', specName: 'Protection1' });
		expect(toRaidHelper('warrior', 'protection', 'tank')).toEqual({ className: 'Tank', specName: 'Protection' });
		expect(toRaidHelper('hunter', 'beast-mastery', 'ranged')).toEqual({ className: 'Ranged', specName: 'Beastmastery' });
	});

	it('druide farouche : Guardian en tank, Feral en mêlée', () => {
		expect(toRaidHelper('druid', 'feral', 'tank').specName).toBe('Guardian');
		expect(toRaidHelper('druid', 'feral', 'melee').specName).toBe('Feral');
	});

	it('sans spé renseignée : première spé de la classe pour ce rôle', () => {
		expect(toRaidHelper('warrior', null, 'tank').specName).toBe('Protection');
	});
});

describe('inscription depuis le site', () => {
	const shaman = { name: 'Drektar', class: 'shaman', spec: 'restoration', role: 'healer', spec2: 'enhancement', role2: 'melee' } as const;

	it('présent : rôle et spé du perso, au nom du perso', () => {
		expect(signupPayload(shaman, 'main', 'present')).toEqual({ className: 'Healer', specName: 'Restoration1', name: 'Drektar' });
		expect(signupPayload(shaman, 'second', 'present')).toEqual({ className: 'Melee', specName: 'Enhancement', name: 'Drektar' });
	});

	it('remplaçant : catégorie Bench, avec la spé choisie', () => {
		expect(signupPayload(shaman, 'second', 'Bench')).toEqual({ className: 'Bench', specName: 'Enhancement', name: 'Drektar' });
	});

	it('groupe complet : Raid-Helper met l’inscrit sur le banc, ce n’est pas une erreur', async () => {
		createUser('s9');
		const c = createCharacter('s9', { name: 'Tard', surname: 'Haal', race: 'orc', class: 'warrior', spec: 'protection', role: 'tank', spec2: null, role2: null, level: 60, professions: [], recipes: null, pve: null, pvp: null, notes: null, isMain: true });
		const signUps: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
			if ((init.method ?? 'GET') === 'GET') return Response.json({ id: '900', serverId: '1', title: 'MC', startTime: 0, signUps });
			const body = JSON.parse(init.body as string);
			signUps.push({ id: 7, ...body, className: 'Bench' });
			return Response.json({ status: 'Event was edited', event: {} });
		});
		expect(await saveSignup(event(), 'cle', 's9', { characterId: c.id, slot: 'main', status: 'present' })).toBeNull();
	});

	it('autres statuts : catégorie Raid-Helper, sans spé', () => {
		expect(signupPayload(shaman, 'main', 'Tentative')).toEqual({ className: 'Tentative', name: 'Drektar' });
	});

	afterEach(() => vi.unstubAllGlobals());
	// Sortie dans une semaine : on peut encore s'y inscrire.
	const future = Math.floor(Date.now() / 1000) + 7 * 86400;
	const event = (signUps: Partial<RaidHelperEvent['signUps'][number]>[] = [], startTime = future) =>
		({ id: '900', serverId: '1', title: 'MC', startTime, signUps }) as RaidHelperEvent;

	/**
	 * Faux Raid-Helper qui reproduit ses réponses réelles (relevées le 28/10/2026) :
	 * POST → 200 « Event was edited », PATCH et DELETE → 400 « invalid json » alors que
	 * le changement est appliqué. L'état est relu par GET /events/<id>.
	 */
	function fakeRaidHelper(signUps: Record<string, unknown>[] = []) {
		const calls: { method: string; url: string; body: unknown }[] = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
			const method = init.method ?? 'GET';
			const body = init.body ? JSON.parse(init.body as string) : null;
			if (method === 'GET') return Response.json({ id: '900', serverId: '1', title: 'MC', startTime: 0, signUps });
			calls.push({ method, url, body });
			const id = Number(url.split('/').pop());
			if (method === 'POST') {
				signUps.push({ id: 42, userId: body.userId, ...body });
				return Response.json({ status: 'Event was edited', event: {} });
			}
			const i = signUps.findIndex((s) => s.id === id);
			if (method === 'PATCH') Object.assign(signUps[i], body);
			if (method === 'DELETE') signUps.splice(i, 1);
			return Response.json({ error: 'invalid json' }, { status: 400 });
		});
		return calls;
	}

	it('crée l’inscription, la modifie, puis la supprime malgré les réponses trompeuses', async () => {
		createUser('s1');
		const c = createCharacter('s1', { name: 'Thrall', surname: 'Haal', race: 'orc', class: 'shaman', spec: 'restoration', role: 'healer', spec2: null, role2: null, level: 60, professions: [], recipes: null, pve: null, pvp: null, notes: null, isMain: true });
		const signUps: Record<string, unknown>[] = [];
		const calls = fakeRaidHelper(signUps);

		expect(await saveSignup(event(), 'cle', 's1', { characterId: c.id, slot: 'main', status: 'present' })).toBeNull();
		expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://raid-helper.dev/api/v4/events/900/signups', body: { userId: 's1', className: 'Healer', specName: 'Restoration1', name: 'Thrall' } });

		expect(await saveSignup(event([{ id: 42, userId: 's1' }]), 'cle', 's1', { characterId: c.id, slot: 'main', status: 'Late' })).toBeNull();
		expect(calls[1]).toMatchObject({ method: 'PATCH', url: 'https://raid-helper.dev/api/v4/events/900/signups/42', body: { className: 'Late' } });

		expect(await cancelSignup(event([{ id: 42, userId: 's1' }]), 'cle', 's1')).toBeNull();
		expect(calls[2]).toMatchObject({ method: 'DELETE', url: 'https://raid-helper.dev/api/v4/events/900/signups/42' });
		expect(signUps).toHaveLength(0);
	});

	it('sortie commencée ou passée : ni inscription ni désinscription, sans appeler Raid-Helper', async () => {
		const c = createCharacter('s1', { name: 'Voljin', surname: 'Haal', race: 'troll', class: 'shaman', spec: 'restoration', role: 'healer', spec2: null, role2: null, level: 60, professions: [], recipes: null, pve: null, pvp: null, notes: null, isMain: false });
		const calls = fakeRaidHelper([{ id: 42, userId: 's1' }]);
		const past = Math.floor(Date.now() / 1000) - 3600;
		expect(await saveSignup(event([], past), 'cle', 's1', { characterId: c.id, slot: 'main', status: 'present' })).toMatch(/commencé/);
		expect(await cancelSignup(event([{ id: 42, userId: 's1' }], past), 'cle', 's1')).toMatch(/commencé/);
		expect(calls).toHaveLength(0);
	});

	it('refuse le perso d’un autre joueur', async () => {
		createUser('s2');
		const other = createCharacter('s2', { name: 'Garrosh', surname: 'Haal', race: 'orc', class: 'warrior', spec: 'protection', role: 'tank', spec2: null, role2: null, level: 60, professions: [], recipes: null, pve: null, pvp: null, notes: null, isMain: true });
		vi.stubGlobal('fetch', async () => Response.json({ status: 'success' }));
		expect(await saveSignup(event(), 'cle', 's1', { characterId: other.id, slot: 'main', status: 'present' })).toMatch(/appartient/);
	});

	it('rien enregistré chez Raid-Helper : erreur, avec son message', async () => {
		const c = createCharacter('s1', { name: 'Rexxar', surname: 'Haal', race: 'orc', class: 'hunter', spec: 'survival', role: 'ranged', spec2: null, role2: null, level: 60, professions: [], recipes: null, pve: null, pvp: null, notes: null, isMain: false });
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) =>
			(init.method ?? 'GET') === 'GET'
				? Response.json({ id: '900', serverId: '1', title: 'MC', startTime: 0, signUps: [] })
				: Response.json({ error: 'Event is closed' }, { status: 400 })
		);
		expect(await saveSignup(event(), 'cle', 's1', { characterId: c.id, slot: 'main', status: 'present' })).toMatch(/Event is closed/);
	});
});
