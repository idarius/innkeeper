# Journal des modifications

Toutes les évolutions notables d'Innkeeper sont notées ici. Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et les numéros de version suivent [la gestion sémantique de version](https://semver.org/lang/fr/).

## [Non publié]

### Sécurité

- **Accès des comptes extérieurs au serveur** : en mode « tout membre du serveur » (le mode par défaut), un compte Discord qui n'est pas sur le serveur de la guilde obtenait l'accès membre (roster, sorties, inscriptions, clés de synchronisation) au lieu de passer par la candidature. Le site enregistre désormais la présence sur le serveur à chaque connexion et à chaque relecture des nouveaux membres par le bot ; sans elle, aucun accès. Migration : les comptes qui avaient au moins un rôle sont considérés comme présents ; ceux qui n'en avaient aucun doivent se reconnecter une fois.
- **Rôles à jour sans reconnexion** : avec le bot, les rôles d'un joueur et sa présence sur le serveur sont relus sur Discord au plus toutes les 10 minutes, pour les pages du site comme pour les clés InnkeeperSync. Un rôle retiré ou une exclusion du serveur s'applique donc en quelques minutes, au lieu de durer tant que la session restait ouverte (30 jours, prolongés à chaque visite). Si Discord ne répond pas, le site garde les rôles connus.
- En-têtes de sécurité sur toutes les réponses du site : interdiction d'intégrer le site dans la page d'un autre (`X-Frame-Options`, `frame-ancestors`), ce qui empêche de piéger un officier par des clics détournés sur les actions d'admin ; pas de reniflage des types de fichiers (`nosniff`) pour les images envoyées ; adresse complète des pages non transmise aux sites externes (`Referrer-Policy`).
- Images envoyées (logo, bannière, images des sorties) : le contenu du fichier doit correspondre au format annoncé (signature PNG, JPEG ou WebP). Jusqu'ici, seul le type déclaré par le navigateur comptait : un fichier quelconque renommé en `.png` était accepté puis servi publiquement comme image.

### Modifié

- Addon InnkeeperSync 1.2.1 : les notes du registre de guilde (publiques et d'officier) et la zone des membres ne sont plus exportées. Le site ne s'en servait pas, mais InnkeeperSync les envoyait avec le reste du fichier.

### Corrigé

- Une candidature validée deux fois (double clic, deux officiers en même temps) créait deux persos à la recrue et deux annonces. La décision ne s'enregistre plus que si la candidature est encore en attente ; un refus ou un retrait arrivé après coup est sans effet.
- Sorties : une sortie commencée ou passée n'accepte plus d'inscription ni de désinscription depuis le site. Le formulaire était déjà masqué, mais l'envoi direct du formulaire passait encore et modifiait la liste dans Raid-Helper après coup.
- Connexion Discord : la lecture du profil du joueur sur le serveur abandonne au bout de 10 secondes, comme les autres appels à Discord, au lieu d'attendre indéfiniment une réponse quand Discord est lent.
- Mémoire du serveur : le cache des événements Raid-Helper (500 au plus), la liste des messages Discord écartés (5 000 au plus) et les tentatives de connexion admin (adresses expirées oubliées) ne grossissent plus sans limite. Il suffisait d'ouvrir `/sorties/<identifiant>` avec des identifiants inventés pour faire grossir le processus.
- Import du jeu : les caractères accentués écrits sous forme d'octets échappés (`\195\169`) dans le fichier de l'addon donnaient « Ã© » au lieu de « é » (noms de persos, de métiers, de recettes). Les octets échappés sont maintenant décodés ensemble en UTF-8.
- Bot Discord : quand Discord demande de ralentir (429) pour quelques secondes, le bot patiente puis réessaie au lieu d'échouer. Le repérage des sorties sans clé Raid-Helper lit les salons cinq par cinq au lieu de tous à la fois : sur un serveur aux nombreux salons, des sorties manquaient à la liste sans aucun message.
- InnkeeperSync : un envoi resté sans réponse (site muet, connexion coupée en plein envoi) bloquait l'application jusqu'à son redémarrage, sans plus rien synchroniser ni afficher d'erreur. Chaque requête abandonne maintenant au bout d'une minute, et l'application réessaie plus tard comme pour un site injoignable.
- InnkeeperSync : un fichier d'export illisible (encore tenu par le jeu, bloqué par un antivirus…) interrompait le relevé, et les fichiers des autres comptes WoW n'étaient plus envoyés tant qu'il restait illisible, sans aucun message. Il est maintenant relu plus tard, l'erreur s'affiche dans l'historique, et les autres comptes partent normalement.
- Addon InnkeeperSync 1.2.1 : l'export repart de zéro à chaque connexion d'un perso. Si Forever relit les SavedVariables (ce que la bêta ne faisait pas), les recettes d'un autre perso du même compte étaient attribuées au perso connecté, et un perso hors guilde renvoyait le registre de la guilde d'un autre.
- Import du jeu : un export plus ancien que les données d'une fiche ne les remplace plus (niveau qui redescend, métiers et dernière connexion d'avant). C'était le cas avec deux comptes WoW sur le même PC, dont InnkeeperSync renvoie les deux fichiers à chaque démarrage, ou quand l'export d'un officier arrivait après celui, plus récent, d'un membre. L'aperçu de l'import liste les fiches ignorées pour cette raison, et un registre plus ancien ne déplace plus la référence « vu en jeu ». Seules les recettes encore inconnues d'un tel export s'ajoutent : un registre de guilde plus récent n'en contient pas, et une recette apprise ne se perd pas.
- InnkeeperSync sous Linux (AppImage) : l'application ne pouvait lire aucun fichier de l'addon et n'envoyait donc jamais rien, en restant « En attente du jeu » sans message. Un des motifs de chemin autorisés, écrit avec des antislashs pour Windows, est invalide sur Linux et faisait échouer toute la permission de lecture. Ce motif est maintenant réservé à Windows.

## [0.13.0] - 2026-11-01

### Ajouté

- **Page Addons** : les addons conseillés par la guilde, gérés dans Admin → Addons (statut : indispensable, recommandé en raid, recommandé, utile, confort ; usage ; public visé par classe ou rôle ; « pourquoi » ; liens CurseForge, Wago ou autre ; ordre). Page en tableau, visible de tous, lien dans le menu dès qu'un addon est publié ; filtres par recherche, statut, usage et « Pour mon main ». Innkeeper Sync s'ajoute en un clic. Chaque changement est noté dans le journal.
- **Publication de l'addon** sur CurseForge, Wago Addons et WoWInterface : versions et tags propres (`InnkeeperSync-v1.2.0`), workflow `addon.yml` avec le BigWigs Packager. Addon 1.2.0 : fichier TOC propre à Forever (`InnkeeperSync_Camelot.toc`), description anglaise avec traduction française.

## [0.12.2] - 2026-11-01

### Ajouté

- Page d'erreur en français (page introuvable, accès réservé, erreur inattendue) avec « Réessayer » et « Retour à l'accueil », au lieu des messages bruts « Not Found » ou « Internal Error ».
- Lien « Charte » en pied de page quand la guilde en a publié une.

### Modifié

- InnkeeperSync : une nouvelle version s'annonce dans la fenêtre (« Version X disponible », bouton « Mettre à jour » avec la progression) ; lien « Rechercher une mise à jour » près du numéro de version. Lancée cachée avec Windows, l'application se met encore à jour seule.
- Candidature : l'acceptation de la charte s'affiche en pastille verte avec sa date (« ✔ Charte acceptée le … »), orange si la charte a été modifiée depuis.

## [0.12.1] - 2026-10-31

### Corrigé

- L'installateur Windows d'InnkeeperSync porte l'icône d'Innkeeper au lieu de l'icône générique.
- L'AppImage Linux d'InnkeeperSync se construit de nouveau : la bibliothèque `rust-ini` 0.21.3 cassait le module des liens `innkeeper://` sous Linux, elle est figée en 0.21.1.

## [0.12.0] - 2026-10-31

### Ajouté

- **Application InnkeeperSync pour PC** (`companion/`, Tauri, installateur d'environ 5 Mo) : surveille le fichier de l'addon et l'envoie au site dès que le jeu l'écrit (déconnexion, `/reload`), sans dépôt manuel. Vit près de l'horloge, démarre avec Windows, se met à jour toute seule, notification après un envoi (désactivable). Installateur Windows et AppImage Linux attachés à chaque release GitHub.
- **Synchronisation automatique** (Mes persos) : bouton « Connecter InnkeeperSync » (lien `innkeeper://`, confirmé dans l'application) et clés personnelles révocables ; une clé d'officier met à jour toute la guilde, une clé de membre seulement ses persos. Adresse `/api/sync`, envois notés dans le journal.

## [0.11.0] - 2026-10-31

### Ajouté

- **Charte et règlement** : rédigés dans Admin → Charte (aperçu en direct, modification notée dans le journal), publiés sur la page publique `/charte` avec un lien dans le menu. Quand une charte existe, le candidat la lit dans le formulaire et doit cocher « J'ai lu la charte et je m'engage à la respecter » ; la candidature indique aux officiers que la charte a été acceptée. Mise en page pensée pour un long texte : chaque partie (`#`) ouvre par un titre souligné, ses sous-parties (`##`) s'affichent en encadrés côte à côte (empilés sur téléphone), et une dernière ligne entièrement en gras (une devise) sort des parties pour former un bandeau en bas de page.

- **Type de serveur** de la guilde (JcJ, JcE, JdR, Hardcore à venir) dans le profil de guilde, demandé à l'installation et dans Admin → Guilde. Il s'affiche sur la bannière de l'accueil (« Horde · JcJ · World of Warcraft Forever ») et en pied de page. Un rappel s'affiche dans l'admin tant qu'il n'est pas renseigné.

### Modifié

- Les textes de la guilde (charte, présentation, horaires, recrutement) acceptent des titres (`# `, `## `) et des listes (`- `).

### Corrigé

- Le titre du formulaire de candidature affichait « Postuler au Le Pacte… » : il devient « Rejoindre <nom de la guilde> ».

## [0.10.1] - 2026-10-30

### Ajouté

- **Roster** : tri du tableau au clic sur l'en-tête des colonnes (perso, joueur, classe, spés, niveau, race, intérêts, métiers), dans les deux sens, conservé quand on change de filtre. Les cases vides restent en fin de liste.

### Corrigé

- **Admin → Progression** s'affiche beaucoup plus vite : les rôles des nouveaux membres sont relus sur Discord en une seule requête, au lieu d'une par membre (Discord freinait ces appels en rafale).

## [0.10.0] - 2026-10-30

### Ajouté

- **Admin → Statistiques** (officiers) : rôles des mains (avec spés secondaires et rerolls), tableau des classes par rôle, métiers avec meilleurs niveaux et artisans, niveaux et intérêts des mains, activité sur le site, fiches à compléter avec copie des mentions Discord. Les classes et rôles recherchés dans le recrutement sont mis en évidence.
- `scripts/version.mjs` : change le numéro de version partout (paquet, fichiers compose, CHANGELOG), avec un test qui vérifie que tout concorde.

### Modifié

- Les fichiers `docker-compose.yml` et `docker-compose.traefik.yml` utilisent l'image publiée de la version en cours (`ghcr.io/fmplaw/innkeeper:X.Y.Z`) au lieu de construire depuis les sources.
- README : installation sans cloner le dépôt, mise à jour d'une instance, publication d'une version.

## [0.9.1] - 2026-10-30

### Ajouté

- Icône du projet (enseigne d'auberge), utilisée aussi comme favicon par défaut.
- Captures d'écran dans le README, prises sur une guilde de démonstration.
- Ce journal des modifications.

### Corrigé

- Page d'une sortie : espaces manquants dans « organisé par », le nombre de places, la spé des inscrits et la liste du banc.
- Page d'une sortie : « Modifier mon inscription » reprend le perso et le statut de l'inscription actuelle, au lieu du main en « Présent ».

## [0.9.0] - 2026-10-30

Première version publique.

### Ajouté

- **Installation guidée** : assistant en deux étapes (application Discord, profil de guilde), compte admin local de secours, réglages modifiables ensuite dans l'admin. Conseils pour nommer l'application et configurer le bot.
- **Connexion Discord** : accès selon les rôles du serveur (officier, membre ou aucun), synchronisation des noms des rôles par le bot.
- **Persos** : main et rerolls, nom de famille, race, classe, spé, niveau, métiers et recettes, intérêts PvE et PvP. Données de World of Warcraft: Forever (races Skyborne, nouvelles instances).
- **Roster** : filtres par classe, rôle, métier et intérêts, répartition par rôle et par classe, rosters nommés par les officiers.
- **Candidatures** : formulaire de candidature, avis des officiers (+1 / −1 justifié), annonce dans le salon des officiers, décision envoyée en message privé, entrée directe sur le serveur Discord avec le rôle d'arrivée, sans repasser par le questionnaire.
- **Progression** des nouveaux membres : rappel aux officiers après un délai réglable, sans aucune promotion automatique.
- **Sorties Raid-Helper** : liste des sorties à venir, création depuis le site à partir de modèles, inscription et banc depuis le site, modification et suppression, composition du groupe par rôle et par classe, comparaison avec un roster. Images par type de sortie et par instance.
- **Sorties des membres** : chaque membre peut proposer des sorties (hors raids) dans un salon dédié, trois à venir au plus par joueur.
- **Addon InnkeeperSync** : export du registre de guilde et des métiers depuis le jeu, import dans le site avec aperçu, badge « en jeu ».
- **Admin** : membres Discord sans compte sur le site, journal d'audit réservé à l'admin de l'instance, page de confidentialité.
- **Apparence** : palettes Horde, Alliance et multi-faction, logo, bannière et couleur d'accent de la guilde, affichage adapté aux téléphones.
- **Exploitation** : image Docker multi-architecture publiée par la CI, sauvegardes de la base, point de contrôle `/healthz`.

[Non publié]: https://github.com/fmplaw/innkeeper/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/fmplaw/innkeeper/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/fmplaw/innkeeper/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/fmplaw/innkeeper/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/fmplaw/innkeeper/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/fmplaw/innkeeper/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/fmplaw/innkeeper/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/fmplaw/innkeeper/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/fmplaw/innkeeper/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/fmplaw/innkeeper/releases/tag/v0.9.0
