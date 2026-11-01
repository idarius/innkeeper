import { z } from 'zod';
import { RAID_HELPER, toRaidHelper } from '$lib/game/forever';
import { listCharacters } from './characters';
import type { Character } from './db/schema';
import { addSignup, deleteSignup, editSignup, fetchEvent, RaidHelperError, type RaidHelperEvent, type SignUpInput } from './raidhelper';

// Inscription à une sortie depuis le site : le site inscrit le membre dans Raid-Helper,
// qui reste la seule liste d'inscrits.

/**
 * Statuts proposés ; `present` inscrit le perso dans son rôle, les autres sont des catégories
 * Raid-Helper. Le remplaçant garde sa spé : les officiers voient quel rôle il peut tenir.
 */
export const SIGNUP_STATUSES = { present: 'Présent', Bench: 'Remplaçant (dispo si besoin)', Tentative: 'Peut-être', Late: 'En retard', Absence: 'Absent' } as const;
export type SignupStatus = keyof typeof SIGNUP_STATUSES;

export const signupSchema = z.object({
	characterId: z.coerce.number().int().positive('Choisis un perso'),
	slot: z.enum(['main', 'second']).default('main'),
	status: z.enum(Object.keys(SIGNUP_STATUSES) as [SignupStatus, ...SignupStatus[]])
});

/** Ce qu'on envoie à Raid-Helper pour un perso, une spé (principale ou secondaire) et un statut. */
export function signupPayload(c: Pick<Character, 'name' | 'class' | 'spec' | 'role' | 'spec2' | 'role2'>, slot: 'main' | 'second', status: SignupStatus): SignUpInput {
	if (status !== 'present' && status !== 'Bench') return { className: status, name: c.name };
	const second = slot === 'second' && c.role2;
	const rh = second ? toRaidHelper(c.class, c.spec2, c.role2!) : toRaidHelper(c.class, c.spec, c.role);
	return { className: status === 'Bench' ? 'Bench' : rh.className, ...(rh.specName ? { specName: rh.specName } : {}), name: c.name };
}

/** Inscription actuelle du membre (une seule par événement), ou null. */
export const mySignup = (event: RaidHelperEvent, userId: string) => event.signUps.find((s) => s.userId === userId) ?? null;

/** Inscription du membre telle que Raid-Helper l'a vraiment enregistrée, relue sans cache. */
async function reread(eventId: string, userId: string) {
	const event = await fetchEvent(eventId);
	return event ? mySignup(event, userId) : null;
}

// Comme sur la page de la sortie : on ne change plus les inscriptions une fois la sortie commencée.
const STARTED = 'Cette sortie a déjà commencé : les inscriptions ne se modifient plus depuis le site.';
const started = (event: RaidHelperEvent, now = Date.now()) => event.startTime <= now / 1000;

const failure = (e: unknown) => (e instanceof RaidHelperError ? e.message : 'Raid-Helper ne répond pas, réessaie dans un instant.');

/** Crée ou modifie l'inscription du membre. Renvoie un message d'erreur, ou null. */
export async function saveSignup(event: RaidHelperEvent, apiKey: string, userId: string, input: z.output<typeof signupSchema>) {
	if (started(event)) return STARTED;
	const character = listCharacters(userId).find((c) => c.id === input.characterId);
	if (!character) return 'Ce perso ne t’appartient pas.';
	const payload = signupPayload(character, input.slot, input.status);
	const current = mySignup(event, userId);
	try {
		const answer = current ? await editSignup(event.id, apiKey, current.id, payload) : await addSignup(event.id, apiKey, userId, payload);
		const saved = await reread(event.id, userId);
		// Hors « présent », Raid-Helper garde l'ancienne spé : on ne la compare pas.
		const specOk = !payload.specName || saved?.specName === payload.specName;
		// Groupe complet : Raid-Helper place lui-même l'inscrit sur le banc (bench_overflow).
		const overflow = saved?.className === 'Bench' && RAID_HELPER.roles[payload.className];
		if (saved && (saved.className === payload.className || overflow) && saved.name === payload.name && specOk) return null;
		return `Raid-Helper n’a pas enregistré l’inscription${answer ? ` : ${answer}` : ''}.`;
	} catch (e) {
		return failure(e);
	}
}

export async function cancelSignup(event: RaidHelperEvent, apiKey: string, userId: string) {
	if (started(event)) return STARTED;
	const current = mySignup(event, userId);
	if (!current) return null;
	try {
		const answer = await deleteSignup(event.id, apiKey, current.id);
		if (!(await reread(event.id, userId))) return null;
		return `Raid-Helper n’a pas supprimé l’inscription${answer ? ` : ${answer}` : ''}.`;
	} catch (e) {
		return failure(e);
	}
}
