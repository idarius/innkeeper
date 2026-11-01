import type { Platform } from './platform';

// Appels au site de la guilde (adresse /api/sync), avec la clé personnelle.

export class ApiError extends Error {
	constructor(
		message: string,
		/** 0 : pas de réponse (réseau). */
		readonly status: number
	) {
		super(message);
	}
	/** Clé refusée ou accès retiré : inutile de réessayer sans reconnecter. */
	get fatal() {
		return this.status === 401 || this.status === 403;
	}
	/** Fichier refusé tel quel : on attend la prochaine écriture du jeu. */
	get rejected() {
		return this.status === 400 || this.status === 413;
	}
}

export interface Whoami {
	guild: string | null;
	player: string;
	scope: 'guild' | 'own';
}
export interface SyncResult {
	scope: 'guild' | 'own';
	unchanged: boolean;
	changed: number;
	synced: number;
}

// Au-delà, la requête est abandonnée : un site muet bloquerait sinon le moteur, qui
// n'enchaîne pas de nouveau relevé tant qu'un envoi est en cours. Large pour un fichier de
// quelques Mo sur une connexion lente.
const TIMEOUT_MS = 60_000;

async function request<T>(p: Platform, siteUrl: string, token: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await p.fetch(`${siteUrl}/api/sync`, {
			...init,
			headers: { authorization: `Bearer ${token}`, ...init.headers },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		throw new ApiError(`Site injoignable (${e instanceof Error ? e.message : e}).`, 0);
	}
	const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!res.ok || !body) throw new ApiError(body?.error ?? `Le site a répondu ${res.status}.`, res.status);
	return body;
}

export const whoami = (p: Platform, siteUrl: string, token: string) => request<Whoami>(p, siteUrl, token);

export const sendExport = (p: Platform, siteUrl: string, token: string, file: Uint8Array) =>
	request<SyncResult>(p, siteUrl, token, { method: 'POST', body: file as RequestInit['body'], headers: { 'content-type': 'application/octet-stream' } });
