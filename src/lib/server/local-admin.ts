import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { getAuthSecret } from './settings';

// Compte admin local d'instance : installation et accès de secours, hors Discord.

const COOKIE = 'admin_session';
const SESSION_TTL_S = 12 * 3600;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string) {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
	return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string) {
	const [algo, salt, hash] = stored.split('$');
	if (algo !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
	return timingSafeEqual(actual, expected);
}

export const hasLocalAdmin = () => Boolean(db().select({ id: schema.localAdmins.id }).from(schema.localAdmins).get());

export function createLocalAdmin(username: string, password: string) {
	return db()
		.insert(schema.localAdmins)
		.values({ username, passwordHash: hashPassword(password) })
		.returning()
		.get();
}

export function setLocalAdminPassword(id: number, password: string) {
	db().update(schema.localAdmins).set({ passwordHash: hashPassword(password) }).where(eq(schema.localAdmins.id, id)).run();
}

// Le hash du mot de passe entre dans la signature : changer le mot de passe
// invalide les sessions existantes.
function sign(id: number, exp: number, passwordHash: string) {
	return createHmac('sha256', getAuthSecret()).update(`${id}.${exp}.${passwordHash}`).digest('base64url');
}

export function openSession(cookies: Cookies, admin: { id: number; passwordHash: string }, secure: boolean) {
	const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
	cookies.set(COOKIE, `${admin.id}.${exp}.${sign(admin.id, exp, admin.passwordHash)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: SESSION_TTL_S
	});
}

export const closeSession = (cookies: Cookies) => cookies.delete(COOKIE, { path: '/' });

/** Admin local de la session, ou null. */
export function sessionAdmin(cookies: Cookies) {
	const [rawId, rawExp, sig] = (cookies.get(COOKIE) ?? '').split('.');
	const id = Number(rawId);
	const exp = Number(rawExp);
	if (!id || !exp || !sig || exp < Date.now() / 1000) return null;

	const admin = db().select().from(schema.localAdmins).where(eq(schema.localAdmins.id, id)).get();
	if (!admin) return null;
	const expected = Buffer.from(sign(id, exp, admin.passwordHash));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	return { id: admin.id, username: admin.username };
}

// Limite de tentatives par adresse : 10 essais par quart d'heure.
const attempts = new Map<string, { count: number; reset: number }>();

export function login(username: string, password: string, address: string) {
	const now = Date.now();
	const entry = attempts.get(address);
	if (entry && entry.reset > now && entry.count >= 10) return { error: 'Trop de tentatives, réessaie dans quelques minutes.' } as const;

	const admin = db().select().from(schema.localAdmins).where(eq(schema.localAdmins.username, username)).get();
	if (admin && verifyPassword(password, admin.passwordHash)) {
		attempts.delete(address);
		return { admin } as const;
	}
	attempts.set(address, entry && entry.reset > now ? { ...entry, count: entry.count + 1 } : { count: 1, reset: now + 15 * 60_000 });
	// Les adresses dont le quart d'heure est écoulé ne servent plus : on les oublie.
	if (attempts.size > 1000) for (const [a, e] of attempts) if (e.reset <= now) attempts.delete(a);
	return { error: 'Identifiants incorrects.' } as const;
}

// Code d'installation à usage unique, affiché dans les logs tant qu'aucun admin
// local n'existe : empêche un inconnu de s'approprier une instance fraîchement exposée.
let setupToken: string | null = null;

export function setupCode() {
	setupToken ??= randomBytes(9).toString('base64url');
	return setupToken;
}

export function checkSetupCode(code: string) {
	const expected = Buffer.from(setupCode());
	const given = Buffer.from(code.trim());
	return expected.length === given.length && timingSafeEqual(expected, given);
}

export const consumeSetupCode = () => {
	setupToken = null;
};
