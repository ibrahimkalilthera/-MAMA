# Sauvegarde et restauration de la base

Jusqu'au **2026-09-13**, ce dépôt n'avait **aucun** moyen de sauvegarder la base : une erreur de manipulation était définitive, et la seule copie des données d'école vivait dans un projet Supabase dont personne ne relisait l'état. Ce document décrit l'outillage qui existe maintenant, **ce qu'il couvre et ce qu'il ne couvre pas**, et l'état mesuré de la base à cette date.

## Ce qu'une sauvegarde contient

`npm run backup:db` lit les tables déclarées **une seule fois** dans `scripts/lib/db-tables.mjs` et écrit deux fichiers dans un dossier :

| fichier | ce qu'il porte |
|---|---|
| `payload.json` ou `payload.json.enc` | le contenu, table par table, en JSON |
| `manifest.json` | projet, date, **nombre de lignes par table**, empreinte du contenu de chaque table, empreinte du fichier, et sa propre empreinte |

Le manifeste est ce qui distingue une sauvegarde d'un fichier : il **dit ce qu'il contient**. « Sauvegarde OK » sans chiffres ne se distingue pas d'un export vide — et une base d'école sans élève est un cas légitime, qui doit donc se **lire**, pas se supposer.

```bash
npm run backup:db                                  # local, lit .env, écrit .backup/current
npm run backup:db -- --out /tmp/backup --encrypt    # chiffré (BACKUP_PASSPHRASE requis)
npm run backup:verify -- --from .backup/current     # relit SANS aucune base
```

**Le chiffrement n'est pas optionnel en CI.** Le workflow `backup-watch.yml` lance la sauvegarde avec `--require-encryption`, et le script **refuse** alors d'écrire en clair : dans un dépôt **public**, un artefact de workflow est téléchargeable par n'importe qui, donc un dump lisible remonté là serait une fuite. L'archive (scrypt + AES-256-GCM, en-tête `MTFB1`) n'est ouvrable qu'avec `BACKUP_PASSPHRASE`.

Deux refus qui protègent le geste :

- **une table illisible fait échouer la sauvegarde** (exit 1) et **rien n'est écrit** — une sauvegarde partielle qui a l'air complète est plus dangereuse qu'aucune sauvegarde ;
- **une réponse perdue ne duplique rien** : l'écriture de la sauvegarde est rejouable (sonde de réconciliation), comme le reste de la chaîne E2E de ce dépôt.

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

L'écriture est **idempotente par construction** : insertion en `resolution=merge-duplicates` sur la clé primaire, et sonde qui relit la ligne par sa clé (`?<pk>=eq.<valeur>`) avant tout rejeu. Après restauration, chaque table est **recomptée** et comparée au manifeste : une restauration qui n'a pas restauré est rouge.

## Ce qui est prouvé, et ce qui ne l'est pas encore

| geste | preuve |
|---|---|
| sauvegarde réelle de la production, chiffrée | faite le 2026-09-13 : **353 lignes dans 14 tables**, 127 Ko chiffrés, manifeste vérifié |
| relecture sans base (déchiffrement + manifeste + recomptage) | `npm run backup:verify` sans credentials : vert ; sans le mot de passe : refus nommé |
| refus (contenu retouché, manifeste absent, dossier vide) | `tests/backup-manifest.test.ts`, 22 cas |
| **restauration réelle dans un projet vide** | **pas encore faite** — la seule base joignable est la production, et on ne « teste » pas une restauration en production. Le premier exercice se fait sur une pile locale (`supabase start`) ou sur un projet bac à sable, puis la cible doit être vidée avant un vrai retour en production. |

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
- les données existent ailleurs : l'ancien projet `vulbmmzhcmnzswcvswfk` **ne résout plus** (« domain name not found », mesuré), donc si un fichier ou un projet détient ces données, c'est **la dernière copie** — et il faut la rapatrier maintenant :
  - depuis un dump `pg_dump` : le remettre dans un projet bac à sable, puis `npm run restore:db` (ou `scripts/migrate-auth-users.mjs` pour les comptes) ;
  - depuis un autre projet Supabase : même chemin, avec `--allow-project-mismatch` si la sauvegarde vient d'ailleurs.

`npm run backup:db` finit par cette ligne quand une table métier est vide :

```
⚠️  aucune ligne métier : students, parents, staff, payments, … — la sauvegarde est valide,
   mais elle ne protège pas des données qui ne sont pas là
```

C'est volontaire : une sauvegarde quotidienne qui se tairait sur une base vide laisserait croire que les données sont protégées alors qu'elles n'y sont pas.
