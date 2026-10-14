# Sauvegarde et restauration de la base

Jusqu'au **2026-09-13**, ce dépôt n'avait **aucun** moyen de sauvegarder la base : une erreur de manipulation était définitive, et la seule copie des données d'école vivait dans un projet Supabase dont personne ne relisait l'état. Ce document décrit l'outillage qui existe maintenant, **ce qu'il couvre et ce qu'il ne couvre pas**, et l'état mesuré de la base à cette date.

## Ce qu'une sauvegarde contient

`npm run backup:db` lit les tables déclarées **une seule fois** dans `scripts/lib/db-tables.mjs` et écrit deux fichiers dans un dossier :

| fichier | ce qu'il porte |
|---|---|
| `payload.json` ou `payload.json.enc` | le contenu, table par table, en JSON |
| `manifest.json` | projet, date, **nombre de lignes par table**, empreinte du contenu de chaque table, empreinte du fichier, et sa propre empreinte |

Le manifeste est ce qui distingue une sauvegarde d'un fichier : il **dit ce qu'il contient**. « Sauvegarde OK » sans chiffres ne se distingue pas d'un export vide — et une base d'école sans élève est un cas légitime, qui doit donc se **lire**, pas se supposer.

**Les réglages d'affichage voyagent avec elle** (depuis le 2026-10-19). Le thème, la densité des tableaux, le verre des icônes et la langue vivent maintenant en lignes d'`app_settings` (clés préfixées `display.`, voir `supabase/migrations/20261019000000_display_preferences.sql`) en plus du `localStorage` du poste : une école réinstallée retrouve donc son thème, sa densité, son verre et sa langue au lieu de repartir aux défauts compilés. Deux propriétés font que ça marche **dans une cible fraîche**, et elles sont volontaires : ces lignes laissent `updated_by` **NUL** (un auteur nommé les rendrait non restaurées — les comptes ne voyagent pas), et le poste qui les reçoit **adopte** la copie au lieu de la subir (un poste qui a déjà choisi son thème garde le sien). Aucune ligne n'est ensemencée : une clé absente veut dire « personne n'a jamais réglé », donc les constantes de défaut restent dans le code, à un seul endroit.

```bash
npm run backup:db                                  # local, lit .env, écrit .backup/current
npm run backup:db -- --out /tmp/backup --encrypt    # chiffré (BACKUP_PASSPHRASE requis)
npm run backup:verify -- --from .backup/current     # relit SANS aucune base
```

**Le chiffrement n'est pas optionnel en CI.** Le workflow `backup-watch.yml` lance la sauvegarde avec `--require-encryption`, et le script **refuse** alors d'écrire en clair : dans un dépôt **public**, un artefact de workflow est téléchargeable par n'importe qui, donc un dump lisible remonté là serait une fuite. L'archive (scrypt + AES-256-GCM, en-tête `MTFB1`) n'est ouvrable qu'avec `BACKUP_PASSPHRASE`.

Deux refus qui protègent le geste :

- **une table illisible fait échouer la sauvegarde** (exit 1) et **rien n'est écrit** — une sauvegarde partielle qui a l'air complète est plus dangereuse qu'aucune sauvegarde ;
- **une réponse perdue ne duplique rien** : l'écriture de la sauvegarde est rejouable (sonde de réconciliation), comme le reste de la chaîne E2E de ce dépôt.

## La copie : ce qui existe, et quand ça expire

`backup-watch.yml` dépose l'archive chiffrée en **artefact de workflow, retenu 30 jours**. C'est aujourd'hui la **seule copie hors de la base** :

| fait | conséquence |
|---|---|
| l'artefact est supprimé 30 jours après son dépôt | passé cette date, il ne reste **aucune** sauvegarde — la base est de nouveau le seul exemplaire |
| l'archive n'est lisible qu'avec `BACKUP_PASSPHRASE` | une archive sans sa phrase est un fichier inerte, et la phrase ne vit que dans les secrets du dépôt |
| aucun stockage hors GitHub n'est configuré | le classement (« où », « qui », « quand ») est un geste de l'école, pas du code : en inventer un serait une décision qui ne se prend pas dans un workflow |

Chaque run écrit donc son échéance dans le résumé : nom de l'artefact, **date limite**, lien de téléchargement. La règle à tenir est courte : **au moins une archive téléchargée et rangée hors de GitHub avant la date limite du résumé** (une par mois couvre la fenêtre de 30 jours ; une par semaine est plus confortable).

## L'escrow de la phrase

Une sauvegarde chiffrée dont la phrase est perdue est une sauvegarde perdue — et le cas n'est pas théorique : la phrase vit dans un secret GitHub, donc elle disparaît avec l'accès au dépôt, avec la personne qui l'a posée, ou avec une rotation de secret faite sans noter l'ancienne valeur.

Ce qui doit exister, et qui n'est **pas** dans ce dépôt (vérifiable : `grep -r BACKUP_PASSPHRASE` ne rend que des lectures depuis l'environnement, jamais une valeur) :

1. **deux copies, deux lieux** — par exemple un coffre de mots de passe et une enveloppe scellée au bureau. Une seule copie n'est pas un escrow, c'est un espoir ;
2. **deux personnes** qui savent où elles sont. Qui détient l'enveloppe se note **au bureau**, pas ici ;
3. **une vérification qui n'expose rien** : depuis n'importe quel poste, avec une archive téléchargée et la phrase saisie à la main,

   ```bash
   npm run backup:verify -- --from <dossier-de-l-archive>   # déchiffre, vérifie le manifeste, recompte
   ```

   une phrase fausse est **refusée en le disant** (exit 1) : cette commande est donc aussi le test de l'escrow. Tant qu'elle passe avec la copie du coffre, l'escrow vaut ;
4. **une règle de rotation** : changer la phrase rend les **anciennes** archives illisibles avec la nouvelle. Si elle est changée, les archives encore valables doivent être retéléchargées puis re-chiffrées avec la nouvelle — ou leur ancienne phrase conservée avec elles.

## Ce qu'une sauvegarde ne contient PAS

- **Les comptes `auth.users` et leurs mots de passe.** Les empreintes bcrypt ne sortent pas par l'API REST. Restaurer une sauvegarde restaure les **données**, pas les identifiants : les lignes qui référencent un compte absent (`user_profiles`, `app_settings.updated_by`, `calendar_notes.created_by`) sont **nommées** comme non restaurées — jamais perdues en silence. Pour les comptes, la voie reste `scripts/migrate-auth-users.mjs` (copie pg) ou la recréation par l'API admin, puis un mot de passe à choisir.
- **Le schéma** (tables, colonnes, RLS) : il vit dans `supabase/migrations` et `supabase/FULL_SETUP_MIGRATION.sql`. Une restauration suppose donc un schéma **déjà en place**.
- **Les fichiers du Storage** Supabase, s'il en existe un jour : aucun aujourd'hui.

## Restaurer

```bash
npm run restore:db -- --from .backup/current --dry-run   # dit ce qui serait écrit, sans rien écrire
npm run restore:db -- --from .backup/current             # écrit (idempotent)
```

Trois refus **avant** la première écriture, parce qu'une restauration est le dernier endroit où l'on peut encore se tromper :

1. **le contenu ne correspond pas à son manifeste** → rien n'est écrit (fichier tronqué, retouché, mauvais mot de passe) ;
2. **la cible n'est pas vide** → rien n'est écrit sans `--force` : restaurer par-dessus une base vivante mélangerait deux états ;
3. **la sauvegarde vient d'un autre projet** → refus sans `--allow-project-mismatch` : verser la production dans un bac à sable est légitime, l'inverse doit être conscient.

Deux drapeaux pour les cibles de **travail** uniquement, parce qu'un schéma neuf n'est jamais tout à fait vide (les migrations ensemencent des années scolaires et un réglage) :

- `--empty-first` vide la cible avant de restaurer, pour qu'un aller-retour puisse exiger l'**égalité** des comptes — et il **refuse la base partagée**, par son ref, avant la première requête : c'est le seul geste de cette chaîne qui pourrait effacer une école ;
- `--force` restaure par-dessus une cible peuplée (lignes en conflit **écrasées**) sans la vider.

L'écriture est **idempotente par construction** : insertion en `resolution=merge-duplicates` sur la clé primaire, et sonde qui relit la ligne par sa clé (`?<pk>=eq.<valeur>`) avant tout rejeu. Après restauration, chaque table est **recomptée** et comparée au manifeste : une restauration qui n'a pas restauré est rouge.

### Restaurer dans un projet HÉBERGÉ (procédure pas à pas)

L'aller-retour exercé en CI se fait sur une **pile locale** (`supabase start`). Restaurer dans un projet **hébergé** ne s'était jamais fait — c'est écrit ici pour que la première fois ne soit pas improvisée. L'ordre compte, et chaque étape se vérifie avant la suivante :

1. **un projet de destination qui n'est PAS la production** (un bac à sable Supabase), avec son propre ref ;
2. **le schéma d'abord, les données ensuite** — sans schéma, rien ne se restaure :
   - soit les migrations une par une, dans l'ordre de leur nom : `npm run db:apply -- supabase/migrations/<fichier>.sql` — **mais cette commande écrit sur la base PARTAGÉE** (voir l'avertissement ci-dessous) ;
   - soit le script complet dans l'éditeur SQL du projet de destination : `supabase/FULL_SETUP_MIGRATION.sql`. C'est le même contenu dans le même ordre, et c'est **le** chemin pour un bac à sable ;
3. **les données** : `npm run restore:db -- --from <dossier> --allow-project-mismatch` (le drapeau est requis : la sauvegarde vient d'un autre projet). Le script refuse **avant** la première écriture si le contenu ne correspond pas à son manifeste, si la cible n'est pas vide, ou si le projet ne correspond pas ;
4. **la preuve** : `npm run backup:roundtrip` recompte la cible, table par table, et exige l'égalité avec le manifeste ;
5. **les comptes** : ils ne voyagent pas (`auth.users` n'est pas dans une sauvegarde). Le rapport nomme les lignes non restaurées — les recréer par `scripts/migrate-auth-users.mjs` ou par l'API admin, puis choisir un mot de passe ;
6. **ne PAS pointer l'application livrée sur le bac à sable** : la base servie est vérifiée à chaque build (`check:shared-db`) et à chaque déploiement (`check:shared-db:live`). Un changement de destination passe par ces contrôles, jamais par une variable posée à la main sur un poste.

⚠️ **`npm run db:apply` écrit sur la base PARTAGÉE `rpcjdohfxwukbqngbprw`** : ne l'utilisez pas pour préparer un bac à sable. Pour un projet de destination, passez par son éditeur SQL (ou `psql` avec sa propre chaîne de connexion).

## Une mise à jour de l'application ne touche pas les données

C'est le point qui inquiète le plus, et il tient à trois faits distincts :

1. **Les données d'école ne sont pas dans l'application.** Elles vivent dans la base Postgres **partagée** (`rpcjdohfxwukbqngbprw`) : une mise à jour remplace des fichiers de programme sur le poste, jamais des lignes sur le serveur. La base que l'application livrée interroge est vérifiée à chaque build (`check:shared-db`) et le site déployé est relu à chaque déploiement (`check:shared-db:live`).
2. **Ce qui vit sur le poste est dans `userData`** — la **file d'attente hors ligne** (un paiement saisi sans réseau : de la vraie donnée d'école en attente), les notes lues, le journal de mise à jour. Ce dossier est nommé par `appId` (`com.mamathera.finance`) et `productName` (`MamaTheraFinance`), qui **n'ont pas changé depuis la première version** : le même dossier est donc réutilisé d'une version à l'autre. Les renommer orphelinerait les données locales de tout le parc — `tests/update-retention.test.ts` verrouille cette identité.
3. **Désinstaller ne les efface pas non plus** (`deleteAppDataOnUninstall: false` dans `electron-builder.yml`) : une désinstallation suivie d'une réinstallation ne doit pas emporter la file d'attente d'une école.

Ce qui n'est **pas** conservé, et qui est normal : la **session** (le jeton est rangé par onglet, `sessionStorage`) — après une mise à jour il faut se reconnecter. Se reconnecter ne perd rien : les données sont sur le serveur, pas dans la session.

## L'aller-retour est exercé en CI, sur la vraie base

`backup-roundtrip.yml` fait ce qu'aucun contrôle local ne peut faire : il prend une **vraie** sauvegarde de la base partagée, démarre une **pile Supabase locale vide** (les 22 migrations appliquées), y **remet** cette sauvegarde (`restore:db --allow-project-mismatch`), puis `npm run backup:roundtrip` **recompte la cible lui-même**, table par table, et exige l'égalité avec le manifeste.

- une table qui perdrait des lignes rend le job **rouge en la nommant** (le contrôle ne croit ni le script de sauvegarde ni celui de restauration : il recompte) ;
- les lignes dont le compte `auth.users` n'existe pas dans la cible sont **calculées, nommées et comptées à part** — elles ne peuvent pas revenir, leurs mots de passe ne voyagent pas par l'API REST ;
- si la base ne contient **aucune** donnée métier, le verdict le dit (`tables métier VIDES des deux côtés`) : un vert prouve alors le tuyau, pas des données.

## Ce qui est prouvé, et ce qui ne l'est pas encore

| geste | preuve |
|---|---|
| sauvegarde réelle de la production, chiffrée | faite le 2026-09-13 : **353 lignes dans 14 tables**, 127 Ko chiffrés, manifeste vérifié |
| relecture sans base (déchiffrement + manifeste + recomptage) | `npm run backup:verify` sans credentials : vert ; sans le mot de passe : refus nommé |
| refus (contenu retouché, manifeste absent, dossier vide) | `tests/backup-manifest.test.ts`, 22 cas |
| **restauration réelle dans un projet vide** | **pas encore faite** — la seule base joignable est la production, et on ne « teste » pas une restauration en production. Le premier exercice se fait sur une pile locale (`supabase start`) ou sur un projet bac à sable, puis la cible doit être vidée avant un vrai retour en production. La procédure pas à pas est écrite ci-dessus (« Restaurer dans un projet HÉBERGÉ ») ; l'aller-retour **local**, lui, tourne en CI. |
| **copie hors GitHub** | **pas encore** — la seule copie est l'artefact de 30 jours. Chaque run publie sa date limite (résumé du run) ; le classement est un geste de l'école, il n'est pas automatisable depuis ce dépôt. |
| **escrow de la phrase** | **pas encore** — procédure écrite ci-dessus, et la phrase n'apparaît dans aucun fichier versionné (vérifié). Mais aucune copie hors du dépôt n'existe : tant que l'escrow n'est pas posé, une perte du secret rend toutes les archives illisibles. |

Un exercice de restauration qui n'a jamais été fait est une hypothèse, pas une garantie : c'est écrit ici pour que personne ne le découvre le jour où il en a besoin.

## Ce que la base contient — mesuré le 2026-09-13

| table | lignes |
|---|---|
| `students`, `parents`, `staff`, `payments`, `salary_payments`, `expenses`, `vendor_expenses`, `todos`, `custom_classes`, `calendar_notes` | **0** |
| `academic_years` | 4 |
| `app_settings` | 1 |
| `user_profiles` | 4 (les quatre comptes propriétaires) |
| `audit_logs` | 344 |

Autrement dit : **la base porte la configuration et le journal, pas les données d'école** — aucun élève, aucun paiement, aucune dépense. Deux lectures possibles, et une seule est vraie :

- l'école n'a pas encore commencé à saisir : alors la sauvegarde quotidienne est déjà utile pour la configuration, et le reste suivra ;
- les données existent ailleurs : l'ancien projet `vulbmmzhcmnzswcvswfk` **répond encore** (`GET /auth/v1/health` → **HTTP 401**, mesuré le 2026-09-14 ; la note « ne résout plus » datait d'un moment où le DNS ne répondait pas, elle est corrigée ici). S'il détient les données de l'école, c'est **la dernière copie** — et il faut la rapatrier maintenant :
  - depuis un dump `pg_dump` : le remettre dans un projet bac à sable, puis `npm run restore:db` (ou `scripts/migrate-auth-users.mjs` pour les comptes) ;
  - depuis un autre projet Supabase : même chemin, avec `--allow-project-mismatch` si la sauvegarde vient d'ailleurs.

`npm run backup:db` finit par cette ligne quand une table métier est vide :

```
⚠️  aucune ligne métier : students, parents, staff, payments, … — la sauvegarde est valide,
   mais elle ne protège pas des données qui ne sont pas là
```

C'est volontaire : une sauvegarde quotidienne qui se tairait sur une base vide laisserait croire que les données sont protégées alors qu'elles n'y sont pas.
