# Guide d'utilisation d'Innkeeper

Ce guide explique comment utiliser au quotidien le site de ta guilde, propulsé par Innkeeper.

- [Pour tous les membres](#pour-tous-les-membres)
  - [Se connecter](#se-connecter)
  - [Créer ses fiches de persos](#créer-ses-fiches-de-persos)
  - [Synchronisation automatique (application pour PC)](#synchronisation-automatique-application-pour-pc)
  - [Le roster et les pages joueurs](#le-roster-et-les-pages-joueurs)
  - [Les sorties](#les-sorties)
  - [Proposer une sortie](#proposer-une-sortie)
- [Pour les candidats](#pour-les-candidats)
- [Pour les officiers](#pour-les-officiers)
- [Pour l'admin du site](#pour-ladmin-du-site)
- [En cas de problème](#en-cas-de-problème)

---

## Pour tous les membres

### Se connecter

1. Sur le site, clique sur **« Se connecter avec Discord »**.
2. Tu arrives sur **discord.com**, la page officielle de Discord. Vérifie le compte affiché : ce doit être **celui que tu utilises sur le serveur de la guilde**.
3. Clique sur **Autoriser**. Tu reviens sur le site, connecté.

Sur téléphone, les pages du site sont dans le menu **☰** en haut, avec ton nom et le bouton de déconnexion.

Le site ne voit jamais ton mot de passe. Discord lui transmet seulement ton identifiant, ton pseudo, ton avatar et tes rôles sur le serveur de la guilde. Ce sont ces rôles qui déterminent ce que tu vois : membre ou officier.

> **Pas reconnu comme membre ?** Ton navigateur est probablement connecté à un autre compte Discord que celui de ton appli. Voir [En cas de problème](#en-cas-de-problème).

### Créer ses fiches de persos

Menu **Mes persos** → **Ajouter un perso**.

| Champ | Conseil |
|---|---|
| **Nom** | **Exactement comme en jeu**, accents compris : il sert à relier ta fiche aux données importées du jeu. Le site le met en forme tout seul (une majuscule, le reste en minuscules). |
| Nom de famille | **Obligatoire**, comme dans Forever. Même mise en forme que le nom. |
| Race, classe | La liste ne propose que les combinaisons possibles dans Forever. |
| Spé et rôle | Ta spécialisation principale ; la **spé secondaire** (double spé) à partir du niveau 40. |
| Niveau | 1 par défaut. À mettre à jour de temps en temps, ou automatiquement après un import du jeu. |
| Métiers | Deux métiers principaux au plus, plus les secondaires (cuisine, secourisme, pêche). Un métier coché démarre au niveau 1. |
| Recettes | Texte libre pour tes spécialités (« flacons », « cape de résistance au feu »…). |
| Intérêts | PvE et PvP : pas intéressé, détente ou compétitif. |
| Notes | Visibles seulement par toi et les officiers. |

**Main et rerolls** : ton premier perso devient ton **main**. Les suivants sont des rerolls rattachés à ton main. Pour changer de main, clique sur **« Définir comme main »** sous le reroll concerné, dans Mes persos. Un main qui a encore des rerolls ne peut pas être supprimé.

**Le badge « en jeu »** : après chaque import du registre de guilde par un officier, tes persos affichent :

- **✔ en jeu** : le perso a été trouvé dans la guilde en jeu ;
- **⚠ pas trouvé en jeu** : aucun perso de ce nom dans la guilde. Vérifie l'orthographe du nom sur ta fiche ;
- **« pas encore vérifié »** : la fiche a été créée après le dernier import.

### Synchronisation automatique (application pour PC)

Mes persos → **Synchronisation automatique** : la petite application **InnkeeperSync**, sur ton PC, envoie au site les données de l'addon chaque fois que le jeu les enregistre (à la déconnexion ou après un `/reload`). Plus de fichier à déposer à la main.

1. Installe l'addon **Innkeeper Sync** dans le jeu : le plus simple est de le chercher dans l'application CurseForge ou Wago (version de jeu : World of Warcraft: Forever), qui le tiendra à jour. Sinon, le lien de la page donne un zip à décompresser dans `Interface/AddOns`.
2. Télécharge et installe **InnkeeperSync pour Windows** (lien sur la page). Si Windows affiche un avertissement (application non signée) : « Informations complémentaires », puis « Exécuter quand même ».
3. Sur la page, clique sur **Connecter InnkeeperSync** : l'application s'ouvre et te montre le site de ta guilde ; vérifie-le et confirme. Elle trouve toute seule le dossier du jeu (sinon : « Choisir le dossier »).
4. En jeu, tape `/innkeeper` de temps en temps, et ouvre tes fenêtres de métier pour envoyer tes recettes.

Ensuite, InnkeeperSync se fait oublier : elle démarre avec Windows et reste près de l'horloge (fermer sa fenêtre ne l'arrête pas). Quand une nouvelle version sort, la fenêtre l'annonce avec un bouton **Mettre à jour** ; au démarrage de Windows, elle s'installe toute seule. « Rechercher une mise à jour », en bas de la fenêtre, vérifie à la demande. Un clic sur son icône montre l'état et les derniers envois.

Une clé de **membre** met à jour tes persos seulement ; une clé d'**officier** met à jour toute la guilde. Chaque connexion crée une clé, visible dans « Mes clés » et révocable d'un clic (PC changé, application désinstallée).

### Le roster et les pages joueurs

- **Roster** : la liste des persos de la guilde, avec des filtres par classe, rôle, faction, intérêts, métier et niveau de métier. Par défaut, **seuls les mains** sont affichés, pour une vue juste de l'effectif ; choisis « Mains et rerolls » pour tout voir. Un clic sur l'en-tête d'une colonne trie le tableau, un second clic inverse l'ordre ; le tri reste en place quand tu changes de filtre. Les onglets en haut montrent les **rosters** composés par les officiers (équipe de raid…).
- **Charte** : la charte et le règlement de la guilde, dans le menu dès que les officiers l'ont publiée. Elle est lisible par tous, même sans connexion.
- **Addons** : le tableau des addons que conseille la guilde, du plus important (indispensables, recommandés en raid) au confort, avec pour chacun pourquoi la guilde le conseille et son lien de téléchargement. Filtres : recherche, statut, usage, et « Pour mon main », qui ne garde que ce qui concerne la classe et le rôle de ton main.
- **Page joueur** : un clic sur un nom affiche ses persos, ses métiers, ses recettes connues et ses rosters.

### Les sorties

Menu **Sorties** : deux listes, **sorties officielles** et **sorties des membres**, avec la date, l'organisateur et le nombre d'inscrits.

Sur la page d'une sortie :

- **Mon inscription** : choisis ton perso, ta spé (principale ou secondaire) et ton statut :

  | Statut | Signification |
  |---|---|
  | Présent | Tu viens, dans le rôle de ta spé. |
  | Remplaçant | Disponible si besoin : tu es mis sur le banc avec ta spé, les organisateurs savent quel rôle tu peux tenir. |
  | Peut-être | Pas encore sûr. |
  | En retard | Tu arriveras après le début. |
  | Absent | Tu ne viens pas. |

  Ton inscription apparaît aussi sur le message Raid-Helper dans Discord, sous le nom de ton perso. Tu peux la **modifier** ou te **désinscrire** à tout moment.
- **Groupe complet** : si toutes les places sont prises, une nouvelle inscription « Présent » passe automatiquement sur le banc.
- **Composition** : les inscrits par rôle, les remplaçants de chaque rôle, et ce qui manque (« Il manque : 1 tank »). Pour un raid, la répartition par classe et la comparaison avec un roster.
- **Actualiser** : une inscription faite sur Discord apparaît sur le site en une minute au plus ; ce bouton la fait apparaître tout de suite.

Tu peux aussi t'inscrire directement sur Discord avec les boutons de Raid-Helper : c'est la même liste.

### Proposer une sortie

Bouton **Proposer une sortie** (page Sorties).

1. **Type de sortie** : donjon, quêtes, farm/métiers, PvP ou autre. Les raids sont organisés par les officiers.
2. Pour un donjon : choisis-le dans la liste. Le titre, le nombre de places (5) et la tranche de niveau se remplissent tout seuls ; les nouveautés de Forever sont signalées.
3. **Description** : rendez-vous, prérequis, consommables…
4. **Date et heure**, puis **Proposer la sortie**.

La sortie est publiée dans le salon des sorties des membres, avec toi comme organisateur. Depuis sa page, tu peux la **modifier** (titre, description, date, heure) ou la **supprimer**. Tu peux avoir **trois sorties à venir** au plus en même temps.

---

## Pour les candidats

Si tu n'es pas encore membre de la guilde, tu peux postuler depuis le site, même sans être sur le serveur Discord.

1. Connecte-toi avec Discord : le site te propose de **postuler**.
2. Remplis la fiche de ton perso et réponds aux questions de la guilde. Si la guilde a publié une **charte**, elle s'affiche en bas du formulaire : lis-la et coche « J'ai lu la charte et je m'engage à la respecter », sans quoi la candidature ne part pas.
3. Suis ta candidature dans **Ma candidature**. Si tu es déjà sur le serveur Discord, le bot te prévient aussi en message privé de la décision.
4. **Acceptée** : clique sur **« Rejoindre le serveur Discord »** et autorise Discord. Le bot te fait entrer directement, avec ton rôle de nouveau membre, sans questionnaire.
5. **Refusée** : tu pourras repostuler après le délai fixé par la guilde.

---

## Pour les officiers

Les officiers ont accès au menu **Admin**. Le compteur du menu signale les candidatures en attente et les nouveaux membres à revoir.

### Candidatures

Admin → **Candidatures** :

- donne ton avis **+1 ou −1** (un −1 doit être justifié) ; chaque officier a un avis, modifiable ;
- **n'importe quel officier peut accepter ou refuser**, avec un message facultatif au candidat. Accepter malgré des avis défavorables demande une confirmation ;
- à l'acceptation, le perso de la candidature devient le main de la recrue, et le bot lui donne le rôle d'arrivée.

### Progression des nouveaux membres

Admin → **Progression** : les porteurs du rôle d'arrivée, du plus ancien au plus récent, avec leur dernière connexion en jeu. Au-delà du délai de revue, ils sont signalés **« À revoir »**. La promotion se fait sur Discord ; **« Revu »** repousse le rappel de 30 jours. **Aucune promotion n'est automatique.**

### Joueurs

Admin → **Joueurs** :

- tous les joueurs connectés au moins une fois, avec leurs persos ;
- **« Sur Discord, sans compte sur le site »** : les membres du serveur qui ont accès au site mais ne s'y sont jamais connectés. Le bouton **« Copier les mentions »** prépare un message de relance à coller sur Discord.

### Statistiques

Admin → **Statistiques** : une vue d'ensemble pour repérer les manques. Seuls les joueurs qui ont encore accès au site sont comptés.

- **Rôles des mains** : répartition, mains capables de passer à un rôle avec leur spé secondaire, rerolls. Les rôles cherchés dans le recrutement sont marqués « recherché ».
- **Classes** : mains par rôle pour chaque classe jouable par la guilde (un tiret quand la classe ne peut pas tenir ce rôle), rerolls en clair, classes sans aucun main signalées.
- **Métiers** : nombre de persos (rerolls compris), meilleur niveau et les trois artisans les plus avancés ; un métier que personne n'a est signalé.
- **Niveaux** et **intérêts** PvE/PvP des mains.
- **Activité** : dernière connexion au site (cette semaine, ce mois-ci, plus de 30 jours) et, après un import du jeu, mains trouvés dans le registre de guilde. La liste des absents depuis plus de 30 jours se déplie.
- **Fiches à compléter** : joueurs sans perso, ou à qui il manque un nom de famille, la spé, les métiers ou les intérêts du main. **« Copier les mentions »** prépare la relance sur Discord.

### Rosters

Admin → **Rosters** : crée des équipes nommées (« Roster raid principal »…), visibles par les membres ou réservées aux officiers. Les persos s'ajoutent depuis la page **Roster**, onglet de l'équipe. Sur une sortie de raid, compare les inscrits avec un roster : inscrits, absents, persos hors roster.

### Sorties officielles

Bouton **Nouvelle sortie** (page Sorties), en choisissant **« Sortie officielle »** :

- type de sortie et instance (les raids indiquent leur date d'ouverture), titre, description, date, heure, salon et chef de raid ;
- un **modèle** préremplit tout (Admin → Sorties → Modèles : « Raid du mercredi 21h », avec un roster à comparer) ;
- si l'option est activée, un **événement Discord** est créé en plus, avec rappels.

Les officiers peuvent modifier ou supprimer **toutes** les sorties, et proposer aussi des sorties membres.

Admin → **Sorties** contient aussi :

- les **salons** des sorties officielles et des sorties membres ;
- les **images des sorties** : une par type et par instance, affichées sur Discord et sur le site (vrai fichier PNG, JPEG ou WebP, dont l’extension correspond au contenu ; 2 Mo au plus, format 16:9 conseillé). N'utilise que des images que la guilde a le droit de diffuser.

### Import du jeu

Admin → **Import du jeu**, à faire par un officier de temps en temps (une fois par semaine par exemple) :

1. Télécharge l'**addon InnkeeperSync** et décompresse-le dans `Interface/AddOns` du jeu.
2. En jeu, avec un perso de la guilde : tape **`/innkeeper`** (ou `/ik`). Pour exporter tes recettes, ouvre la fenêtre de chacun de tes métiers. Puis tape **`/reload`**.
3. Dépose le fichier `WTF/Account/<TON COMPTE>/SavedVariables/InnkeeperSync.lua`.
4. Vérifie l'**aperçu** :
   - niveaux et métiers qui changent ;
   - **membres de la guilde sans fiche** (à relancer) ;
   - **fiches introuvables en jeu** (nom mal écrit ?) ;
   - fiches déjà à jour d'après un **export plus récent** : un vieux fichier ne fait pas revenir un perso en arrière (seules ses recettes encore inconnues s'ajoutent).
5. **Appliquer l'import**.

L'addon n'envoie rien sur Internet ; il écrit seulement ce fichier. Il n'exporte ni les notes du registre (publiques et d'officier) ni la zone des membres.

**Plus simple : la synchronisation automatique.** Avec l'application InnkeeperSync pour PC, connectée par un officier (voir plus haut), le registre de la guilde est envoyé tout seul à chaque déconnexion, sans aperçu à valider.

### Recrutement et rôles

- Admin → **Recrutement** : rôle d'arrivée, salons des annonces et des invitations, questions aux candidats, délais.
- Admin → **Rôles Discord** : permission de chaque rôle (Officier, Membre, Aucune) et mode d'accès au site.
- Admin → **Charte** : la charte et le règlement de la guilde, avec un aperçu en direct. Mise en forme : `# Titre`, `## Sous-titre`, `- élément de liste`, `**gras**`, `*italique*`, ligne vide entre les paragraphes. Sur la page, chaque `## Sous-titre` devient un encadré : regroupe par exemple les valeurs de la guilde sous un `# Titre`, une valeur par `##`. Une dernière ligne entièrement en gras, comme une devise, s'affiche en bandeau tout en bas. Une fois publiée, elle apparaît dans le menu de tous et les candidats doivent l'accepter pour postuler ; la candidature l'indique par une pastille verte « ✔ Charte acceptée le … » (orange si la charte a été modifiée depuis). La laisser vide la retire. Chaque modification est notée dans le journal.
- Admin → **Addons** : la liste des addons conseillés, publiée sur la page Addons (visible de tous, même sans connexion ; le lien apparaît dans le menu dès qu'il y a un addon). Pour chacun : importance (Indispensable, Recommandé en raid, Recommandé, Utile, Confort), usage, public visé (classes, rôles ; rien de coché = tout le monde), une phrase sur ce qu'il fait et pourquoi la guilde le conseille, liens CurseForge, Wago ou autre. ▲▼ pour l'ordre dans chaque niveau. Un bouton ajoute **Innkeeper Sync** en un clic. Gardez peu d'indispensables : un nouveau doit voir l'essentiel d'un coup d'œil.
- Admin → **Guilde** : **type de serveur** (JcJ, JcE, JdR ou Hardcore), affiché sur l'accueil et en bas de chaque page ; présentation, logo, bannière, ambitions, horaires, recrutement affiché sur l'accueil. La **faction** choisie donne aussi l'ambiance du site (fond chaud pour la Horde, bleu nuit pour l'Alliance, neutre pour une guilde mixte) ; la couleur d'accent reste au choix.

---

## Pour l'admin du site

Le compte **admin local** (créé à l'installation) gère ce qui touche à l'instance :

- **Connexion Discord** : application, serveur, jeton et invitation du bot ;
- **clé API Raid-Helper** (Admin → Sorties) ;
- **Journal** : toutes les actions des officiers (fiches modifiées, décisions, sorties…), avec filtres, conservées un an ;
- **Compte admin** : changement de mot de passe.

Le compte admin local reste utilisable si Discord ne répond plus : `<adresse du site>/admin/connexion`.

---

## En cas de problème

| Problème | Cause probable et solution |
|---|---|
| **« Site dangereux » en rouge** dans le navigateur | Faux positif fréquent sur un site neuf avec une connexion Discord. Préviens l'admin du site, qui demande un réexamen à Google. |
| **Connecté, mais vu comme candidat** | Ton navigateur est connecté à un autre compte Discord. Déconnecte-toi du site, va sur discord.com/app, vérifie le compte en bas à gauche (déconnecte-le si ce n'est pas le bon), puis reconnecte-toi au site. |
| **Ton inscription faite sur Discord n'apparaît pas** | Délai d'une minute : clique sur **Actualiser** sur la page de la sortie. |
| **« Raid-Helper a refusé l'opération : missing permissions »** | Un droit manque à Raid-Helper dans le salon de la sortie (souvent « Utiliser des émojis externes »). Préviens un officier. |
| **« Tu as déjà 3 sorties à venir »** | Supprime une de tes sorties, ou attends qu'une soit passée. |
| **Ton perso est marqué « pas trouvé en jeu »** | Le nom de ta fiche ne correspond pas à celui du jeu : corrige-le dans Mes persos. |
| **Une sortie n'apparaît pas dans la liste** | La liste se rafraîchit toutes les quelques minutes ; une sortie créée hors du site n'apparaît que si le bot voit son salon. |

Pour toute autre question, contacte un officier de la guilde sur Discord.
