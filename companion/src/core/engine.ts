import { ApiError, sendExport, type SyncResult } from './api';
import { findExports } from './files';
import type { FileState, Platform } from './platform';
import { Tracker } from './tracker';

// Moteur de synchronisation : relève régulièrement les fichiers de l'addon et envoie ceux
// que le jeu vient d'écrire. Il ne dépend que de Platform (testé avec le reste du projet).

export type Status = 'no-game' | 'waiting' | 'synced' | 'retrying' | 'refused';

export interface SyncEvent {
	at: number;
	account: string;
	message: string;
	ok: boolean;
}

export interface EngineState {
	status: Status;
	/** Message d'erreur (refus de la clé, site injoignable…). */
	detail: string | null;
	files: string[];
	lastSyncAt: number | null;
	events: SyncEvent[];
}

export interface EngineDeps {
	send: (siteUrl: string, token: string, file: Uint8Array) => Promise<SyncResult>;
	find: (gameDir: string) => Promise<string[]>;
	stat: (path: string) => Promise<FileState | null>;
	read: (path: string) => Promise<Uint8Array>;
	now: () => number;
}

export const platformDeps = (p: Platform): EngineDeps => ({
	send: (siteUrl, token, file) => sendExport(p, siteUrl, token, file),
	find: (gameDir) => findExports(p, gameDir),
	stat: (path) => p.stat(path),
	read: (path) => p.readFile(path),
	now: () => p.now()
});

const RESCAN_MS = 60_000;
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
const MAX_EVENTS = 8;

/** « COMPTE » dans …/WTF/Account/COMPTE/SavedVariables/InnkeeperSync.lua. */
export const accountOf = (path: string) => path.split(/[\\/]/).at(-3) ?? path;

export function describeResult(r: SyncResult) {
	if (r.unchanged) return 'déjà à jour';
	const who = r.scope === 'guild' ? 'guilde' : 'tes persos';
	return r.changed ? `${r.changed} perso${r.changed > 1 ? 's' : ''} mis à jour (${who})` : `rien de nouveau (${who})`;
}

export class SyncEngine {
	private tracker = new Tracker();
	private retry = new Map<string, { at: number; delay: number }>();
	private scannedAt = 0;
	private busy = false;
	private config: { siteUrl: string; token: string; gameDir: string } | null = null;
	state: EngineState = { status: 'no-game', detail: null, files: [], lastSyncAt: null, events: [] };

	private stateListeners: ((state: EngineState) => void)[] = [];
	private syncedListeners: ((result: SyncResult, account: string) => void)[] = [];

	constructor(private deps: EngineDeps) {}

	onState(listener: (state: EngineState) => void) {
		this.stateListeners.push(listener);
	}
	onSynced(listener: (result: SyncResult, account: string) => void) {
		this.syncedListeners.push(listener);
	}

	/** (Re)part avec ces réglages ; un changement de dossier relance la recherche des fichiers. */
	configure(config: { siteUrl: string; token: string; gameDir: string } | null) {
		this.config = config;
		this.tracker = new Tracker();
		this.retry.clear();
		this.scannedAt = 0;
		this.update({ status: config?.gameDir ? 'waiting' : 'no-game', detail: null, files: [] });
	}

	/** Un relevé : à appeler toutes les quelques secondes. */
	async tick() {
		const c = this.config;
		if (!c || !c.gameDir || this.busy || this.state.status === 'refused') return;
		this.busy = true;
		try {
			const now = this.deps.now();
			if (now - this.scannedAt > RESCAN_MS) {
				this.scannedAt = now;
				const files = await this.deps.find(c.gameDir);
				if (files.join() !== this.state.files.join()) this.update({ files });
			}
			const states = new Map<string, FileState | null>();
			for (const f of this.state.files) states.set(f, await this.deps.stat(f));
			for (const path of this.tracker.due(states)) {
				const wait = this.retry.get(path);
				if (wait && now < wait.at) continue;
				await this.send(c, path, states.get(path)!, wait);
			}
		} finally {
			this.busy = false;
		}
	}

	private async send(c: { siteUrl: string; token: string }, path: string, fileState: FileState, wait?: { delay: number }) {
		const account = accountOf(path);
		let file: Uint8Array;
		try {
			file = await this.deps.read(path);
		} catch (e) {
			// Fichier encore tenu par le jeu, antivirus… : on le relira plus tard, sans bloquer les autres comptes.
			return this.later(path, account, `Fichier illisible pour l’instant (${e instanceof Error ? e.message : e}).`, wait);
		}
		try {
			const result = await this.deps.send(c.siteUrl, c.token, file);
			this.tracker.done(path, fileState);
			this.retry.delete(path);
			this.log(account, describeResult(result), true, { status: 'synced', detail: null, lastSyncAt: this.deps.now() });
			for (const l of this.syncedListeners) l(result, account);
		} catch (e) {
			if (!(e instanceof ApiError)) throw e;
			if (e.fatal) return this.log(account, e.message, false, { status: 'refused', detail: e.message });
			if (e.rejected) {
				// Fichier refusé tel quel : on attend la prochaine écriture du jeu.
				this.tracker.done(path, fileState);
				return this.log(account, e.message, false, {});
			}
			this.later(path, account, e.message, wait);
		}
	}

	/** Nouvel essai pour ce fichier, de plus en plus tard. */
	private later(path: string, account: string, message: string, wait?: { delay: number }) {
		const delay = Math.min((wait?.delay ?? RETRY_MIN_MS / 2) * 2, RETRY_MAX_MS);
		this.retry.set(path, { at: this.deps.now() + delay, delay });
		this.log(account, `${message} Nouvel essai dans ${Math.round(delay / 1000)} s.`, false, { status: 'retrying', detail: message });
	}

	private log(account: string, message: string, ok: boolean, patch: Partial<EngineState>) {
		const events = [{ at: this.deps.now(), account, message, ok }, ...this.state.events].slice(0, MAX_EVENTS);
		this.update({ ...patch, events });
	}

	private update(patch: Partial<EngineState>) {
		this.state = { ...this.state, ...patch };
		for (const l of this.stateListeners) l(this.state);
	}
}
