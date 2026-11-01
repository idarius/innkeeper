import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { handle as authHandle } from './auth';
import { db, schema } from '$lib/server/db';
import { purgeAuditLog } from '$lib/server/audit';
import { hasLocalAdmin, sessionAdmin, setupCode } from '$lib/server/local-admin';
import { permissionFor, refreshMembership } from '$lib/server/permissions';
import { withSecurityHeaders } from '$lib/server/security-headers';
import { getDiscord, isSetupComplete } from '$lib/server/settings';

export const init: ServerInit = () => {
	// Journal d'audit : purge des entrées de plus de 12 mois, au démarrage puis chaque jour.
	purgeAuditLog();
	setInterval(purgeAuditLog, 86_400_000).unref();
	if (!hasLocalAdmin()) {
		const url = `${env.ORIGIN ?? 'http://localhost:3000'}/installation`;
		console.log(`\n=== Installation d'Innkeeper ===\nOuvre ${url}\nCode d'installation : ${setupCode()}\n`);
	}
};

// En premier, pour couvrir les réponses de toutes les étapes suivantes (pages, Auth.js, images).
const securityHeaders: Handle = async ({ event, resolve }) => withSecurityHeaders(await resolve(event));

const ALWAYS_OPEN = ['/installation', '/healthz', '/logo', '/banniere', '/admin/connexion'];

// Tant que l'installation n'est pas terminée, tout mène à l'assistant.
const setupGuard: Handle = ({ event, resolve }) => {
	const path = event.url.pathname;
	if (!isSetupComplete() && !ALWAYS_OPEN.some((p) => path === p || path.startsWith(`${p}/`))) {
		redirect(303, '/installation');
	}
	return resolve(event);
};

// Auth.js n'est branché qu'une fois l'appli Discord configurée.
const discordAuth: Handle = ({ event, resolve }) => {
	if (getDiscord()) return authHandle({ event, resolve });
	event.locals.auth = async () => null;
	return resolve(event);
};

// Charge l'utilisateur Discord et l'admin local de la session. La permission est
// recalculée à chaque requête, et les rôles relus par le bot toutes les 10 minutes, pour qu'un
// changement de rôles ou une exclusion s'applique sans reconnexion.
const sessionHandle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.candidate = null;
	event.locals.admin = sessionAdmin(event.cookies);

	const discordId = (await event.locals.auth())?.user?.id;
	if (discordId) {
		await refreshMembership(discordId);
		const user = db().select().from(schema.users).where(eq(schema.users.discordId, discordId)).get();
		const permission = user && permissionFor(user);
		if (user && permission) {
			event.locals.user = { id: user.discordId, displayName: user.displayName, avatar: user.avatar, permission };
		} else if (user) {
			// Connecté avec Discord mais pas membre : accès à sa candidature seulement.
			event.locals.candidate = { id: user.discordId, displayName: user.displayName, avatar: user.avatar };
		}
	}
	return resolve(event);
};

export const handle = sequence(securityHeaders, setupGuard, discordAuth, sessionHandle);
