import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ROLES, type Role } from '../../roles';
import { ADDON_IMPORTANCES, ADDON_USAGES } from '../../addons';
import { INTEREST_LEVELS } from '../../interests';

/** Métier d'un perso : niveau de 1 à 300, ou null s'il n'est pas renseigné. */
export interface ProfessionEntry {
	id: string;
	level: number | null;
}

/** Recettes connues pour un métier, telles qu'exportées par l'addon. */
export interface KnownRecipes {
	profession: string;
	skill: number | null;
	recipes: { id: number; name: string }[];
}

const timestamp = (name: string) =>
	integer(name, { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`);

export const users = sqliteTable('users', {
	discordId: text('discord_id').primaryKey(),
	discordUsername: text('discord_username').notNull(),
	displayName: text('display_name').notNull(),
	avatar: text('avatar'),
	// Rôles Discord du serveur de guilde, mis en cache à chaque connexion.
	roles: text('roles', { mode: 'json' }).$type<string[]>().notNull().default([]),
	// Présent sur le serveur de guilde à la dernière lecture : sans lui, aucun accès au site,
	// même en mode « tout membre du serveur » (une liste de rôles vide ne le dit pas).
	inGuild: integer('in_guild', { mode: 'boolean' }).notNull().default(false),
	// Dernière lecture des rôles sur Discord (connexion, ou relecture par le bot).
	rolesCheckedAt: integer('roles_checked_at', { mode: 'timestamp' }),
	createdAt: timestamp('created_at'),
	lastLogin: timestamp('last_login'),
	// Arrivée dans la guilde (rôle d'arrivée donné par le bot) ; à défaut, première connexion.
	joinedAt: integer('joined_at', { mode: 'timestamp' }),
	// Dernière revue de progression par un officier (« on garde le rôle de nouveau membre pour l'instant »).
	reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
	reviewNote: text('review_note')
});

export const characters = sqliteTable(
	'characters',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.discordId, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Nom de famille Forever, optionnel.
		surname: text('surname'),
		race: text('race'),
		class: text('class').notNull(),
		spec: text('spec'),
		role: text('role', { enum: ROLES }).notNull(),
		// Spé secondaire (double spécialisation), facultative.
		spec2: text('spec2'),
		role2: text('role2', { enum: ROLES }),
		isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
		level: integer('level').notNull().default(1),
		professions: text('professions', { mode: 'json' }).$type<ProfessionEntry[]>().notNull().default([]),
		// Recettes ou spécialités notables, en texte libre (« flacons », « cape X »…).
		recipes: text('recipes'),
		// Intérêts du joueur sur ce perso ; null = pas intéressé.
		pve: text('pve', { enum: INTEREST_LEVELS }),
		pvp: text('pvp', { enum: INTEREST_LEVELS }),
		interestsUpdatedAt: integer('interests_updated_at', { mode: 'timestamp' }),
		notes: text('notes'),
		// Données venues du jeu (addon InnkeeperSync) : dernière connexion, recettes connues
		// et date du dernier import qui a touché ce perso.
		lastOnlineAt: integer('last_online_at', { mode: 'timestamp' }),
		knownRecipes: text('known_recipes', { mode: 'json' }).$type<KnownRecipes[]>(),
		gameSyncedAt: integer('game_synced_at', { mode: 'timestamp' }),
		// Date de l'export (côté jeu) qui a fourni ces données : un export plus ancien ne les remplace pas.
		gameExportedAt: integer('game_exported_at', { mode: 'timestamp' }),
		createdAt: timestamp('created_at'),
		updatedAt: timestamp('updated_at')
	},
	(t) => [
		index('characters_user_idx').on(t.userId),
		// Un seul main par joueur ; les rerolls lui sont rattachés via user_id.
		uniqueIndex('characters_one_main_per_user').on(t.userId).where(sql`is_main = 1`)
	]
);

// Réglages de l'instance (profil de guilde, Discord, accès…), un document JSON par clé.
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt: timestamp('updated_at')
});

// Compte(s) admin local d'instance : installation et accès de secours, hors Discord.
export const localAdmins = sqliteTable('local_admins', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at')
});

export const PERMISSIONS = ['officer', 'member', 'none'] as const;

// Rôles Discord du serveur : découverts aux connexions des membres (le nom
// reste vide) ou synchronisés par un bot (nom réel), avec la permission associée.
export const discordRoles = sqliteTable('discord_roles', {
	id: text('id').primaryKey(),
	name: text('name'),
	// Nom saisi par l'admin quand aucun bot ne fournit le vrai nom.
	label: text('label'),
	position: integer('position'),
	permission: text('permission', { enum: PERMISSIONS }).notNull().default('none'),
	lastSeen: timestamp('last_seen')
});

// Rosters : équipes nommées par l'admin, composées par les officiers.
export const rosters = sqliteTable('rosters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
	// members : visible par tous les membres ; officers : réservé aux officiers.
	visibility: text('visibility', { enum: ['members', 'officers'] }).notNull().default('members'),
	createdAt: timestamp('created_at')
});

export const rosterMembers = sqliteTable(
	'roster_members',
	{
		rosterId: integer('roster_id')
			.notNull()
			.references(() => rosters.id, { onDelete: 'cascade' }),
		characterId: integer('character_id')
			.notNull()
			.references(() => characters.id, { onDelete: 'cascade' }),
		addedAt: timestamp('added_at')
	},
	(t) => [primaryKey({ columns: [t.rosterId, t.characterId] })]
);

// Modèles de sortie : préremplissent la création d'un événement Raid-Helper.
export const outingTemplates = sqliteTable('outing_templates', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	// Type de sortie ($lib/activities) et instance du catalogue Forever, facultatifs.
	activity: text('activity'),
	instanceId: text('instance_id'),
	title: text('title').notNull(),
	description: text('description'),
	// Salon Discord où Raid-Helper poste l'événement ; null = salon par défaut.
	channelId: text('channel_id'),
	// Jour habituel (1 = lundi … 7 = dimanche) et heure (HH:mm), facultatifs.
	weekday: integer('weekday'),
	time: text('time'),
	// Roster proposé pour la comparaison avec les inscrits.
	rosterId: integer('roster_id').references(() => rosters.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at')
});

// Sorties créées depuis le site : qui l'a proposée et de quel genre (officielle ou membre).
// L'événement lui-même (titre, inscrits…) reste dans Raid-Helper, qui fait foi.
export const outings = sqliteTable(
	'outings',
	{
		eventId: text('event_id').primaryKey(),
		kind: text('kind', { enum: ['official', 'member'] }).notNull(),
		createdBy: text('created_by'),
		title: text('title').notNull(),
		activity: text('activity'),
		instanceId: text('instance_id'),
		startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
		createdAt: timestamp('created_at')
	},
	(t) => [index('outings_created_by_idx').on(t.createdBy)]
);

// Perso visé par une candidature : mêmes champs qu'une fiche, copiés tels quels.
export type CharacterDraft = Pick<
	typeof characters.$inferInsert,
	'name' | 'surname' | 'race' | 'class' | 'spec' | 'role' | 'spec2' | 'role2' | 'level' | 'professions' | 'recipes' | 'pve' | 'pvp' | 'notes'
>;

export const APPLICATION_STATUSES = ['pending', 'accepted', 'refused', 'withdrawn'] as const;

export const applications = sqliteTable(
	'applications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.discordId, { onDelete: 'cascade' }),
		status: text('status', { enum: APPLICATION_STATUSES }).notNull().default('pending'),
		character: text('character', { mode: 'json' }).$type<CharacterDraft>().notNull(),
		answers: text('answers', { mode: 'json' }).$type<{ question: string; answer: string }[]>().notNull(),
		// Décision : officier qui a tranché, message facultatif adressé au candidat.
		decidedBy: text('decided_by'),
		decidedAt: integer('decided_at', { mode: 'timestamp' }),
		decisionMessage: text('decision_message'),
		// Arrivée sur Discord après acceptation : invitation créée par le bot, rôle attribué.
		inviteUrl: text('invite_url'),
		roleAssignedAt: integer('role_assigned_at', { mode: 'timestamp' }),
		// Charte acceptée en postulant (null : pas de charte à ce moment-là).
		charterAcceptedAt: integer('charter_accepted_at', { mode: 'timestamp' }),
		createdAt: timestamp('created_at')
	},
	(t) => [index('applications_user_idx').on(t.userId), index('applications_status_idx').on(t.status)]
);

// Avis des officiers : +1 ou -1 (un -1 doit être justifié), un avis par officier et par candidature.
export const applicationVotes = sqliteTable(
	'application_votes',
	{
		applicationId: integer('application_id')
			.notNull()
			.references(() => applications.id, { onDelete: 'cascade' }),
		voterId: text('voter_id').notNull(),
		voterName: text('voter_name').notNull(),
		value: integer('value').notNull(),
		comment: text('comment'),
		createdAt: timestamp('created_at')
	},
	(t) => [primaryKey({ columns: [t.applicationId, t.voterId] })]
);

// Journal d'audit : qui a fait quoi (officiers, admin local). Consultable par l'admin
// de l'instance uniquement, jamais modifiable depuis le site, purgé après 12 mois.
// Acteur et cible sont copiés en clair : la ligne reste lisible si l'objet est supprimé.
export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		at: timestamp('at'),
		actorType: text('actor_type', { enum: ['discord', 'local-admin', 'system'] }).notNull(),
		actorId: text('actor_id'),
		actorName: text('actor_name').notNull(),
		action: text('action').notNull(),
		targetLabel: text('target_label'),
		targetUrl: text('target_url'),
		details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
		// Adresse IP : seulement pour les connexions de l'admin local.
		ip: text('ip')
	},
	(t) => [index('audit_log_at_idx').on(t.at)]
);

// Addons conseillés par la guilde (page « Addons », gérée par les officiers).
export const addons = sqliteTable('addons', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	importance: text('importance', { enum: ADDON_IMPORTANCES }).notNull(),
	usage: text('usage', { enum: ADDON_USAGES }).notNull(),
	// Public visé : vide = tout le monde.
	classes: text('classes', { mode: 'json' }).$type<string[]>().notNull().default([]),
	roles: text('roles', { mode: 'json' }).$type<Role[]>().notNull().default([]),
	description: text('description'),
	curseforgeUrl: text('curseforge_url'),
	wagoUrl: text('wago_url'),
	otherUrl: text('other_url'),
	// Ordre d'affichage dans son niveau d'importance.
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
});

// Clés du programme InnkeeperSync (synchronisation automatique depuis le PC du joueur).
// Seule l'empreinte SHA-256 de la clé est gardée : elle n'est montrée qu'une fois, à la création.
export const syncTokens = sqliteTable(
	'sync_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.discordId, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		tokenHash: text('token_hash').notNull(),
		// Premiers caractères de la clé, pour la reconnaître dans la liste.
		hint: text('hint').notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
		// Empreinte du dernier fichier reçu : un fichier inchangé n'est pas réimporté.
		lastFileHash: text('last_file_hash'),
		createdAt: timestamp('created_at')
	},
	(t) => [uniqueIndex('sync_tokens_hash_idx').on(t.tokenHash), index('sync_tokens_user_idx').on(t.userId)]
);

export type User = typeof users.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type Roster = typeof rosters.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type DiscordRole = typeof discordRoles.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
