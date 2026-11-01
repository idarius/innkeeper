import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../test/helpers';
import { recordSeenRoles, updateRole } from './permissions';
import { advancedSettings, createTemplate, getTemplate, nextWeekday, officers, outingSchema, raidHelperDate, templateSchema, today, zonedToUnix } from './outings';
import { activityImageUrl, publishedImage, removeActivityImage, saveActivityImage } from './activity-images';
import { INSTANCES } from '$lib/game/forever';
import { createEvent } from './raidhelper';

describe('dates des sorties', () => {
	it('lit la date et l’heure dans le fuseau de la guilde, heure d’été comprise', () => {
		// 21h à Paris : UTC+1 en hiver, UTC+2 en été.
		expect(zonedToUnix('2026-11-05', '21:00', 'Europe/Paris')).toBe(Date.UTC(2026, 10, 5, 20, 0) / 1000);
		expect(zonedToUnix('2026-07-01', '21:00', 'Europe/Paris')).toBe(Date.UTC(2026, 6, 1, 19, 0) / 1000);
		expect(zonedToUnix('2026-11-05', '21:00', 'America/New_York')).toBe(Date.UTC(2026, 10, 6, 2, 0) / 1000);
	});

	it('propose le prochain jour habituel, aujourd’hui compris', () => {
		// Mardi 27 octobre 2026, 10h à Paris.
		const now = new Date(Date.UTC(2026, 9, 27, 9, 0));
		expect(today('Europe/Paris', now)).toBe('2026-10-27');
		expect(nextWeekday(2, 'Europe/Paris', now)).toBe('2026-10-27');
		expect(nextWeekday(3, 'Europe/Paris', now)).toBe('2026-10-28');
		expect(nextWeekday(1, 'Europe/Paris', now)).toBe('2026-11-02');
	});

	it('convertit au format de date de Raid-Helper', () => {
		expect(raidHelperDate('2026-11-05')).toBe('05-11-2026');
	});
});

describe('modèles de sortie', () => {
	it('valide et enregistre un modèle, champs facultatifs vides compris', () => {
		const parsed = templateSchema.parse({ name: 'Raid du mercredi', title: 'Cœur du Magma', description: '', channelId: '', weekday: '3', time: '21:00', rosterId: '' });
		expect(parsed).toMatchObject({ description: null, channelId: null, weekday: 3, rosterId: null });
		expect(getTemplate(createTemplate(parsed))?.title).toBe('Cœur du Magma');
	});

	it('refuse une heure ou un jour invalides', () => {
		expect(templateSchema.safeParse({ name: 'X1', title: 'Y1', description: '', time: '25:00' }).success).toBe(false);
		expect(templateSchema.safeParse({ name: 'X1', title: 'Y1', description: '', weekday: '8' }).success).toBe(false);
	});
});

describe('chefs de raid possibles', () => {
	it('liste seulement les officiers', () => {
		recordSeenRoles(['111111111111111111', '222222222222222222']);
		updateRole('111111111111111111', { label: null, permission: 'officer' });
		updateRole('222222222222222222', { label: null, permission: 'member' });
		createUser('off', ['111111111111111111']);
		createUser('mem', ['222222222222222222']);
		expect(officers().map((o) => o.id)).toEqual(['off']);
	});
});

describe('création dans Raid-Helper', () => {
	afterEach(() => vi.unstubAllGlobals());
	const event = {
		channelId: '333333333333333333',
		leaderId: '444444444444444444',
		templateId: 'wowforever',
		title: 'MC',
		description: '',
		date: '05-11-2026',
		time: '21:00',
		startTime: 1793908800
	};

	it('poste dans le salon avec la clé API, sans le timestamp dans le corps', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ status: 'success', event: { id: '555', startTime: 1793908800 } });
		});
		expect(await createEvent('666666666666666666', 'cle', event)).toBe('555');
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://raid-helper.dev/api/v4/servers/666666666666666666/channels/333333333333333333/event');
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('cle');
		const body = JSON.parse(calls[0].init.body as string);
		expect(body).toMatchObject({ leaderId: '444444444444444444', templateId: 'wowforever', date: '05-11-2026', time: '21:00' });
		expect(body).not.toHaveProperty('channelId');
		expect(body).not.toHaveProperty('startTime');
	});

	it('corrige l’heure si Raid-Helper a lu la date autrement', async () => {
		const methods: string[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			methods.push(init.method ?? 'GET');
			return Response.json({ status: 'success', event: { id: '555', startTime: 1 } });
		});
		await createEvent('666666666666666666', 'cle', event);
		expect(methods).toEqual(['POST', 'PATCH']);
	});

	it('clé refusée : message clair', async () => {
		vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));
		await expect(createEvent('666666666666666666', 'cle', event)).rejects.toThrow(/Clé API/);
	});
});

describe('sorties à venir trouvées par le bot', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('garde les événements Raid-Helper à venir du serveur, ignore le reste', async () => {
		const { setDiscord } = await import('./settings');
		const { upcomingOutings } = await import('./outings');
		setDiscord({ clientId: '111111111111111111', clientSecret: 'secret-secret-123', guildId: '222222222222222222', botToken: 'b' });
		const future = Math.floor(Date.now() / 1000) + 86400;
		const rhCalls: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			if (url.endsWith('/guilds/222222222222222222/channels'))
				return Response.json([
					{ id: '10', name: 'raids', type: 0, position: 1 },
					{ id: '11', name: 'officiers', type: 0, position: 2 }
				]);
			if (url.includes('/channels/10/messages'))
				return Response.json([
					{ id: '900000000000000001', author: { id: 'rh', bot: true } },
					{ id: '900000000000000002', author: { id: 'mee6', bot: true } },
					{ id: '900000000000000003', author: { id: 'joueur' } }
				]);
			if (url.includes('/channels/11/messages')) return new Response(null, { status: 403 });
			rhCalls.push(url);
			if (url.endsWith('/events/900000000000000001'))
				return Response.json({
					id: '900000000000000001',
					serverId: '222222222222222222',
					title: 'MC',
					startTime: future,
					channelId: '10',
					leaderName: 'Varok',
					signUps: [{ className: 'Tank' }, { className: 'Healer' }, { className: 'Absence' }]
				});
			return new Response(null, { status: 404 });
		});
		const { events, source } = await upcomingOutings();
		expect(source).toBe('bot');
		expect(events).toEqual([{ id: '900000000000000001', title: 'MC', startTime: future, channelId: '10', channelName: 'raids', leaderName: 'Varok', signUpCount: 2, image: null }]);
		// Le message d'un joueur n'est jamais demandé à Raid-Helper.
		expect(rhCalls.some((u) => u.endsWith('900000000000000003'))).toBe(false);
	});
});

describe('types de sortie et instances', () => {
	it('fixe places et durée selon le type et l’instance', () => {
		expect(advancedSettings('raid', 'onyxia', null)).toEqual({ font_style: 'none', create_discordevent: false, limit: 40, duration: 180 });
		expect(advancedSettings('dungeon', 'stratholme', 'https://x/img.png')).toEqual({ font_style: 'none', create_discordevent: false, limit: 5, duration: 120, image: 'https://x/img.png' });
		expect(advancedSettings('quests', null, null)).toEqual({ font_style: 'none', create_discordevent: false, limit: 5, duration: 120 });
		expect(advancedSettings('pvp', null, null)).toEqual({ font_style: 'none', create_discordevent: false, duration: 120 });
		expect(advancedSettings(null, null, null)).toEqual({ font_style: 'none', create_discordevent: false });
		expect(advancedSettings('raid', 'onyxia', null, true)).toMatchObject({ create_discordevent: true });
	});

	it('refuse une instance qui ne correspond pas au type', () => {
		const base = { title: 'MC', description: '', date: '2026-11-05', time: '21:00', channelId: '333333333333333333', leaderId: '444444444444444444' };
		expect(outingSchema.safeParse({ ...base, activity: 'raid', instanceId: 'onyxia' }).success).toBe(true);
		expect(outingSchema.safeParse({ ...base, activity: 'dungeon', instanceId: 'onyxia' }).success).toBe(false);
		expect(outingSchema.safeParse({ ...base, activity: 'raid', instanceId: 'inconnue' }).success).toBe(false);
		expect(outingSchema.safeParse({ ...base, activity: '', instanceId: '' }).data).toMatchObject({ activity: null, instanceId: null });
	});

	it('catalogue cohérent : identifiants uniques, tranches de niveau valides', () => {
		expect(new Set(INSTANCES.map((i) => i.id)).size).toBe(INSTANCES.length);
		for (const i of INSTANCES) expect(i.levels[0] <= i.levels[1] && i.levels[1] <= 60).toBe(true);
		for (const i of INSTANCES.filter((x) => x.opensOn)) expect(Number.isNaN(Date.parse(i.opensOn!))).toBe(false);
	});

	it('libellé : niveaux, taille hors groupe de 5, nouveauté et date d’ouverture', async () => {
		const { instanceLabel, getInstance } = await import('$lib/activities');
		expect(instanceLabel(getInstance('hall-of-thanes')!)).toBe('Hall of Thanes (niveaux 13 à 18) · nouveau');
		expect(instanceLabel(getInstance('hyjal-summit')!)).toBe('Hyjal Summit (niveau 60, 20 joueurs) · nouveau · dès le 9 déc.');
		expect(instanceLabel(getInstance('deadmines')!)).toBe('Les Mortemines (niveaux 17 à 26)');
	});
});

describe('images des sorties', () => {
	// Signature PNG suivie de zéros : assez pour passer pour une image.
	const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const png = (bytes = 10) => {
		const data = new Uint8Array(Math.max(bytes, PNG.length));
		data.set(PNG);
		return new File([data], 'a.png', { type: 'image/png' });
	};

	it('l’image de l’instance passe avant celle du type', async () => {
		process.env.ORIGIN = 'https://guilde.test';
		expect(await saveActivityImage('activity:raid', png())).toBeNull();
		expect(activityImageUrl('raid', 'onyxia')).toMatch(/^https:\/\/guilde\.test\/images\/sorties\/sortie-activity-raid-\d+\.png$/);
		expect(await saveActivityImage('instance:onyxia', png())).toBeNull();
		expect(activityImageUrl('raid', 'onyxia')).toMatch(/sortie-instance-onyxia-/);
		removeActivityImage('instance:onyxia');
		expect(activityImageUrl('raid', 'onyxia')).toMatch(/sortie-activity-raid-/);
	});

	it('refuse clé inconnue, format et taille, et ne sert que les fichiers enregistrés', async () => {
		expect(await saveActivityImage('instance:inconnue', png())).toMatch(/inconnue/);
		expect(await saveActivityImage('activity:pvp', new File(['x'], 'a.gif', { type: 'image/gif' }))).toMatch(/Format/);
		expect(await saveActivityImage('activity:pvp', png(3 * 1024 * 1024))).toMatch(/lourde/);
		// Type annoncé par le navigateur, mais contenu d'un autre genre (page HTML renommée…).
		expect(await saveActivityImage('activity:pvp', new File(['<html><script>alert(1)</script>'], 'a.png', { type: 'image/png' }))).toMatch(/Format/);
		expect(await saveActivityImage('activity:pvp', new File([new Uint8Array(10)], 'a.webp', { type: 'image/webp' }))).toMatch(/Format/);
		expect(publishedImage('../guilde.db')).toBeUndefined();
	});
});

describe('réglages ignorés par Raid-Helper à la création', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('réapplique places et image si l’événement créé ne les a pas', async () => {
		const calls: { method: string; body: unknown }[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			calls.push({ method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : null });
			return Response.json({ status: 'success', event: { id: '555', startTime: 1793908800, advancedSettings: { limit: 9999, image: 'none', duration: 120 } } });
		});
		await createEvent('666666666666666666', 'cle', {
			channelId: '333333333333333333', leaderId: '444444444444444444', templateId: 'wowforever', title: 'MC', description: '',
			date: '05-11-2026', time: '21:00', startTime: 1793908800,
			advancedSettings: { limit: 40, duration: 120, image: 'https://x/mc.png' }
		});
		expect(calls[0].body).toMatchObject({ advancedSettings: { limit: 40, image: 'https://x/mc.png' } });
		expect(calls[1]).toEqual({ method: 'PATCH', body: { advancedSettings: { limit: 40, image: 'https://x/mc.png' } } });
	});
});

describe('suppression d’une sortie', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('vérifie que l’événement a disparu, quelle que soit la réponse de Raid-Helper', async () => {
		const { deleteEvent } = await import('./raidhelper');
		let exists = true;
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
			if (init.method === 'DELETE') {
				exists = false;
				return Response.json({ error: 'invalid json' }, { status: 400 });
			}
			return exists ? Response.json({ id: '777', serverId: '1', title: 'MC', startTime: 0, signUps: [] }) : new Response(null, { status: 404 });
		});
		expect(await deleteEvent('777', 'cle')).toBe(true);
	});

	it('signale un échec si l’événement existe toujours', async () => {
		const { deleteEvent } = await import('./raidhelper');
		vi.stubGlobal('fetch', async () => Response.json({ id: '778', serverId: '1', title: 'MC', startTime: 0, signUps: [] }));
		expect(await deleteEvent('778', 'cle')).toBe(false);
	});
});

describe('modification d’une sortie', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('relit l’événement et signale les champs non pris en compte', async () => {
		const { editEvent } = await import('./raidhelper');
		const stored = { id: '880', serverId: '1', title: 'Onixya', description: '', startTime: 100, leaderId: '444444444444444444', signUps: [] };
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
			if (init.method === 'PATCH') {
				// Raid-Helper applique tout sauf le chef de raid, et répond une erreur quand même.
				const { leaderId: _ignored, ...rest } = JSON.parse(init.body as string);
				Object.assign(stored, rest);
				return Response.json({ error: 'invalid json' }, { status: 400 });
			}
			return Response.json(stored);
		});
		const failed = await editEvent('880', 'cle', { title: 'Onyxia', description: 'Prévoir potions', startTime: 200, leaderId: '555555555555555555' });
		expect(stored).toMatchObject({ title: 'Onyxia', description: 'Prévoir potions', startTime: 200 });
		expect(failed).toEqual(['leaderId']);
	});

	it('convertit l’heure de début dans le fuseau de la guilde, aller-retour', async () => {
		const { unixToZoned } = await import('./outings');
		expect(unixToZoned(zonedToUnix('2026-11-05', '21:00', 'Europe/Paris'), 'Europe/Paris')).toEqual({ date: '2026-11-05', time: '21:00' });
		expect(unixToZoned(zonedToUnix('2026-07-01', '00:30', 'Europe/Paris'), 'Europe/Paris')).toEqual({ date: '2026-07-01', time: '00:30' });
	});
});

describe('sorties des membres', () => {
	it('le créateur gère sa sortie, un autre membre non, un officier toujours', async () => {
		const { recordOuting, canManageOuting } = await import('./outings');
		const { asMember, asAdmin } = await import('../../test/helpers');
		recordOuting({ eventId: 'ev-m1', kind: 'member', createdBy: 'm1', title: 'BRD', activity: 'dungeon', instanceId: 'blackrock-depths', startTime: new Date(Date.now() + 86_400_000) });
		expect(canManageOuting(asMember('m1'), 'ev-m1')).toBe(true);
		expect(canManageOuting(asMember('m2'), 'ev-m1')).toBe(false);
		expect(canManageOuting(asMember('o1', 'officer'), 'ev-m1')).toBe(true);
		expect(canManageOuting(asAdmin(), 'ev-m1')).toBe(true);
		// Sortie inconnue du site (créée directement dans Raid-Helper) : officiers seulement.
		expect(canManageOuting(asMember('m1'), 'ev-inconnu')).toBe(false);
	});

	it('compte seulement les sorties membres encore à venir', async () => {
		const { recordOuting, upcomingMemberOutings } = await import('./outings');
		const soon = new Date(Date.now() + 3_600_000);
		recordOuting({ eventId: 'ev-m2', kind: 'member', createdBy: 'm3', title: 'Quêtes', activity: 'quests', instanceId: null, startTime: soon });
		recordOuting({ eventId: 'ev-m3', kind: 'member', createdBy: 'm3', title: 'Farm', activity: 'farm', instanceId: null, startTime: soon });
		recordOuting({ eventId: 'ev-m4', kind: 'member', createdBy: 'm3', title: 'Passée', activity: 'farm', instanceId: null, startTime: new Date(Date.now() - 3_600_000) });
		recordOuting({ eventId: 'ev-o1', kind: 'official', createdBy: 'm3', title: 'Raid', activity: 'raid', instanceId: 'onyxia', startTime: soon });
		expect(upcomingMemberOutings('m3')).toBe(2);
	});

	it('les membres ne proposent pas de raid', async () => {
		const { memberActivityAllowed } = await import('./outings');
		expect(memberActivityAllowed('raid')).toBe(false);
		expect(memberActivityAllowed('dungeon')).toBe(true);
		expect(memberActivityAllowed(null)).toBe(true);
	});
});

describe('refus de Raid-Helper', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('distingue une clé refusée d’un autre refus, et garde la raison', async () => {
		const { deleteEvent } = await import('./raidhelper');
		vi.stubGlobal('fetch', async () => Response.json({ error: 'missing permissions' }, { status: 403 }));
		await expect(deleteEvent('881', 'cle')).rejects.toThrow(/« missing permissions »/);
		vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid api key' }, { status: 401 }));
		await expect(deleteEvent('881', 'cle')).rejects.toThrow(/Clé API/);
	});
});
