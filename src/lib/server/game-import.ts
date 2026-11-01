import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLASSES, MAX_PRIMARY_PROFESSIONS, MAX_PROFESSION_LEVEL, PROFESSIONS } from '$lib/game/forever';
import { db, schema } from './db';
import type { Character, KnownRecipes, ProfessionEntry } from './db/schema';
import { parseSavedVariables, toPlain } from './lua-saved-variables';
import { getGameImport, setGameImport } from './settings';

// Import de l'export de l'addon InnkeeperSync : met à jour niveau, métiers, dernière
// connexion en jeu et recettes des fiches du site, en reliant les persos par leur nom
// (Forever n'a pas de royaumes).

const name = z.string().trim().min(1).max(40);
const count = z.number().int().min(0).max(10_000);

const exportSchema = z.object({
	format: z.number().int(),
	exportedAt: z.number().int().positive(),
	player: z.object({ name, level: z.number().int().optional(), guild: z.string().nullish() }).optional(),
	roster: z
		.array(
			z.object({
				name,
				level: z.number().int().min(1).max(100),
				class: z.string().nullish(),
				rank: z.string().nullish(),
				online: z.boolean().optional(),
				offline: z.object({ years: count, months: count, days: count, hours: count }).partial().optional()
			})
		)
		.optional(),
	guildProfessions: z
		.array(
			z.object({
				skillLine: z.number().int().nullish(),
				name: z.string().nullish(),
				members: z.array(z.object({ name, skill: z.number().int().nullish() })).default([])
			})
		)
		.optional(),
	professions: z.array(z.object({ skillLine: z.number().int().nullish(), name: z.string().nullish(), skill: z.number().int().nullish() })).optional(),
	recipes: z
		.record(
			z.string(),
			z.object({
				skillLine: z.number().int().nullish(),
				name: z.string().nullish(),
				skill: z.number().int().nullish(),
				list: z.array(z.object({ id: z.number().int(), name: z.string() })).default([])
			})
		)
		.optional()
});
export type GameExport = z.output<typeof exportSchema>;

export class ImportError extends Error {}

/** Lit le fichier InnkeeperSync.lua déposé. */
export function readExport(source: string): GameExport {
	let globals;
	try {
		globals = parseSavedVariables(source);
	} catch (e) {
		throw new ImportError(`Fichier illisible : ${e instanceof Error ? e.message : e}`);
	}
	// GuildSiteSyncDB : ancien nom de l'addon (avant Innkeeper), encore accepté.
	const db = globals.InnkeeperSyncDB ?? globals.GuildSiteSyncDB;
	if (!db) throw new ImportError('Ce fichier ne vient pas de l’addon InnkeeperSync (InnkeeperSync.lua attendu).');
	const raw = toPlain(db);
	// Une table vide (`{}`) se lit comme une liste vide : rien n'a été exporté.
	if (Array.isArray(raw)) throw new ImportError('L’export est vide : connecte-toi en jeu, tape /innkeeper puis /reload avant de déposer le fichier.');
	const parsed = exportSchema.safeParse(raw);
	if (!parsed.success) throw new ImportError(`Export inattendu : ${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
	return parsed.data;
}

/** Nom de perso comparable : sans royaume, en minuscules, forme Unicode stable. */
export const nameKey = (n: string) => n.replace(/-.*$/, '').normalize('NFC').toLocaleLowerCase('fr');

const professionBySkillLine = (skillLine: number | null | undefined, label: string | null | undefined) =>
	PROFESSIONS.find((p) => p.skillLine === skillLine) ?? PROFESSIONS.find((p) => label && nameKey(p.name) === nameKey(label));

/** Dernière connexion d'après le décalage donné par le jeu (années, mois, jours, heures). */
function lastOnline(exportedAt: number, member: NonNullable<GameExport['roster']>[number]) {
	if (member.online) return new Date(exportedAt * 1000);
	const o = member.offline ?? {};
	const hours = (o.years ?? 0) * 8766 + (o.months ?? 0) * 730.5 + (o.days ?? 0) * 24 + (o.hours ?? 0);
	return new Date(exportedAt * 1000 - hours * 3_600_000);
}

export interface CharacterUpdate {
	characterId: number;
	name: string;
	player: string;
	level?: { from: number; to: number };
	professions?: { from: ProfessionEntry[]; to: ProfessionEntry[] };
	recipes?: KnownRecipes[];
	lastOnlineAt?: Date;
	/** La fiche a des données d'un export plus récent : reconnue en jeu, rien n'est remplacé. */
	outdated?: true;
}

export interface ImportPlan {
	exportedAt: Date;
	guild: string | null;
	updates: CharacterUpdate[];
	/** Membres de la guilde en jeu sans fiche sur le site. */
	withoutSheet: { name: string; level: number; class: string | null; rank: string | null }[];
	/** Noms portés par plusieurs fiches : non mis à jour. */
	ambiguous: string[];
	/** Fiches déjà mises à jour par un export plus récent que celui-ci : non remplacées. */
	outdated: string[];
	/** Fiches du site absentes de la guilde en jeu (seulement si l'export contient le registre). */
	notFound: { characterId: number; name: string; player: string }[];
	rosterSize: number;
}

/**
 * Compare l'export aux fiches. Pour les métiers, le jeu met à jour les niveaux et ajoute
 * ceux qui manquent, sans retirer les autres (l'onglet de guilde n'affiche peut-être pas
 * tous les métiers), sauf s'il faut libérer une place de métier principal.
 */
export function planImport(data: GameExport): ImportPlan {
	const chars = db()
		.select({ c: schema.characters, player: schema.users.displayName })
		.from(schema.characters)
		.innerJoin(schema.users, eq(schema.users.discordId, schema.characters.userId))
		.all();
	const byName = Map.groupBy(chars, (r) => nameKey(r.c.name));

	// Métiers par perso : onglet de guilde, complété par les métiers du joueur qui exporte.
	const professions = new Map<string, ProfessionEntry[]>();
	const addProfession = (who: string, skillLine: number | null | undefined, label: string | null | undefined, skill: number | null | undefined) => {
		const p = professionBySkillLine(skillLine, label);
		if (!p) return;
		const list = professions.get(nameKey(who)) ?? [];
		const level = skill == null ? null : Math.min(Math.max(skill, 1), MAX_PROFESSION_LEVEL);
		const existing = list.find((e) => e.id === p.id);
		if (existing) existing.level = Math.max(existing.level ?? 0, level ?? 0) || null;
		else list.push({ id: p.id, level });
		professions.set(nameKey(who), list);
	};
	for (const group of data.guildProfessions ?? []) for (const m of group.members) addProfession(m.name, group.skillLine, group.name, m.skill);
	if (data.player) for (const p of data.professions ?? []) addProfession(data.player.name, p.skillLine, p.name, p.skill);

	const recipes: KnownRecipes[] = Object.values(data.recipes ?? {})
		.map((r) => ({ profession: professionBySkillLine(r.skillLine, r.name)?.id ?? r.name ?? '?', skill: r.skill ?? null, recipes: r.list }))
		.filter((r) => r.recipes.length);

	const plan: ImportPlan = { exportedAt: new Date(data.exportedAt * 1000), guild: data.player?.guild ?? null, updates: [], withoutSheet: [], ambiguous: [], outdated: [], notFound: [], rosterSize: data.roster?.length ?? 0 };

	const seen = new Set<string>();
	const people = [...(data.roster ?? []).map((m) => ({ name: m.name, member: m })), ...[...professions.keys()].map((n) => ({ name: n, member: undefined }))];
	if (data.player && !people.some((p) => nameKey(p.name) === nameKey(data.player!.name))) people.push({ name: data.player.name, member: undefined });

	for (const { name: who, member } of people) {
		const key = nameKey(who);
		if (seen.has(key)) continue;
		seen.add(key);
		const matches = byName.get(key) ?? [];
		if (matches.length > 1) {
			plan.ambiguous.push(who);
			continue;
		}
		if (matches.length === 0) {
			if (member) plan.withoutSheet.push({ name: who, level: member.level, class: CLASSES.find((c) => c.id === member.class?.toLowerCase())?.name ?? member.class ?? null, rank: member.rank ?? null });
			continue;
		}
		const { c, player } = matches[0];
		const update: CharacterUpdate = { characterId: c.id, name: c.name, player };
		// Fichier renvoyé après coup (autre compte WoW du même PC, export d'un autre joueur…) :
		// les données de la fiche sont plus récentes, on ne revient pas en arrière. Seules ses
		// recettes encore inconnues s'ajoutent : la fiche a pu être mise à jour par un registre
		// de guilde, qui n'en contient pas, et une recette apprise ne se perd pas.
		if (c.gameExportedAt && c.gameExportedAt.getTime() >= plan.exportedAt.getTime()) {
			plan.outdated.push(c.name);
			const added = data.player && nameKey(data.player.name) === key ? addRecipes(c.knownRecipes, recipes) : null;
			plan.updates.push({ ...update, outdated: true, ...(added && { recipes: added }) });
			continue;
		}
		const level = member?.level ?? (data.player && nameKey(data.player.name) === key ? data.player.level : undefined);
		if (level && level !== c.level) update.level = { from: c.level, to: level };
		const profs = professions.get(key);
		const merged = profs && mergeProfessions(c.professions, profs);
		if (merged && !sameProfessions(c.professions, merged)) update.professions = { from: c.professions, to: merged };
		if (data.player && nameKey(data.player.name) === key && recipes.length) update.recipes = mergeRecipes(c.knownRecipes, recipes);
		if (member) update.lastOnlineAt = lastOnline(data.exportedAt, member);
		plan.updates.push(update);
	}
	plan.withoutSheet.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
	// Sans registre (export d'un perso hors guilde…), on ne peut rien dire des absents.
	if (data.roster?.length) {
		const found = new Set(plan.updates.map((u) => u.characterId));
		const ambiguous = new Set(plan.ambiguous.map(nameKey));
		plan.notFound = chars
			.filter(({ c }) => !found.has(c.id) && !ambiguous.has(nameKey(c.name)))
			.map(({ c, player }) => ({ characterId: c.id, name: c.name, player }))
			.sort((a, b) => a.player.localeCompare(b.player) || a.name.localeCompare(b.name));
	}
	return plan;
}

function mergeProfessions(current: ProfessionEntry[], fromGame: ProfessionEntry[]) {
	const isPrimary = (e: ProfessionEntry) => PROFESSIONS.some((p) => p.id === e.id && !p.secondary);
	let kept = current.filter((e) => !fromGame.some((g) => g.id === e.id));
	// Plus de 2 principaux : le perso a changé de métier en jeu, on garde ceux du jeu.
	if ([...kept, ...fromGame].filter(isPrimary).length > MAX_PRIMARY_PROFESSIONS) kept = kept.filter((e) => !isPrimary(e));
	return sortProfessions([...kept, ...fromGame]);
}

const sortProfessions = (list: ProfessionEntry[]) => [...list].sort((a, b) => PROFESSIONS.findIndex((p) => p.id === a.id) - PROFESSIONS.findIndex((p) => p.id === b.id));
const sameProfessions = (a: ProfessionEntry[], b: ProfessionEntry[]) => JSON.stringify(sortProfessions(a)) === JSON.stringify(sortProfessions(b));

/** Les recettes d'un métier exporté remplacent celles déjà connues pour ce métier. */
function mergeRecipes(current: KnownRecipes[] | null, incoming: KnownRecipes[]) {
	const kept = (current ?? []).filter((r) => !incoming.some((i) => i.profession === r.profession));
	return [...kept, ...incoming];
}

/** Recettes d'un export plus ancien : ajoute seulement celles que la fiche ne connaît pas (null si aucune). */
function addRecipes(current: KnownRecipes[] | null, older: KnownRecipes[]) {
	let added = false;
	const result = (current ?? []).map((r) => ({ ...r, recipes: [...r.recipes] }));
	for (const o of older) {
		const known = result.find((r) => r.profession === o.profession);
		if (!known) {
			result.push(o);
			added ||= o.recipes.length > 0;
			continue;
		}
		for (const recipe of o.recipes) {
			if (known.recipes.some((r) => r.id === recipe.id)) continue;
			known.recipes.push(recipe);
			added = true;
		}
	}
	return added ? result : null;
}

/** Applique le plan ; renvoie le nombre de persos modifiés. */
export function applyImport(plan: ImportPlan) {
	let changed = 0;
	// À la seconde : les dates sont stockées en secondes, la comparaison doit tomber juste.
	const now = new Date(Math.floor(Date.now() / 1000) * 1000);
	db().transaction((tx) => {
		for (const u of plan.updates) {
			const values: Partial<Character> = { gameSyncedAt: now };
			if (!u.outdated) values.gameExportedAt = plan.exportedAt;
			if (u.level) values.level = u.level.to;
			if (u.professions) values.professions = u.professions.to;
			if (u.recipes) values.knownRecipes = u.recipes;
			if (u.lastOnlineAt) values.lastOnlineAt = u.lastOnlineAt;
			if (u.level || u.professions || u.recipes) {
				values.updatedAt = now;
				changed++;
			}
			tx.update(schema.characters).set(values).where(eq(schema.characters.id, u.characterId)).run();
		}
	});
	// Référence des badges « vu en jeu » : seulement pour un export qui contient le registre,
	// et pas pour un registre plus ancien que celui déjà retenu.
	const reference = getGameImport();
	const older = reference && Math.floor(plan.exportedAt.getTime() / 1000) < reference.exportedAt;
	if (plan.rosterSize > 0 && !older) setGameImport({ appliedAt: now.getTime() / 1000, exportedAt: Math.floor(plan.exportedAt.getTime() / 1000), rosterSize: plan.rosterSize });
	return changed;
}
