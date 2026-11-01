import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { getActivity, getInstance, imageKeys } from '$lib/activities';
import { IMAGE_TYPES, imageExtension, uploadsDir } from './guild-form';
import { getActivityImages, setActivityImages } from './settings';

// Images des sorties : une par instance ou par type d'activité, envoyées par la guilde
// (aucune image de Blizzard n'est fournie). Servies publiquement : Discord les récupère
// pour l'affichage de l'événement Raid-Helper.

const MAX_BYTES = 2 * 1024 * 1024;

export const isImageKey = (key: string) => {
	const [kind, id] = key.split(':');
	return (kind === 'instance' && Boolean(getInstance(id))) || (kind === 'activity' && Boolean(getActivity(id)));
};

/** Enregistre l'image d'une clé ; renvoie un message d'erreur ou null. */
export async function saveActivityImage(key: string, file: File) {
	if (!isImageKey(key)) return 'Instance ou activité inconnue.';
	if (!IMAGE_TYPES[file.type]) return 'Format accepté : PNG, JPEG ou WebP';
	if (file.size > MAX_BYTES) return 'Image trop lourde (2 Mo maximum)';
	const data = Buffer.from(await file.arrayBuffer());
	const ext = imageExtension(file.type, data);
	if (!ext) return 'Format accepté : PNG, JPEG ou WebP (le fichier n’est pas une image de ce type)';
	const images = getActivityImages();
	const dir = uploadsDir();
	mkdirSync(dir, { recursive: true });
	// Nom nouveau à chaque envoi : Discord et les navigateurs ne gardent pas l'ancienne en cache.
	const name = `sortie-${key.replace(':', '-')}-${Date.now()}.${ext}`;
	writeFileSync(join(dir, name), data);
	if (images[key]) rmSync(join(dir, images[key]), { force: true });
	setActivityImages({ ...images, [key]: name });
	return null;
}

export function removeActivityImage(key: string) {
	const images = getActivityImages();
	if (!images[key]) return;
	rmSync(join(uploadsDir(), images[key]), { force: true });
	const { [key]: _removed, ...rest } = images;
	setActivityImages(rest);
}

/** Fichier d'image publié, ou undefined (seuls les fichiers enregistrés sont servis). */
export const publishedImage = (file: string) => (Object.values(getActivityImages()).includes(file) ? file : undefined);

/** Adresse publique de l'image d'une sortie : celle de l'instance, sinon celle de l'activité. */
export function activityImageUrl(activity: string | null, instance: string | null) {
	const images = getActivityImages();
	const file = imageKeys(activity, instance)
		.map((k) => images[k])
		.find(Boolean);
	return file && env.ORIGIN ? `${env.ORIGIN}/images/sorties/${file}` : null;
}
