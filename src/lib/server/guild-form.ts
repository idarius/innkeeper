import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { DEFAULT_ACCENTS, guildSchema, type GuildProfile } from './settings';

export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// Premiers octets de chaque format : le type annoncé par le navigateur ne prouve rien.
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
	png: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
	jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP'
};
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Extension d'une image envoyée si son contenu correspond au type annoncé (PNG, JPEG, WebP), sinon null. */
export function imageExtension(type: string, data: Uint8Array) {
	const ext = IMAGE_TYPES[type];
	return ext && SIGNATURES[ext](data) ? ext : null;
}

// Images de la guilde : champ du formulaire → clé du profil, taille maximale.
const IMAGES = {
	logo: { maxBytes: 1024 * 1024, label: '1 Mo' },
	banner: { maxBytes: 4 * 1024 * 1024, label: '4 Mo' }
} as const;
type ImageKind = keyof typeof IMAGES;

/** Dossier des fichiers envoyés (logo, bannière), à côté de la base de données. */
export function uploadsDir() {
	return join(dirname(resolve(env.DATABASE_PATH || './data/guilde.db')), 'uploads');
}

/** Réponse HTTP pour une image de la guilde (le nom change à chaque envoi : cache long). */
export function serveUpload(file: string | null | undefined) {
	if (!file) error(404);
	try {
		return new Response(readFileSync(join(uploadsDir(), file)), {
			headers: {
				'Content-Type': CONTENT_TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream',
				'Cache-Control': 'public, max-age=86400'
			}
		});
	} catch {
		error(404);
	}
}

async function readImage(form: FormData, kind: ImageKind) {
	const file = form.get(kind);
	if (!(file instanceof File) || file.size === 0) return { upload: null };
	if (!IMAGE_TYPES[file.type]) return { error: 'Format accepté : PNG, JPEG ou WebP' };
	if (file.size > IMAGES[kind].maxBytes) return { error: `Image trop lourde (${IMAGES[kind].label} maximum)` };
	const data = Buffer.from(await file.arrayBuffer());
	const ext = imageExtension(file.type, data);
	if (!ext) return { error: 'Format accepté : PNG, JPEG ou WebP (le fichier n’est pas une image de ce type)' };
	return { upload: { data, ext } };
}

/** Lit le formulaire de profil de guilde ; enregistre ou supprime logo et bannière au passage. */
export async function parseGuildForm(form: FormData, current: GuildProfile | null) {
	const str = (key: string) => String(form.get(key) ?? '');
	const faction = str('faction') as GuildProfile['faction'];
	const raw = {
		name: str('name'),
		faction,
		serverType: str('serverType') || null,
		tagline: str('tagline'),
		description: str('description'),
		ambitions: form.getAll('ambitions').map(String),
		schedule: str('schedule'),
		recruitment: {
			open: form.get('recruitmentOpen') === 'on',
			classes: form.getAll('recruitmentClasses').map(String),
			roles: form.getAll('recruitmentRoles').map(String),
			text: str('recruitmentText')
		},
		accentColor: str('accentColor') || DEFAULT_ACCENTS[faction] || DEFAULT_ACCENTS.both,
		timezone: str('timezone') || 'Europe/Paris',
		discordInvite: str('discordInvite'),
		publicStats: form.get('publicStats') === 'on',
		bannerTitle: form.get('bannerTitle') === 'on',
		logo: current?.logo ?? null,
		banner: current?.banner ?? null
	};

	const errors: Record<string, string> = {};
	const uploads: Partial<Record<ImageKind, { data: Buffer; ext: string }>> = {};
	for (const kind of Object.keys(IMAGES) as ImageKind[]) {
		const result = await readImage(form, kind);
		if (result.error) errors[kind] = result.error;
		else if (result.upload) uploads[kind] = result.upload;
	}

	const result = guildSchema.safeParse(raw);
	// Facultatif dans le profil enregistré (anciens profils), mais à choisir dans le formulaire.
	if (!raw.serverType) errors.serverType = 'Choisis le type de serveur de la guilde';
	if (!result.success) {
		for (const issue of result.error.issues) errors[String(issue.path[0] ?? 'form')] ??= issue.message;
	}
	if (!result.success || Object.keys(errors).length) return { errors, values: raw } as const;

	const data = result.data;
	const dir = uploadsDir();
	for (const kind of Object.keys(IMAGES) as ImageKind[]) {
		const upload = uploads[kind];
		const remove = form.get(`remove-${kind}`) === 'on';
		if (!upload && !remove) continue;
		if (current?.[kind]) rmSync(join(dir, current[kind]), { force: true });
		data[kind] = null;
		if (upload) {
			mkdirSync(dir, { recursive: true });
			data[kind] = `${kind}-${Date.now()}.${upload.ext}`;
			writeFileSync(join(dir, data[kind]), upload.data);
		}
	}
	return { data } as const;
}
