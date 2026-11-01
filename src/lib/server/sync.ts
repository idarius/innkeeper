import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { audit } from './audit';
import { db, schema } from './db';
import { applyImport, planImport, readExport } from './game-import';
import { permissionFor, refreshMembership, type Permission } from './permissions';

// Synchronisation automatique : le programme InnkeeperSync, sur le PC du joueur, envoie le
// fichier de l'addon dès que le jeu l'écrit (déconnexion, /reload). Il s'identifie par une
// clé personnelle. Clé d'officier : tout l'export (registre de la guilde compris) ;
// clé de membre : seulement les persos de son propre compte.

const { syncTokens, users, characters } = schema;

export const MAX_TOKENS = 5;
export const MAX_SYNC_BYTES = 5 * 1024 * 1024;
// Deux envois rapprochés d'un même fichier modifié : le second attend.
const MIN_INTERVAL_MS = 10_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class SyncError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

export function listSyncTokens(userId: string) {
	return db()
		.select({ id: syncTokens.id, label: syncTokens.label, hint: syncTokens.hint, lastUsedAt: syncTokens.lastUsedAt, createdAt: syncTokens.createdAt })
		.from(syncTokens)
		.where(eq(syncTokens.userId, userId))
		.orderBy(desc(syncTokens.createdAt), desc(syncTokens.id))
		.all();
}

/** Crée une clé ; elle n'est renvoyée qu'ici, en clair, pour être copiée dans le programme. */
export function createSyncToken(userId: string, label: string) {
	if (listSyncTokens(userId).length >= MAX_TOKENS) throw new SyncError(`${MAX_TOKENS} clés au plus : révoque celles qui ne servent plus.`, 400);
	const token = `iks_${randomBytes(24).toString('base64url')}`;
	db()
		.insert(syncTokens)
		.values({ userId, label: label.trim().slice(0, 40) || 'Mon PC', tokenHash: sha256(token), hint: token.slice(0, 8) })
		.run();
	return token;
}

export function revokeSyncToken(userId: string, id: number) {
	return db().delete(syncTokens).where(and(eq(syncTokens.id, id), eq(syncTokens.userId, userId))).run().changes > 0;
}

export interface SyncIdentity {
	tokenId: number;
	lastUsedAt: Date | null;
	lastFileHash: string | null;
	user: { id: string; displayName: string; avatar: string | null; permission: Permission };
}

const bearer = (header: string | null) => /^Bearer\s+(iks_[\w-]+)$/.exec(header ?? '')?.[1];

/** Clé lue dans l'en-tête `Authorization: Bearer …`, d'après les rôles Discord en cache. */
export function identify(header: string | null): SyncIdentity {
	const token = bearer(header);
	if (!token) throw new SyncError('Clé de synchronisation manquante.', 401);
	const row = db()
		.select({ t: syncTokens, u: users })
		.from(syncTokens)
		.innerJoin(users, eq(users.discordId, syncTokens.userId))
		.where(eq(syncTokens.tokenHash, sha256(token)))
		.get();
	if (!row) throw new SyncError('Clé inconnue ou révoquée : crée-en une nouvelle sur le site (Mes persos → Synchronisation).', 401);
	const permission = permissionFor(row.u);
	if (!permission) throw new SyncError('Ce compte n’a plus accès au site de la guilde.', 403);
	return {
		tokenId: row.t.id,
		lastUsedAt: row.t.lastUsedAt,
		lastFileHash: row.t.lastFileHash,
		user: { id: row.u.discordId, displayName: row.u.displayName, avatar: row.u.avatar, permission }
	};
}

/** Comme `identify`, après avoir relu les rôles du titulaire de la clé sur Discord (bot). */
export async function authenticate(header: string | null): Promise<SyncIdentity> {
	const token = bearer(header);
	const owner = token && db().select({ userId: syncTokens.userId }).from(syncTokens).where(eq(syncTokens.tokenHash, sha256(token))).get();
	if (owner) await refreshMembership(owner.userId);
	return identify(header);
}

export interface SyncResult {
	scope: 'guild' | 'own';
	unchanged: boolean;
	changed: number;
	synced: number;
}

/** Importe le fichier envoyé par le programme, selon les droits de la clé. */
export function syncExport(who: SyncIdentity, source: string, now = Date.now()): SyncResult {
	const scope = who.user.permission === 'officer' ? 'guild' : 'own';
	const fileHash = sha256(source);
	const touch = (values: Partial<typeof syncTokens.$inferInsert>) =>
		db().update(syncTokens).set(values).where(eq(syncTokens.id, who.tokenId)).run();

	// Même fichier que la dernière fois (le programme redémarre…) : rien à refaire.
	if (fileHash === who.lastFileHash) {
		touch({ lastUsedAt: new Date(now) });
		return { scope, unchanged: true, changed: 0, synced: 0 };
	}
	if (who.lastUsedAt && now - who.lastUsedAt.getTime() < MIN_INTERVAL_MS) throw new SyncError('Envois trop rapprochés : réessaie dans quelques secondes.', 429);

	const plan = planImport(readExport(source));
	if (scope === 'own') {
		// Un membre ne met à jour que ses persos ; le registre ne sert pas de référence « vu en jeu ».
		const own = new Set(
			db()
				.select({ id: characters.id })
				.from(characters)
				.where(eq(characters.userId, who.user.id))
				.all()
				.map((c) => c.id)
		);
		plan.updates = plan.updates.filter((u) => own.has(u.characterId));
		plan.rosterSize = 0;
	}
	const changed = applyImport(plan);
	touch({ lastUsedAt: new Date(now), lastFileHash: fileHash });

	if (changed) {
		const locals = { user: who.user, candidate: null, admin: null } as unknown as App.Locals;
		audit(locals, 'game.sync', { label: plan.guild ?? 'Données du jeu', url: scope === 'guild' ? '/admin/import' : '/persos' }, {
			persos: changed,
			portee: scope === 'guild' ? 'guilde' : 'ses persos',
			export: plan.exportedAt.toISOString()
		});
	}
	return { scope, unchanged: false, changed, synced: plan.updates.length };
}
