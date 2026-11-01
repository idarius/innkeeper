import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// L'addon publié sur CurseForge et Wago : deux fichiers TOC (générique et Forever « Camelot »)
// qui doivent rester identiques, et une version annoncée dans son journal.
const dir = 'addon/InnkeeperSync';
const toc = readFileSync(`${dir}/InnkeeperSync.toc`, 'utf8');
const field = (name: string) => new RegExp(`^## ${name}: (.+)$`, 'm').exec(toc)?.[1].trim();

describe('addon InnkeeperSync', () => {
	it('a deux fichiers TOC identiques, pour l’interface de Forever', () => {
		expect(readFileSync(`${dir}/InnkeeperSync_Camelot.toc`, 'utf8')).toBe(toc);
		expect(field('Interface')).toBe('16001');
		expect(field('SavedVariables')).toBe('InnkeeperSyncDB');
	});

	it('n’exporte pas les notes du registre ni la zone, dont le site ne se sert pas', () => {
		const lua = readFileSync(`${dir}/InnkeeperSync.lua`, 'utf8');
		const roster = lua.slice(lua.indexOf('local function readRoster'), lua.indexOf('local function readGuildProfessions'));
		expect(roster).not.toMatch(/officerNote|publicNote|zone\s*=/);
	});

	it('annonce sa version dans son journal des modifications', () => {
		const version = field('Version');
		expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(readFileSync(`${dir}/CHANGELOG.md`, 'utf8')).toMatch(new RegExp(`^## ${version!.replace(/\./g, '\\.')}$`, 'm'));
	});
});
