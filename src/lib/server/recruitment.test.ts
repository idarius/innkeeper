import { afterEach, describe, expect, it, vi } from 'vitest';
import { asAdmin, asMember, createUser, horde } from '../../test/helpers';
import { getMain } from './characters';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import type { CharacterDraft } from './db/schema';
import {
	acceptApplication,
	applyBlocker,
	getApplication,
	joinWithToken,
	listApplications,
	pendingCount,
	refuseApplication,
	submitApplication,
	vote,
	voterOf,
	withdrawApplication
} from './recruitment';
import { getRecruitment, recruitmentSchema, setDiscord, setRecruitment } from './settings';

horde();

const draft = (name: string): CharacterDraft => ({
	name,
	surname: null,
	race: 'orc',
	class: 'shaman',
	spec: 'restoration',
	role: 'healer',
	spec2: null,
	role2: null,
	level: 60,
	professions: [],
	recipes: null,
	pve: 'competitive',
	pvp: null,
	notes: null
});
const answers = [{ question: 'Pourquoi nous ?', answer: 'Ambiance' }];
const officer = { id: 'o1', name: 'Drektar' };
const officer2 = { id: 'o2', name: 'Varok' };

describe('candidatures', () => {
	it('une candidature en cours bloque une nouvelle candidature', () => {
		createUser('c1');
		expect(applyBlocker('c1')).toBeNull();
		submitApplication('c1', draft('Thrall'), answers);
		expect(applyBlocker('c1')?.reason).toBe('pending');
		expect(pendingCount()).toBe(1);
	});

	it('après un retrait, on peut repostuler', () => {
		createUser('c2');
		const app = submitApplication('c2', draft('Voljin'), answers);
		withdrawApplication(app);
		expect(applyBlocker('c2')).toBeNull();
	});

	it('un officier a un seul avis par candidature, modifiable', () => {
		const app = listApplications(['pending']).find((a) => a.app.userId === 'c1')!.app;
		vote(app, officer, 1, null);
		vote(app, officer2, -1, 'Peu disponible');
		vote(app, officer2, 1, 'Finalement oui');
		const tally = listApplications(['pending']).find((a) => a.app.id === app.id)!;
		expect([tally.up, tally.down]).toEqual([2, 0]);
	});

	it('acceptée : le perso de la candidature devient le main de la recrue', async () => {
		const app = listApplications(['pending']).find((a) => a.app.userId === 'c1')!.app;
		// Sans bot, l'arrivée sur Discord ne peut pas se faire : la décision est quand même enregistrée.
		const arrival = await acceptApplication(app, officer, 'Bienvenue !');
		expect(arrival?.arrivalError).toMatch(/bot/);
		const saved = getApplication(app.id)!;
		expect(saved.status).toBe('accepted');
		expect(saved.decidedBy).toBe('Drektar');
		expect(getMain('c1')?.name).toBe('Thrall');
		expect(getMain('c1')?.pve).toBe('competitive');
		expect(applyBlocker('c1')?.reason).toBe('accepted');
	});

	it('refusée : délai avant de repostuler, puis à nouveau possible', () => {
		setRecruitment(recruitmentSchema.parse({ reapplyDays: 30 }));
		createUser('c3');
		const app = submitApplication('c3', draft('Rexxar'), answers);
		refuseApplication(app, officer, 'Pas cette fois');
		const blocker = applyBlocker('c3');
		expect(blocker?.reason).toBe('cooldown');
		expect(Math.round((blocker!.until!.getTime() - Date.now()) / 86_400_000)).toBe(30);

		// Refus vieux de 31 jours : plus de blocage.
		db().update(schema.applications).set({ decidedAt: new Date(Date.now() - 31 * 86_400_000) }).run();
		expect(applyBlocker('c3')).toBeNull();
	});

	it('une seule décision par candidature, même si deux officiers valident en même temps', async () => {
		createUser('c4');
		const app = submitApplication('c4', draft('Garrosh'), answers);
		// Les deux officiers ont chargé la candidature quand elle était encore en attente.
		const [first, second] = await Promise.all([acceptApplication(app, officer, null), acceptApplication(app, officer2, null)]);
		expect([first, second].filter(Boolean)).toHaveLength(1);
		expect(db().select().from(schema.characters).where(eq(schema.characters.userId, 'c4')).all()).toHaveLength(1);
		expect(getApplication(app.id)?.decidedBy).toBe('Drektar');

		// Un refus ou un retrait arrivé après coup ne change plus rien.
		expect(refuseApplication(app, officer2, 'Trop tard')).toBe(false);
		withdrawApplication(app);
		expect(getApplication(app.id)?.status).toBe('accepted');
	});

	it('identifie qui vote : officier Discord ou admin local, jamais un simple membre', () => {
		expect(voterOf(asMember('9', 'officer'))).toEqual({ id: '9', name: 'Joueur 9' });
		expect(voterOf(asAdmin())).toEqual({ id: 'admin:1', name: 'admin' });
		expect(voterOf(asMember('9'))).toBeNull();
	});
});

describe('réglages du recrutement', () => {
	it('se relisent à l’identique, salons vides compris (régression)', () => {
		const saved = recruitmentSchema.parse({ arrivalRoleId: '900000000000000005', notifyChannelId: '', reviewDays: '120' });
		setRecruitment(saved);
		expect(getRecruitment()).toEqual(saved);
		expect(getRecruitment().arrivalRoleId).toBe('900000000000000005');
		expect(getRecruitment().notifyChannelId).toBeNull();
	});

	it('refuse un identifiant Discord invalide', () => {
		expect(recruitmentSchema.safeParse({ arrivalRoleId: '901' }).success).toBe(false);
	});
});

describe('entrée directe sur le serveur par le bot', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		db().delete(schema.settings).where(eq(schema.settings.key, 'discord')).run();
	});

	const ARRIVAL = '900000000000000005';
	const setup = (userId: string) => {
		setDiscord({ clientId: '111111111111111111', clientSecret: 's', guildId: '222222222222222222', botToken: 'b' });
		setRecruitment(recruitmentSchema.parse({ arrivalRoleId: ARRIVAL }));
		createUser(userId);
		const app = submitApplication(userId, draft('Rokhan'), answers);
		db().update(schema.applications).set({ status: 'accepted' }).where(eq(schema.applications.id, app.id)).run();
		return getApplication(app.id)!;
	};

	it('fait entrer la recrue avec le rôle d’arrivée et lui ouvre le site', async () => {
		const app = setup('j1');
		const calls: { method: string; url: string; body?: string }[] = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
			calls.push({ method: init.method ?? 'GET', url, body: init.body as string | undefined });
			if (init.method === 'PUT') return new Response(null, { status: 201 });
			if (url.includes('/members/j1')) return Response.json({ roles: [ARRIVAL], nick: null });
			return new Response(null, { status: 204 });
		});
		expect(await joinWithToken(app, 'jeton')).toBeNull();
		const put = calls.find((c) => c.method === 'PUT')!;
		expect(put.url).toMatch(/\/guilds\/222222222222222222\/members\/j1$/);
		expect(JSON.parse(put.body!)).toEqual({ access_token: 'jeton', roles: [ARRIVAL] });
		expect(getApplication(app.id)!.roleAssignedAt).toBeInstanceOf(Date);
		const user = db().select().from(schema.users).where(eq(schema.users.discordId, 'j1')).get()!;
		expect(user.roles).toContain(ARRIVAL);
		expect(user.joinedAt).toBeInstanceOf(Date);
	});

	it('déjà sur le serveur : le rôle est donné à part', async () => {
		const app = setup('j2');
		const puts: string[] = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
			if (init.method === 'PUT') {
				puts.push(url);
				return new Response(null, { status: 204 });
			}
			return Response.json({ roles: [], nick: null });
		});
		expect(await joinWithToken(app, 'jeton')).toBeNull();
		expect(puts.at(-1)).toMatch(new RegExp(`/members/j2/roles/${ARRIVAL}$`));
	});

	it('échec : erreur claire, rien n’est marqué, invitation de secours créée', async () => {
		const app = setup('j3');
		setRecruitment(recruitmentSchema.parse({ arrivalRoleId: ARRIVAL, inviteChannelId: '333333333333333333' }));
		vi.stubGlobal('fetch', async (url: string) =>
			url.endsWith('/invites') ? Response.json({ code: 'secours' }) : new Response(null, { status: 403 })
		);
		expect(await joinWithToken(app, 'jeton')).toMatch(/permission/);
		const saved = getApplication(app.id)!;
		expect(saved.roleAssignedAt).toBeNull();
		expect(saved.inviteUrl).toBe('https://discord.gg/secours');
	});
});
