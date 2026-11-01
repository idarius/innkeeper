import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConnectLink } from '../../../companion/src/core/config';
import { GET, POST } from '../../routes/api/sync/+server';
import { actions } from '../../routes/persos/synchro/+page.server';
import { asMember, createUser, horde } from '../../test/helpers';
import { createCharacter, getCharacter } from './characters';
import { recordSeenRoles, updateRole } from './permissions';
import { getGameImport, setAccess, setDiscord } from './settings';
import { authenticate, createSyncToken, identify, listSyncTokens, MAX_TOKENS, revokeSyncToken, SyncError, syncExport } from './sync';

horde();

// Fichier produit par addon/test/simulate.lua : Drektar exporte, Krenna est dans le registre.
const fixture = readFileSync('src/test/fixtures/InnkeeperSync.lua', 'utf8');

const OFFICIER = '900000000000000001';
const MEMBRE = '900000000000000004';
setAccess({ mode: 'mapped-roles' });
recordSeenRoles([OFFICIER, MEMBRE]);
updateRole(OFFICIER, { label: 'Officier', permission: 'officer' });
updateRole(MEMBRE, { label: 'Membre', permission: 'member' });

createUser('officier', [OFFICIER]);
createUser('drektar', [MEMBRE]);
createUser('krenna', [MEMBRE]);
createUser('parti', []);

const sheet = (userId: string, name: string) =>
	createCharacter(userId, {
		name,
		surname: 'Haal',
		race: 'troll',
		class: 'shaman',
		spec: null,
		role: 'healer',
		spec2: null,
		role2: null,
		level: 1,
		professions: [],
		recipes: null,
		pve: null,
		pvp: null,
		notes: null,
		isMain: true
	});
const drektar = sheet('drektar', 'Drektar');
const krenna = sheet('krenna', 'Krenna');

const call = (handler: typeof POST, token: string | null, body?: string) =>
	handler({
		request: new Request('http://localhost/api/sync', {
			method: body === undefined ? 'GET' : 'POST',
			headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/octet-stream' },
			body
		})
	} as never);

describe('clés de synchronisation', () => {
	it('se créent, se reconnaissent et se révoquent ; seule l’empreinte est gardée', () => {
		const token = createSyncToken('drektar', '  PC du salon  ');
		expect(token).toMatch(/^iks_/);
		const [row] = listSyncTokens('drektar');
		expect(row).toMatchObject({ label: 'PC du salon', hint: token.slice(0, 8) });
		expect(identify(`Bearer ${token}`).user).toMatchObject({ id: 'drektar', permission: 'member' });

		expect(revokeSyncToken('krenna', row.id)).toBe(false);
		expect(revokeSyncToken('drektar', row.id)).toBe(true);
		expect(() => identify(`Bearer ${token}`)).toThrow(/révoquée/);
	});

	it('refusent une clé absente, inconnue, ou d’un compte qui n’a plus accès', () => {
		expect(() => identify(null)).toThrow(SyncError);
		expect(() => identify('Bearer iks_inventee')).toThrow(/inconnue/);
		const token = createSyncToken('parti', 'Vieux PC');
		expect(() => identify(`Bearer ${token}`)).toThrow(expect.objectContaining({ status: 403 }));
		// Même en mode « tout membre du serveur » : un compte qui n'est plus sur le serveur est refusé.
		setAccess({ mode: 'all-members' });
		createUser('exclu', [], { inGuild: false });
		expect(() => identify(`Bearer ${createSyncToken('exclu', 'PC')}`)).toThrow(expect.objectContaining({ status: 403 }));
		setAccess({ mode: 'mapped-roles' });
	});

	it(`sont limitées à ${MAX_TOKENS} par joueur`, () => {
		for (let i = 0; i < MAX_TOKENS; i++) createSyncToken('krenna', `PC ${i}`);
		expect(() => createSyncToken('krenna', 'Un de trop')).toThrow(/au plus/);
		for (const t of listSyncTokens('krenna')) revokeSyncToken('krenna', t.id);
	});
});

describe('envoi du fichier par le programme', () => {
	it('clé de membre : seulement ses persos, sans servir de référence « vu en jeu »', async () => {
		const token = createSyncToken('drektar', 'PC');
		const res = await call(POST, token, fixture);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ scope: 'own', unchanged: false, changed: 1, synced: 1 });
		expect(getCharacter(drektar.id)?.level).toBe(42);
		expect(getCharacter(krenna.id)?.level).toBe(1);
		expect(getGameImport()).toBeNull();
	});

	it('clé d’officier : toute la guilde, registre compris', async () => {
		const token = createSyncToken('officier', 'PC');
		expect(await (await call(GET, token)).json()).toMatchObject({ player: 'Joueur officier', scope: 'guild' });
		const res = await call(POST, token, fixture);
		expect(await res.json()).toMatchObject({ scope: 'guild', unchanged: false });
		expect(getCharacter(krenna.id)?.level).toBe(17);
		expect(getGameImport()?.rosterSize).toBe(3);
	});

	it('un fichier inchangé n’est pas réimporté ; des envois trop rapprochés attendent', () => {
		const token = createSyncToken('krenna', 'PC');
		const who = () => identify(`Bearer ${token}`);
		const now = Date.now();
		expect(syncExport(who(), fixture, now).unchanged).toBe(false);
		expect(syncExport(who(), fixture, now + 1000).unchanged).toBe(true);
		const other = fixture.replace('["level"] = 42', '["level"] = 43');
		expect(() => syncExport(who(), other, now + 2000)).toThrow(expect.objectContaining({ status: 429 }));
		expect(syncExport(who(), other, now + 20_000).unchanged).toBe(false);
	});

	it('répond par un message clair à une clé refusée ou un fichier illisible', async () => {
		const bad = await call(POST, 'iks_inventee', fixture);
		expect(bad.status).toBe(401);
		expect((await bad.json()).error).toMatch(/inconnue/);
		const garbage = await call(POST, createSyncToken('drektar', 'PC 2'), 'pas du Lua');
		expect(garbage.status).toBe(400);
	});
});

describe('bouton « Connecter InnkeeperSync »', () => {
	it('crée une clé et produit le lien que l’application accepte', async () => {
		const result = (await actions.connect({ locals: asMember('drektar'), url: new URL('https://ma-guilde.fr/persos/synchro') } as never)) as { token: string; link: string };
		expect(parseConnectLink(result.link)).toEqual({ siteUrl: 'https://ma-guilde.fr', token: result.token });
		expect(identify(`Bearer ${result.token}`).user.id).toBe('drektar');
	});
});

describe('clé d’un membre exclu entre-temps', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('les droits de la clé suivent les rôles relus sur Discord', async () => {
		setDiscord({ clientId: '111111111111111111', clientSecret: 'secret-secret-123', guildId: '222222222222222222', botToken: 'b' });
		createUser('banni', [MEMBRE], { rolesCheckedAt: new Date(Date.now() - 3_600_000) });
		const token = createSyncToken('banni', 'PC');
		vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
		await expect(authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 403 });
		await expect(authenticate('Bearer iks_inventee')).rejects.toMatchObject({ status: 401 });
	});
});
