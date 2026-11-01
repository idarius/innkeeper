import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../test/helpers';
import { db, schema } from './db';
import { dueReviewCount, listNewcomers, markReviewed, setJoinedAt } from './progression';
import { recruitmentSchema, setDiscord, setRecruitment } from './settings';

const SANG_NEUF = '900000000000000005';
const BRISEUR = '900000000000000003';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

setRecruitment(recruitmentSchema.parse({ arrivalRoleId: SANG_NEUF, reviewDays: 90 }));
createUser('ancien', [SANG_NEUF], { createdAt: daysAgo(200), joinedAt: daysAgo(100) });
createUser('recent', [SANG_NEUF], { createdAt: daysAgo(10), joinedAt: daysAgo(10) });
// Arrivé avant le site : la première connexion sert de date d'arrivée.
createUser('sansdate', [SANG_NEUF], { createdAt: daysAgo(120) });
createUser('promu', [BRISEUR], { createdAt: daysAgo(300), joinedAt: daysAgo(300) });

describe('progression des nouveaux membres', () => {
	it('liste les porteurs du rôle d’arrivée et signale ceux qui dépassent le délai', async () => {
		const list = await listNewcomers();
		expect(list.map((n) => n.id)).toEqual(['sansdate', 'ancien', 'recent']);
		expect(list.filter((n) => n.due).map((n) => n.id).sort()).toEqual(['ancien', 'sansdate']);
		expect(list.find((n) => n.id === 'sansdate')?.arrivalKnown).toBe(false);
		expect(dueReviewCount()).toBe(2);
	});

	it('« revu » repousse le rappel de 30 jours', async () => {
		markReviewed('ancien', 'Vu deux fois');
		expect(dueReviewCount()).toBe(1);
		expect((await listNewcomers()).find((n) => n.id === 'ancien')?.reviewNote).toBe('Vu deux fois');
	});

	it('une date d’arrivée corrigée est prise en compte', async () => {
		setJoinedAt('recent', daysAgo(95));
		expect((await listNewcomers()).find((n) => n.id === 'recent')?.due).toBe(true);
		expect(dueReviewCount()).toBe(2);
	});

	it('sans rôle d’arrivée choisi, personne n’est suivi', async () => {
		setRecruitment(recruitmentSchema.parse({}));
		expect(await listNewcomers()).toEqual([]);
		expect(dueReviewCount()).toBe(0);
	});

	describe('avec le bot', () => {
		afterEach(() => vi.unstubAllGlobals());
		const member = (id: string, roles: string[]) => ({ user: { id, username: id }, nick: null, roles, joined_at: '2026-10-01T10:00:00.000Z' });

		it('Discord indisponible : la liste vient du cache', async () => {
			setRecruitment(recruitmentSchema.parse({ arrivalRoleId: SANG_NEUF, reviewDays: 90 }));
			setDiscord({ clientId: '111111111111111111', clientSecret: 'secret-secret-123', guildId: '222222222222222222', botToken: 'b' });
			vi.stubGlobal('fetch', async () => new Response('', { status: 502 }));
			expect((await listNewcomers()).map((n) => n.id).sort()).toEqual(['ancien', 'recent', 'sansdate']);
		});

		it('relit les rôles en une seule requête : promus et partis disparaissent', async () => {
			const fetch = vi.fn(async () => Response.json([member('ancien', [SANG_NEUF]), member('recent', [BRISEUR])]));
			vi.stubGlobal('fetch', fetch);
			expect((await listNewcomers()).map((n) => n.id)).toEqual(['ancien']);
			expect(fetch).toHaveBeenCalledTimes(1);
			// Le cache est mis à jour : « sansdate », à revoir, est parti, et « ancien » a déjà été revu.
			expect(dueReviewCount()).toBe(0);
			// Parti du serveur : il perd aussi l'accès au site.
			const inGuild = (id: string) => db().select().from(schema.users).where(eq(schema.users.discordId, id)).get()?.inGuild;
			expect(inGuild('sansdate')).toBe(false);
			expect(inGuild('recent')).toBe(true);
		});
	});
});
