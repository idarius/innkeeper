import { count, eq } from 'drizzle-orm';
import { CLASSES, MAX_LEVEL, PROFESSIONS, racesFor } from '$lib/game/forever';
import { gameStatus } from '$lib/game-status';
import { ROLES, type Role } from '$lib/roles';
import { db, schema } from './db';
import { permissionFor } from './permissions';
import { getGameImport, getGuild } from './settings';

/** Chiffres anonymes de la guilde pour l'accueil public : aucun nom, seulement des comptes. */
export function publicStats() {
	const players = db()
		.select({ roles: schema.users.roles, inGuild: schema.users.inGuild })
		.from(schema.users)
		.all()
		.filter((u) => permissionFor(u)).length;
	const characters = db().select({ n: count() }).from(schema.characters).get()?.n ?? 0;
	// Répartition sur les mains : un joueur compte une fois.
	const mains = db()
		.select({ class: schema.characters.class, role: schema.characters.role })
		.from(schema.characters)
		.where(eq(schema.characters.isMain, true))
		.all();

	const byRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
	const byClass: Record<string, number> = {};
	for (const m of mains) {
		byRole[m.role]++;
		byClass[m.class] = (byClass[m.class] ?? 0) + 1;
	}
	return { players, characters, mains: mains.length, byRole, byClass };
}

const DAY = 24 * 3600 * 1000;
// Tranches de niveau, la dernière étant le niveau maximum.
export const LEVEL_BANDS = [
	{ label: '1-19', min: 1, max: 19 },
	{ label: '20-39', min: 20, max: 39 },
	{ label: '40-59', min: 40, max: MAX_LEVEL - 1 },
	{ label: `${MAX_LEVEL}`, min: MAX_LEVEL, max: MAX_LEVEL }
] as const;

type Counts = Record<Role, number>;
const zero = () => Object.fromEntries(ROLES.map((r) => [r, 0])) as Counts;

/**
 * Statistiques des officiers : composition, métiers, niveaux, activité et fiches à compléter.
 * Seuls les joueurs qui ont encore accès au site comptent (un ancien membre ne fausse pas les chiffres).
 */
export function officerStats(now = new Date()) {
	const members = db()
		.select()
		.from(schema.users)
		.all()
		.filter((u) => permissionFor(u));
	const ids = new Set(members.map((u) => u.discordId));
	const chars = db()
		.select()
		.from(schema.characters)
		.all()
		.filter((c) => ids.has(c.userId));
	const mains = chars.filter((c) => c.isMain);
	const faction = getGuild()?.faction ?? 'both';
	const recruitment: { open: boolean; classes: string[]; roles: Role[] } = getGuild()?.recruitment ?? { open: false, classes: [], roles: [] };

	// Composition : classes jouables dans la faction, mains par rôle, rerolls et spés secondaires à part.
	const playable = new Set(racesFor(faction).flatMap((r) => r.classes));
	const classes = CLASSES.filter((c) => playable.has(c.id)).map((c) => {
		const ofClass = chars.filter((k) => k.class === c.id);
		const byRole = zero();
		for (const m of ofClass.filter((k) => k.isMain)) byRole[m.role]++;
		return {
			id: c.id,
			mains: ofClass.filter((k) => k.isMain).length,
			rerolls: ofClass.filter((k) => !k.isMain).length,
			byRole,
			wanted: recruitment.classes.includes(c.id)
		};
	});

	const roles = ROLES.map((r) => ({
		role: r,
		mains: mains.filter((m) => m.role === r).length,
		// Mains capables de passer à ce rôle avec leur spé secondaire.
		offspec: mains.filter((m) => m.role !== r && m.role2 === r).length,
		rerolls: chars.filter((k) => !k.isMain && (k.role === r || k.role2 === r)).length,
		wanted: recruitment.roles.includes(r)
	}));

	// Métiers : tous les persos comptent (un reroll artisan sert autant qu'un main).
	const professions = PROFESSIONS.map((p) => {
		const holders = chars
			.flatMap((k) => k.professions.filter((e) => e.id === p.id).map((e) => ({ id: k.id, userId: k.userId, name: k.name, level: e.level })))
			.sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
		return { id: p.id, secondary: p.secondary, count: holders.length, best: holders[0]?.level ?? null, top: holders.slice(0, 3) };
	});

	const levels = LEVEL_BANDS.map((b) => ({ label: b.label, mains: mains.filter((m) => m.level >= b.min && m.level <= b.max).length }));

	const interests = (['pve', 'pvp'] as const).map((axis) => ({
		axis,
		competitive: mains.filter((m) => m[axis] === 'competitive').length,
		casual: mains.filter((m) => m[axis] === 'casual').length,
		none: mains.filter((m) => !m[axis]).length
	}));

	// Activité : dernière connexion au site, et présence au dernier import du registre de guilde.
	const since = (d: Date | null) => (d ? (now.getTime() - d.getTime()) / DAY : Infinity);
	const gameImport = getGameImport();
	const lastImportAt = gameImport ? new Date(gameImport.appliedAt * 1000) : null;
	const activity = {
		week: members.filter((u) => since(u.lastLogin) <= 7).length,
		month: members.filter((u) => since(u.lastLogin) > 7 && since(u.lastLogin) <= 30).length,
		older: members.filter((u) => since(u.lastLogin) > 30).length,
		seenInGame: lastImportAt ? mains.filter((m) => gameStatus(m, lastImportAt) === 'seen').length : null,
		inactive: members
			.filter((u) => since(u.lastLogin) > 30)
			.map((u) => ({ id: u.discordId, displayName: u.displayName, lastLogin: u.lastLogin }))
			.sort((a, b) => (a.lastLogin?.getTime() ?? 0) - (b.lastLogin?.getTime() ?? 0))
	};

	// Fiches à compléter, par joueur, avec ce qui manque.
	const incomplete = members
		.map((u) => {
			const own = chars.filter((k) => k.userId === u.discordId);
			const main = own.find((k) => k.isMain);
			const missing: string[] = [];
			if (!own.length) missing.push('aucun perso');
			else {
				if (own.some((k) => !k.surname)) missing.push('nom de famille');
				if (main && !main.spec) missing.push('spé du main');
				if (main && !main.professions.length) missing.push('métiers du main');
				if (main && !main.pve && !main.pvp) missing.push('intérêts du main');
			}
			return { id: u.discordId, displayName: u.displayName, missing };
		})
		.filter((p) => p.missing.length)
		.sort((a, b) => b.missing.length - a.missing.length || a.displayName.localeCompare(b.displayName));

	return {
		totals: {
			members: members.length,
			withCharacters: new Set(chars.map((k) => k.userId)).size,
			characters: chars.length,
			mains: mains.length,
			maxLevel: mains.filter((m) => m.level === MAX_LEVEL).length
		},
		recruitmentOpen: recruitment.open,
		classes,
		roles,
		professions,
		levels,
		interests,
		activity,
		incomplete
	};
}
export type OfficerStats = ReturnType<typeof officerStats>;
