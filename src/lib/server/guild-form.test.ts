import { describe, expect, it } from 'vitest';
import { formData } from '../../test/helpers';
import { parseGuildForm } from './guild-form';
import { guildSchema } from './settings';

const base = { name: 'Le Pacte de Test', faction: 'horde', accentColor: '#b3261e', timezone: 'Europe/Paris' };

describe('profil de guilde : type de serveur', () => {
	it('est demandé dans le formulaire', async () => {
		const parsed = await parseGuildForm(formData(base), null);
		expect(parsed.errors?.serverType).toMatch(/type de serveur/);
	});

	it('est enregistré quand il est choisi', async () => {
		const parsed = await parseGuildForm(formData({ ...base, serverType: 'pvp' }), null);
		expect(parsed.data?.serverType).toBe('pvp');
	});

	it('refuse un type inconnu', async () => {
		const parsed = await parseGuildForm(formData({ ...base, serverType: 'pvp-rp-ultra' }), null);
		expect(parsed.errors?.serverType).toBeDefined();
	});

	it('reste facultatif pour un profil enregistré avant ce réglage', () => {
		expect(guildSchema.parse(base).serverType).toBeNull();
	});
});

describe('profil de guilde : images', () => {
	it('refuse un fichier qui n’est pas l’image annoncée', async () => {
		const form = formData({ ...base, serverType: 'pvp' });
		form.append('logo', new File(['<svg onload="alert(1)"></svg>'], 'logo.png', { type: 'image/png' }));
		expect((await parseGuildForm(form, null)).errors?.logo).toMatch(/Format/);
	});

	it('accepte une vraie image JPEG', async () => {
		const form = formData({ ...base, serverType: 'pvp' });
		form.append('logo', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], 'logo.jpg', { type: 'image/jpeg' }));
		expect((await parseGuildForm(form, null)).data?.logo).toMatch(/^logo-\d+\.jpg$/);
	});
});
