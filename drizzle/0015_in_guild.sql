ALTER TABLE `users` ADD `in_guild` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Comptes existants : un rôle en cache prouve la présence sur le serveur à la dernière
-- connexion. Sans rôle, on ne peut pas savoir : la prochaine connexion tranchera.
UPDATE `users` SET `in_guild` = 1 WHERE json_array_length(`roles`) > 0;
