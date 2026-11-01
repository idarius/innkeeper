import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, schema } from './db';
import { listRoles, permissionFor, recordDiscordLogin, recordSeenRoles, refreshMembership, updateRole } from './permissions';
import { createUser } from '../../test/helpers';
import { setAccess, setDiscord } from './settings';

const OFFICER = '900000000000000001';
const MEMBER = '900000000000000005';
const GUEST = '900000000000000006';

// Membre du serveur de la guilde portant ces rôles.
const onServer = (roles: string[]) => ({ roles, inGuild: true });

describe('permissions selon les rôles Discord', () => {
	it('découvre les rôles des membres qui se connectent, sans permission par défaut', () => {
		recordSeenRoles([OFFICER, MEMBER, GUEST]);
		expect(listRoles().map((r) => r.id).sort()).toEqual([OFFICER, MEMBER, GUEST].sort());
		expect(listRoles().every((r) => r.permission === 'none')).toBe(true);
	});

	it('mode « tout membre du serveur » : tout le monde est membre, les officiers sont désignés par rôle', () => {
		setAccess({ mode: 'all-members' });
		updateRole(OFFICER, { label: 'Chef de Guerre', permission: 'officer' });
		expect(permissionFor(onServer([GUEST]))).toBe('member');
		expect(permissionFor(onServer([]))).toBe('member');
		expect(permissionFor(onServer([GUEST, OFFICER]))).toBe('officer');
	});

	it('mode « rôles désignés » : sans rôle Membre ou Officier, pas d’accès (les Éclaireurs restent dehors)', () => {
		setAccess({ mode: 'mapped-roles' });
		updateRole(MEMBER, { label: 'Recrue', permission: 'member' });
		expect(permissionFor(onServer([GUEST]))).toBeNull();
		expect(permissionFor(onServer([]))).toBeNull();
		expect(permissionFor(onServer([MEMBER]))).toBe('member');
		expect(permissionFor(onServer([MEMBER, OFFICER]))).toBe('officer');
	});

	it('un compte absent du serveur n’a aucun accès, quel que soit le mode', () => {
		const absent = { roles: [], inGuild: false };
		setAccess({ mode: 'all-members' });
		expect(permissionFor(absent)).toBeNull();
		// Rôles en cache d'un ancien officier qui a quitté le serveur : ignorés.
		expect(permissionFor({ roles: [OFFICER], inGuild: false })).toBeNull();
		setAccess({ mode: 'mapped-roles' });
		expect(permissionFor(absent)).toBeNull();
	});

	it('la connexion Discord enregistre si le compte est sur le serveur', () => {
		setAccess({ mode: 'all-members' });
		const stored = (id: string) => db().select().from(schema.users).where(eq(schema.users.discordId, id)).get()!;

		recordDiscordLogin('900000000000000101', { username: 'inconnu', name: null, image: null }, null);
		expect(stored('900000000000000101')).toMatchObject({ inGuild: false, roles: [] });
		expect(permissionFor(stored('900000000000000101'))).toBeNull();

		// Sur le serveur sans aucun rôle : membre en mode « tout membre du serveur ».
		recordDiscordLogin('900000000000000102', { username: 'nouveau', name: 'Nouveau', image: null }, { nick: null, roles: [] });
		expect(stored('900000000000000102')).toMatchObject({ inGuild: true, roles: [], displayName: 'Nouveau' });
		expect(permissionFor(stored('900000000000000102'))).toBe('member');

		// Il quitte le serveur puis se reconnecte : plus d'accès.
		recordDiscordLogin('900000000000000102', { username: 'nouveau', name: 'Nouveau', image: null }, null);
		expect(permissionFor(stored('900000000000000102'))).toBeNull();
	});

	it('compte les joueurs du site qui portent chaque rôle', () => {
		createUser('p1', [MEMBER]);
		createUser('p2', [MEMBER, OFFICER]);
		const byId = new Map(listRoles().map((r) => [r.id, r.members]));
		expect(byId.get(MEMBER)).toBe(2);
		expect(byId.get(OFFICER)).toBe(1);
		expect(byId.get(GUEST)).toBe(0);
	});
});

describe('rôles relus sur Discord par le bot', () => {
	afterEach(() => vi.unstubAllGlobals());
	const stored = (id: string) => db().select().from(schema.users).where(eq(schema.users.discordId, id)).get()!;
	const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
	// Réponse du bot pour GET /guilds/<id>/members/<user> : membre avec ces rôles, ou absent (404).
	const discord = (roles: string[] | null) => {
		const fetch = vi.fn(async () => (roles ? Response.json({ nick: null, roles }) : new Response('', { status: 404 })));
		vi.stubGlobal('fetch', fetch);
		return fetch;
	};

	it('sans bot, rien n’est relu : le cache de la connexion fait foi', async () => {
		createUser('r0', [OFFICER], { rolesCheckedAt: minutesAgo(60) });
		const fetch = discord([]);
		await refreshMembership('r0');
		expect(fetch).not.toHaveBeenCalled();
		expect(stored('r0').roles).toEqual([OFFICER]);
	});

	it('un rôle retiré sur Discord est pris en compte sans reconnexion', async () => {
		setDiscord({ clientId: '111111111111111111', clientSecret: 'secret-secret-123', guildId: '222222222222222222', botToken: 'b' });
		setAccess({ mode: 'mapped-roles' });
		createUser('r1', [OFFICER], { rolesCheckedAt: minutesAgo(60) });
		expect(permissionFor(stored('r1'))).toBe('officer');

		discord([MEMBER]);
		await refreshMembership('r1');
		expect(stored('r1')).toMatchObject({ roles: [MEMBER], inGuild: true });
		expect(permissionFor(stored('r1'))).toBe('member');
	});

	it('exclu du serveur : plus d’accès', async () => {
		createUser('r2', [MEMBER], { rolesCheckedAt: minutesAgo(60) });
		discord(null);
		await refreshMembership('r2');
		expect(stored('r2')).toMatchObject({ roles: [], inGuild: false });
		expect(permissionFor(stored('r2'))).toBeNull();
	});

	it('relu au plus toutes les 10 minutes', async () => {
		createUser('r3', [MEMBER], { rolesCheckedAt: minutesAgo(2) });
		const fetch = discord([]);
		await refreshMembership('r3');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('Discord indisponible : on garde le cache, sans bloquer le joueur', async () => {
		createUser('r4', [MEMBER], { rolesCheckedAt: minutesAgo(60) });
		// Serveur inconnu du bot (mauvais réglage) : ce n'est pas une exclusion.
		vi.stubGlobal('fetch', async () => Response.json({ message: 'Unknown Guild', code: 10004 }, { status: 404 }));
		await refreshMembership('r4');
		expect(stored('r4')).toMatchObject({ roles: [MEMBER], inGuild: true });
		vi.stubGlobal('fetch', async () => new Response('', { status: 502 }));
		await refreshMembership('r4');
		expect(stored('r4')).toMatchObject({ roles: [MEMBER], inGuild: true });
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('fetch failed');
		});
		await refreshMembership('r4');
		expect(stored('r4')).toMatchObject({ roles: [MEMBER], inGuild: true });
	});
});
