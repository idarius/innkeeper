import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createUser, horde } from '../../test/helpers';
import { createCharacter, getCharacter } from './characters';
import { applyImport, ImportError, planImport, readExport } from './game-import';
import { parseSavedVariables, toPlain } from './lua-saved-variables';

horde();

// Fichier produit par addon/test/simulate.lua : l'addon exécuté avec une fausse API WoW.
const fixture = readFileSync('src/test/fixtures/InnkeeperSync.lua', 'utf8');

const sheet = (userId: string, name: string, extra: Record<string, unknown> = {}) =>
	createCharacter(userId, {
		name,
		surname: 'Haal',
		race: 'troll',
		class: 'shaman',
		spec: 'restoration',
		role: 'healer',
		spec2: null,
		role2: null,
		level: 1,
		professions: [],
		recipes: null,
		pve: null,
		pvp: null,
		notes: null,
		isMain: true,
		...extra
	});

describe('lecture des SavedVariables', () => {
	it('lit le format écrit par WoW : clés entre crochets, commentaires, échappements', () => {
		const g = parseSavedVariables('-- en-tête\nA = {\n\t["x"] = "a\\"b\\nc", -- note\n\t[1] = 1,\n\t[2] = -2.5,\n\t["vide"] = nil,\n\tok = true,\n}\nB = "\\195\\169"\n');
		expect(toPlain(g.A)).toEqual({ x: 'a"b\nc', '1': 1, '2': -2.5, vide: null, ok: true });
		expect(typeof g.B).toBe('string');
	});

	it('reconstitue l’UTF-8 écrit octet par octet (\\ddd)', () => {
		// É = \195\137 et é = \195\169, mêlés à des caractères écrits tels quels.
		const g = parseSavedVariables('A = "\\195\\137lise"\nB = "Ça \\195\\169t\\195\\169"\nC = "\\065\\066"\n');
		expect(g.A).toBe('Élise');
		expect(g.B).toBe('Ça été');
		expect(g.C).toBe('AB');
	});

	it('refuse ce qui n’est pas des données (aucune exécution)', () => {
		expect(() => parseSavedVariables('A = os.execute("rm -rf /")')).toThrow();
		expect(() => readExport('Autre = {}')).toThrow(ImportError);
		expect(() => readExport('InnkeeperSyncDB = {}')).toThrow(/vide/);
		// Ancien nom de l'addon, encore accepté.
		expect(readExport(fixture.replace('InnkeeperSyncDB', 'GuildSiteSyncDB')).player?.name).toBe('Drektar');
	});

	it('lit l’export de l’addon', () => {
		const data = readExport(fixture);
		expect(data.player?.name).toBe('Drektar');
		expect(data.roster).toHaveLength(3);
		expect(data.guildProfessions?.find((g) => g.skillLine === 393)?.members[0]).toEqual({ name: 'Krenna', skill: 75 });
		expect(data.professions?.map((p) => p.skillLine)).toEqual([164, 356]);
	});
});

describe('import des données du jeu', () => {
	it('met à jour niveau, métiers, dernière connexion et recettes, liste les membres sans fiche', () => {
		createUser('u1');
		createUser('u2');
		const drektar = sheet('u1', 'Drektar', { professions: [{ id: 'herbalism', level: 10 }] });
		const krenna = sheet('u2', 'Krenna', { class: 'hunter', spec: 'beast-mastery', role: 'ranged', race: 'troll' });

		const plan = planImport(readExport(fixture));
		const v = plan.updates.find((u) => u.characterId === drektar.id)!;
		expect(v.level).toEqual({ from: 1, to: 42 });
		// Forge (guilde + perso) et Pêche (perso) ajoutées ; Herboristerie gardée (2 principaux au plus).
		expect(v.professions?.to).toEqual([
			{ id: 'blacksmithing', level: 150 },
			{ id: 'herbalism', level: 10 },
			{ id: 'fishing', level: 80 }
		]);
		expect(v.recipes).toEqual([{ profession: 'blacksmithing', skill: 150, recipes: [{ id: 2662, name: 'Ceinture en cuivre' }, { id: 2663, name: 'Bracelets en cuivre' }] }]);
		// En ligne au moment de l'export.
		expect(v.lastOnlineAt?.getTime()).toBe(1793500000 * 1000);

		const p = plan.updates.find((u) => u.characterId === krenna.id)!;
		expect(p.professions?.to).toEqual([
			{ id: 'leatherworking', level: 60 },
			{ id: 'skinning', level: 75 }
		]);
		// Hors ligne depuis 3 jours et 5 heures.
		expect(p.lastOnlineAt?.getTime()).toBe((1793500000 - (3 * 24 + 5) * 3600) * 1000);
		expect(p.recipes).toBeUndefined();

		expect(plan.withoutSheet).toEqual([{ name: 'Inconnu', level: 9, class: 'Démoniste', rank: 'Recrue' }]);

		expect(applyImport(plan)).toBe(2);
		const saved = getCharacter(drektar.id)!;
		expect(saved.level).toBe(42);
		expect(saved.knownRecipes?.[0].recipes).toHaveLength(2);
		expect(saved.gameSyncedAt).toBeInstanceOf(Date);
	});

	it('un second import identique ne change plus rien', () => {
		const plan = planImport(readExport(fixture));
		expect(plan.updates.every((u) => !u.level && !u.professions)).toBe(true);
	});

	it('deux fiches du même nom : pas de mise à jour, signalé', () => {
		createUser('u3');
		sheet('u3', 'Krenna', { class: 'hunter', spec: 'survival', role: 'ranged', isMain: true });
		expect(planImport(readExport(fixture)).ambiguous).toContain('Krenna');
	});
});

describe('présence en jeu des persos', () => {
	it('repère les fiches absentes de la guilde, puis classe chaque perso après l’import', async () => {
		const { gameStatus } = await import('$lib/game-status');
		const { getGameImport } = await import('./settings');
		createUser('u5');
		const absent = sheet('u5', 'Fantomas');

		const plan = planImport(readExport(fixture));
		expect(plan.notFound.map((n) => n.name)).toEqual(['Fantomas']);
		// Krenna est porté par deux fiches (test précédent) : ambigu, pas « introuvable ».
		expect(plan.notFound.some((n) => n.name === 'Krenna')).toBe(false);

		applyImport(plan);
		const at = new Date(getGameImport()!.appliedAt * 1000);

		const drektar = planImport(readExport(fixture)).updates.find((u) => u.name === 'Drektar')!;
		expect(gameStatus(getCharacter(drektar.characterId)!, at)).toBe('seen');
		expect(gameStatus(getCharacter(absent.id)!, at)).toBe('missing');
		// Fiche créée après l'import : pas encore vérifiable.
		expect(gameStatus({ gameSyncedAt: null, createdAt: new Date(at.getTime() + 60_000) }, at)).toBe('pending');
		// Aucun import : pas de badge.
		expect(gameStatus(getCharacter(absent.id)!, null)).toBeNull();
	});

	it('un export sans registre de guilde ne déplace pas la référence', async () => {
		const { getGameImport } = await import('./settings');
		const before = getGameImport();
		const data = readExport(fixture);
		applyImport(planImport({ ...data, roster: undefined, guildProfessions: undefined }));
		expect(getGameImport()).toEqual(before);
	});
});

describe('ordre des exports', () => {
	// Export minimal : Zuljin dans le registre, à une date et un niveau donnés.
	const exportAt = (exportedAt: number, level: number) => ({
		format: 1,
		exportedAt,
		roster: [{ name: 'Zuljin', level, class: 'SHAMAN', rank: 'Membre', offline: { days: 1 } }]
	});

	it('un export plus ancien que les données de la fiche ne les remplace pas', () => {
		createUser('u6');
		const zuljin = sheet('u6', 'Zuljin');
		applyImport(planImport(exportAt(1793600000, 42)));
		expect(getCharacter(zuljin.id)).toMatchObject({ level: 42 });
		const lastOnline = getCharacter(zuljin.id)!.lastOnlineAt;

		// Fichier de la veille, renvoyé après coup (second compte WoW, export d'un autre joueur…).
		const old = planImport(exportAt(1793500000, 20));
		expect(old.outdated).toEqual(['Zuljin']);
		expect(old.updates.find((u) => u.characterId === zuljin.id)).toEqual({ characterId: zuljin.id, name: 'Zuljin', player: 'Joueur u6', outdated: true });
		expect(applyImport(old)).toBe(0);
		expect(getCharacter(zuljin.id)).toMatchObject({ level: 42, lastOnlineAt: lastOnline });

		// Un export plus récent passe.
		applyImport(planImport(exportAt(1793700000, 43)));
		expect(getCharacter(zuljin.id)).toMatchObject({ level: 43 });
	});

	it('les recettes d’un export plus ancien s’ajoutent quand même, sans rien retirer', () => {
		createUser('u7');
		const voljin = sheet('u7', 'Voljin');
		const forge = (list: { id: number; name: string }[]) => ({ skill164: { skillLine: 164, skill: 150, list } });
		const own = (exportedAt: number, list: { id: number; name: string }[]) => ({ format: 1, exportedAt, player: { name: 'Voljin', level: 30 }, recipes: forge(list) });
		applyImport(planImport(own(1793500000, [{ id: 2662, name: 'Ceinture en cuivre' }])));
		// Registre de guilde plus récent, envoyé par un officier : il ne contient aucune recette.
		applyImport(planImport({ format: 1, exportedAt: 1793600000, roster: [{ name: 'Voljin', level: 31, class: 'SHAMAN', rank: 'Membre', offline: { days: 0 } }] }));

		// Export du joueur arrivé en retard : niveau ignoré, mais la recette apprise entre-temps est gardée.
		const late = planImport(own(1793550000, [{ id: 2662, name: 'Ceinture en cuivre' }, { id: 2663, name: 'Bracelets en cuivre' }]));
		expect(late.outdated).toEqual(['Voljin']);
		applyImport(late);
		const saved = getCharacter(voljin.id)!;
		expect(saved.level).toBe(31);
		expect(saved.knownRecipes?.[0].recipes.map((r) => r.id)).toEqual([2662, 2663]);
		// Le même fichier renvoyé n'apporte plus rien.
		expect(planImport(own(1793550000, [{ id: 2663, name: 'Bracelets en cuivre' }])).updates[0].recipes).toBeUndefined();
	});

	it('un registre plus ancien que le dernier importé ne déplace pas la référence « vu en jeu »', async () => {
		const { getGameImport } = await import('./settings');
		const before = getGameImport();
		applyImport(planImport(exportAt(1793400000, 10)));
		expect(getGameImport()).toEqual(before);
	});
});
