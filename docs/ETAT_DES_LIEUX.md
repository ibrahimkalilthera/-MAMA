# État des lieux — 2026-10-11

Demande du propriétaire : « Effectue une analyse globale de l'application et fournis-moi un état des lieux des améliorations à apporter pour rendre l'application parfaite. Spécifie les aspects techniques, l'expérience utilisateur, la performance et tout autre facteur pertinent. »

Ce document n'est pas une liste de bonnes pratiques : chaque constat porte sa **mesure**, faite le 2026-10-11 sur le dépôt au commit `18d0dd1`, sur la base partagée `rpcjdohfxwukbqngbprw` (lectures seules, aucune écriture) et sur les runs CI du jour. Ce qui n'a pas pu être mesuré est **dit** à la fin, jamais comblé par une supposition.

> ✅ **Versionné le 2026-10-12.** Ce document est resté hors du dépôt tant que le point 3.0 était ouvert, comme il le demandait lui-même — le dépôt est public depuis le 2026-10-11. Le 3.0 est **fermé** : la migration `20261011000001_drop_students_dupe_backup.sql` supprime la table, et la garde qui **énumère** les tables de `public` (`npm run check:public-rls`, veille `public-rls-watch`) refuse désormais toute table sans RLS — **verte le 2026-10-12 15:30Z**, donc aucune table exposée en production. Il devient le document ordinaire qu'il annonçait.
>
> **Deux constats ont été refermés depuis, et sont mesurés ici :** le **9 / 4.6** (« Business E2E » rouge en permanence) et son geste au plan (ordre 10). Les deux workflows E2E montent maintenant **leur propre pile Supabase** — la recette métier le 2026-10-12 (`d804ca0`, run `38299556209`, vert) et le pixel-check PDF le même jour (`c3d447b`, run `38300159455`, vert) : aucun des deux n'écrit plus dans la base de l'école.

---

## 1. Ce qui a été mesuré, et par quel moyen

| mesure | canal |
|---|---|
| volumétrie de la base, par table | `Prefer: count=exact` + `Range: 0-0` sur chaque table (service_role, lecture) |
| troncature des réponses | une lecture **sans** `Range` sur `students`, `audit_logs`, `payments`, comparée à son `Content-Range` |
| justesse du registre | recalcul de `sum(payments.amount)` par élève, comparé à `students.amount_paid` (497 élèves) |
| numéros de reçu | recensement des valeurs distinctes sur les 97 paiements |
| exposition publique | lecture des 17 tables connues avec la **clé publique `anon`** (celle qui part dans le bundle du site), table par table |
| index déclarés | recensement des `CREATE INDEX` des migrations, comparé aux clés étrangères et aux colonnes filtrées |
| octets livrés | `dist/` et `electron-ui-dist/` (builds du 2026-10-06) |
| garde-fous | lecture des 18 workflows et de leurs derniers runs (`gh run list`) |
| code | volumétrie, marqueurs, motifs de requêtes sur `src/`, `electron/`, `scripts/`, `tests/` |

---

## 2. Le tableau des risques, classé

| # | risque | gravité | état mesuré |
|---|---|---|---|
| 1 | une table d'artefact est lisible par la **clé publique** du site | **P0** | **14 lignes d'élèves lues sans compte** : nom, téléphone du parent, notes médicales |
| 2 | `students.amount_paid` diverge de la somme des paiements, sans contrôle | **P0** | **1 élève sur 87 est faux ; −4 000 FCFA** |
| 3 | une écriture de la file hors ligne qui échoue est silencieuse | **P0** | `catch` → `console.error` seulement ; aucun plafond |
| 4 | troncature silencieuse d'une table au-delà de 1 000 lignes | P1 | non mordante aujourd'hui (audit_logs 749, students 497) |
| 5 | la seule sauvegarde vit dans un artefact GitHub de 30 jours | P1 | 5 derniers runs verts, rétention 30 j, aucune copie hors GitHub |
| 6 | des noms d'élèves réels vivent dans un dépôt **public** | P1 | 2 fichiers suivis (migration de dédoublonnage, rapport des doublons) |
| 7 | aucun rapport d'erreur du parc : un poste qui casse est muet | P1 | 0 collecteur, 0 `window.onerror` |
| 8 | base gratuite : 500 Mo puis **lecture seule**, sans alerte | P1 | volumétrie actuelle faible, aucune garde de croissance |
| 9 | « Business E2E » rouge en permanence | P1 | **résolu le 2026-10-12** (voir 4.6) — refusait `check:recette-base` sur base peuplée, identifié sur `cb38b3e` aussi |
| 10 | aucune budgétisation des octets livrés | P2 | seul seuil : score lighthouse médian **≥ 0,7** |
| 11 | accessibilité : pas de piège de focus, aucune région live | P2 | 0 `focusTrap`, 0 `aria-live`, 3 `htmlFor`, 1 `tabIndex` |
| 12 | numéro de reçu tiré d'un horodatage (10⁶ valeurs) | P2 | 97/97 distincts aujourd'hui ; collision probable vers ~1 200 reçus |
| 13 | artefacts et clés mortes dans l'arbre | P2 | `bun.lock` figé, `metadata.json` étranger, `GEMINI_API_KEY` inlinable |
| 14 | coût et fragilité de la chaîne locale | P2 | 2 min 36 s par commit (tests 74 %) ; 4 paniques de fork pendant la session |

---

## 3. P0 — ce qui est faux, ou lisible par un inconnu

### 3.0 Une table d'archive est ouverte à la clé publique

**Constat.** La migration `20261005000001_dedupe_students.sql` fabrique `public.students_dupe_backup_20261005` (`CREATE TABLE ... AS SELECT ... WHERE false`), y copie les fiches condamnées — c'est la réversibilité du dédoublonnage, et c'est une bonne idée — puis laisse la suppression en **commentaire** : « La sauvegarde se supprime UNE FOIS le nettoyage confirmé : `DROP TABLE …` ». Un `CREATE TABLE AS` n'active **pas** RLS, et les privilèges par défaut de Supabase ouvrent `SELECT` au rôle `anon`. Personne n'a exécuté la suppression.

**Mesure (2026-10-11, depuis l'extérieur).** Avec la **clé publique** — celle qui est inlinée dans le bundle (`App-*.js`, vérifié aussi bien dans `dist/` que dans `electron-ui-dist/`, donc servie à chaque navigateur et livrée à chaque poste ; c'est le modèle assumé de Supabase, la protection est la RLS) — **la table rend ses 14 lignes**. Sur une lecture de 5 lignes, **5 sur 5** portent un nom d'élève, **5 sur 5** un téléphone de parent, **5 sur 5** des notes médicales non vides. Colonnes renvoyées : 27, dont `name`, `parent_name`, `parent_phone`, `parent_email`, `medical_notes`, `note_entries`, `emergency_contact_phone`, `photo`, `previous_school`. Les autres tables du même relevé (dont `students`, `payments`, `parents`, `audit_logs`) répondent **0 ligne** à cette même clé (13 fermées, 3 refusées en HTTP 400/404 — colonne absente ou table non exposée) : la RLS tient partout ailleurs, le trou est exactement cet artefact.

**Pourquoi c'est le premier point de cette analyse.** Il ne s'agit pas d'un défaut d'ergonomie ni d'une dette : ce sont des **données personnelles de mineurs** — dont des notes médicales — lisibles depuis Internet, aujourd'hui, sans compte, sans trace. Le dépôt fait pourtant ce qu'il faut ailleurs : 210 politiques RLS, un contrôle anon en CI, une veille quotidienne `prod-anon-rls`. Les deux veilles lisent une **liste de tables déclarées** — elles ne pouvaient pas voir une table que personne n'avait déclarée. C'est la même leçon que le canal de mise à jour : *un mécanisme qui vérifie ce qu'on lui nomme est muet sur ce qu'on ne lui nomme pas*.

**Correctif, en deux temps.**

1. **Fermer maintenant** : archiver le contenu (il est déjà couvert par la sauvegarde chiffrée quotidienne, à vérifier avant de supprimer), puis `DROP TABLE public.students_dupe_backup_20261005;` — l'étape que la migration demandait et qui n'a pas eu lieu. Plus aucun geste manuel ne doit rester « à faire un jour » dans une migration : c'est la classe d'oubli qui produit ce document.
2. **Fermer la classe entière** : un contrôle qui **énumère les tables de `public`** (par `information_schema` / `pg_class`, en service_role) et **refuse toute table où RLS n'est pas activée** — sans liste à maintenir. Celui-là aurait attrapé cette table le jour de sa création, et attrapera la suivante. À porter en veille quotidienne, à côté de `prod-anon-rls`.

**Preuve attendue :** la clé publique rend **0 ligne** sur cette table (le test est déjà écrit : il suffit de le figer), et le contrôle d'énumération est **rouge** sur l'état d'aujourd'hui avant la suppression, vert après.

### 3.1 `amount_paid` est une valeur dérivée réécrite par le client, et elle est déjà fausse

**Constat.** `students.amount_paid` duplique ce que la table `payments` porte déjà. Il n'est pas calculé par la base : il est recalculé **dans l'application**, à partir d'un instantané mémoire de l'élève (`src/lib/dataOps/payments.ts` : `amount_paid: optimisticAmountPaid` à l'ajout, `Math.max(0, student.amountPaid - payment.amount)` à la suppression), puis réécrit en valeur absolue — et **l'erreur de cette mise à jour n'est pas lue**.

**Mesure (2026-10-11).** Sur 497 élèves, 87 ont des paiements. **86 se referment exactement. Un non** : `amount_paid` = 4 000 FCFA alors que ses deux lignes de paiement en totalisent 8 000. Écart global : **−4 000 FCFA**. Le cas porte deux reçus distincts, encaissés à **53 secondes d'intervalle** (`REC-223352` à 14:59:47, `REC-276036` à 15:00:40), et **les deux gestes sont au journal** (`audit_logs`, deux `RECORD_PAYMENT`). Autrement dit : les deux paiements existent, le reçu dit 8 000, le solde dit 4 000.

**Pourquoi ça compte.** C'est le pire défaut possible dans cette application : l'école relance une famille pour 4 000 FCFA déjà payés, ou la famille présente un reçu que le logiciel contredit. Et ce n'est pas un accident isolé : c'est une classe entière de pertes silencieuses (deux postes qui encaissent en même temps, un geste qui double-clique, un rejeu hors ligne). Le dépôt a déjà payé cette classe de bug une fois (voir le commentaire de `tests/offline-replay.test.ts` : le montant n'était jamais ajouté à `amount_paid`).

**Correctif, dans l'ordre de valeur.**

1. **Retirer la dérivation du client.** Un déclencheur PostgreSQL (`AFTER INSERT OR DELETE OR UPDATE OF amount ON payments`) recalcule `students.amount_paid` ; le client cesse de l'écrire. Une valeur dérivée maintenue par plusieurs écrivains n'est pas réparable par plus de discipline côté application.
2. **Un contrôle qui rend le rouge visible** — `npm run check:ledger` : pour chaque élève, `sum(payments.amount)` contre `amount_paid`, sortie `exit 1` nommant les écarts, et un `--fix` qui **répare depuis la source** (la somme des lignes), jamais l'inverse. C'est la première fois que ce contrôle tournerait : il est rouge aujourd'hui, sur un élève, pour 4 000 FCFA.
3. Le porter en veille CI (quotidienne), parce qu'une divergence future naîtra sans commit.

**Preuve attendue :** le contrôle rouge aujourd'hui (1 élève, −4 000 FCFA) ; vert après réparation ; et un cas qui simule deux encaissements concurrents pour montrer que la base, elle, ne perd plus rien.

### 3.2 La file hors ligne peut perdre un paiement en silence

**Constat.** `src/lib/offlineQueue.ts` persiste la file dans `localStorage`. `saveQueue` enveloppe l'écriture dans un `try/catch` qui **imprime** l'échec et continue : `console.error('Failed to save offline queue from localStorage:', err)`. L'appelant, lui, a déjà annoncé le succès (`notifySuccess('addPayment')`). Aucun plafond de file, aucun contrôle de quota, aucun repli sur un stockage durable.

**Mesure.** Aucun `MAX`/`LIMIT`/`slice` de plafonnement dans le fichier ; le seul traitement de l'échec est la ligne ci-dessus ; `navigator.storage.estimate()` n'apparaît nulle part.

**Pourquoi ça compte.** Le cas d'usage visé est Bamako : plusieurs jours sans réseau, la file gonfle. Si le quota saute (`QuotaExceededError`), le geste est accepté à l'écran, **jamais écrit**, et perdu au redémarrage. Un encaissement annoncé « enregistré » et inexistant est exactement ce que ce dépôt refuse ailleurs (« un vert qu'on ne saurait pas expliquer »).

**Correctif.** (1) Un échec d'écriture doit **remonter** : l'utilisateur voit que le geste n'est pas conservé sur ce poste (et l'entrée reste à l'écran, pas « enregistrée »). (2) Un plafond **nommé** de la file (compte et octets), avec un refus explicite au-delà — une file qui refuse est préférable à une file qui perd. (3) Une empreinte de taille lisible dans l'écran d'état du poste (voir 4.2).

**Preuve attendue :** un cas qui sature le stockage injecté et exige que l'appel soit **dit** en échec, plus un cas de file pleine au plafond.

---

## 4. P1 — ce qui casse sans prévenir

### 4.1 La troncature à 1 000 lignes : pas encore mordante, mais imminente et muette

**Constat.** `src/lib/useSupabaseData.ts` charge **neuf tables entières** en une fois (`select('*')`, `.order(..., { ascending: true })`), sans pagination : 16 `select('*')` dans `src/lib`, **un seul `.limit(`**, **zéro `.range(`**. Or Supabase plafonne par défaut chaque réponse à **1 000 lignes** (réglage d'API du projet) et, au-delà, **tronque sans erreur**.

**Mesure (2026-10-11).** Rien n'est tronqué aujourd'hui — `students` 497 rend 497, `audit_logs` 749 en rend 749, `payments` 97 en rend 97, `Content-Range` d'accord avec le corps dans les trois cas. Volumétrie : students 497 · parents 12 · staff 0 · payments 97 · salary_payments 0 · expenses 0 · vendor_expenses 0 · todos 0 · custom_classes 4 · calendar_notes 0 · audit_logs 749 · user_profiles 4 · academic_years 4.

**Pourquoi ça compte.** Le tri est **croissant** : quand une table franchit le plafond, ce sont les lignes **les plus récentes** qui disparaissent — l'écran montrerait une école qui n'encaisse plus depuis des semaines, sans le moindre message. `payments` est la table à surveiller : 97 lignes saisies en trois jours d'activité (dont 95 le 2026-10-10), et un rythme d'école remplit 1 000 lignes dans l'année scolaire. Le dépôt connaît ce risque — `fetchAuditLogs` le dit dans son commentaire — mais la parade retenue là (borner par les dates, `.limit(100)` à l'écran) ne protège que `audit_logs`.

**Correctif.** (1) Un `select` explicite des colonnes utiles (moins d'octets, moins de cache). (2) Une pagination `.range()` par pages de 1 000 pour les tables qui grandissent (`payments`, `salary_payments`, `expenses`, `vendor_expenses`, `students`). (3) Surtout : une **garde de complétude** — comparer `count`/`Content-Range` à la longueur reçue et, si la réponse est partielle, l'écrire à l'écran (« chargé 1 000 sur 1 412 »). Une réponse incomplète doit être **un état visible**, pas un silence.

**Preuve attendue :** un cas unitaire qui fabrique une réponse de 1 000 lignes avec un total de 1 412 et exige que l'incomplétude soit nommée ; et le chargement des cinq tables concernées par pages.

### 4.2 Des noms d'élèves vivent dans un dépôt public

**Constat.** Le dépôt est **public** (nécessaire au canal de mise à jour : `provider: github`, sans jeton). Or deux fichiers suivis portent des prénoms et noms d'élèves réels : la migration de dédoublonnage (dont l'en-tête cite des homonymes pour expliquer le piège de regroupement) et `RAPPORT_RECUS_DOUBLONS.md` (qui nomme deux élèves dans son tableau).

**Pourquoi ça compte.** Une école n'a pas consenti à publier l'identité de ses élèves. Le dépôt est aussi ce qui rend le parc capable de se mettre à jour : la tension est réelle et ne se règle pas en repassant le dépôt en privé (ce serait raboter le canal). Elle se règle en **séparant les deux besoins** : le dépôt public ne doit contenir **aucune donnée d'école** — les exemples de vérification s'écrivent « Awa X. », les rapports portant des identités vivent **hors du dépôt** (dans la sauvegarde chiffrée, ou dans un document remis à l'école).

**Correctif.** Réécrire les deux fichiers pour anonymiser (les noms sont aussi dans l'historique : un `git filter-repo` est possible mais change tous les SHA — la décision appartient au propriétaire), et ajouter la règle au contrôle existant qui traque les données d'école dans les fichiers suivis, s'il existe, ou lui donner sa première implémentation.

**Preuve attendue :** un contrôle qui refuse un nom propre d'élève dans un fichier suivi, exercé par un cas qui échoue volontairement.

### 4.3 Le parc est muet : aucune remontée d'erreur

**Constat.** Aucune référence à un collecteur (`sentry`, `bugsnag`, `crashReporter`, `opentelemetry`) ni à `window.onerror`/`unhandledrejection` dans `src/` et `electron/`. Les seuls journaux sont locaux (`console`).

**Pourquoi ça compte.** Pour un logiciel installé chez une école, la panne arrive **sur un poste**, devant un caissier, sans développeur. Aujourd'hui : écran blanc, aucune trace exploitable, et l'école doit décrire l'incident au téléphone. C'est la même famille de défaut que le canal de mise à jour, déjà traitée : *un mécanisme cassé est silencieux, donc il lui faut une veille*.

**Correctif, par ordre de sobriété.** (1) Un **journal d'incident local** (ring buffer persistant dans `userData`), alimenté par `unhandledrejection`, les erreurs de rendu React et les exceptions du processus principal, avec un bouton « copier le rapport » dans les réglages — l'école peut l'envoyer sans compte ni réseau. (2) Si un service de collecte est ajouté un jour, il vient **après**, et il se décide avec ses propres contraintes (données d'école : aucun nom d'élève dans un rapport d'erreur). (3) Un écran « état du poste » : version installée, dernière mise à jour réussie, file hors ligne (compte + octets), dernier incident.

**Preuve attendue :** une exception provoquée qui laisse une entrée lisible dans le journal local, et le rapport qui **nomme ce qu'il ne remonte pas**.

### 4.4 La sauvegarde : un artefact de 30 jours, sans copie de secours

**Constat.** `backup-watch.yml` tourne à 02:20 UTC, sauvegarde **chiffrée** (scrypt + AES-256-GCM, en-tête `MTFB1`), relit la sauvegarde sans base, puis `actions/upload-artifact@v5` avec `retention-days: 30`. Le manifeste et les refus sont exemplaires (`docs/BACKUP.md`), mais la **destination** est un artefact GitHub.

**Mesure.** Cinq derniers runs verts (dernier : 2026-10-11 09:01Z). Aucun chemin d'écriture vers un stockage durable n'existe dans le workflow (ni bucket, ni disque, ni dépôt de sauvegarde). Le round-trip local, lui, tourne : `backup-roundtrip.yml` vert le 2026-10-11 (16:25Z et 13:56Z), sur une pile Supabase éphémère.

**Pourquoi ça compte.** Trois faits distincts, chacun suffisant pour perdre une école : au 31ᵉ jour il n'existe plus de sauvegarde ; un artefact dépend du compte GitHub et de sa facturation ; et la phrase de chiffrement (`BACKUP_PASSPHRASE`) n'a **pas d'escrow documenté** — si elle est perdue, les archives chiffrées deviennent illisibles, donc inutiles. `docs/BACKUP.md` le dit honnêtement pour la restauration (« pas encore faite » dans un projet hébergé) : c'est la même honnêteté qui doit s'appliquer à la rétention.

**Correctif.** (1) Écrire la sauvegarde dans un **stockage durable et chiffré, hors GitHub** (bucket S3/R2 avec rétention longue), le workflow ne gardant l'artefact que comme trace. (2) Un **exercice de restauration daté et public** dans l'historique : restaurer dans un projet hébergé de recette, compter, comparer, et écrire le résultat — un exercice jamais fait est une hypothèse. (3) Écrire où vit la phrase de chiffrement, qui peut l'ouvrir, et comment elle se remplace sans perdre les archives anciennes. (4) Une **alerte d'âge** : un cron qui rougit si la dernière sauvegarde vérifiée date de plus de 48 h (aujourd'hui, si les runs s'arrêtent, personne ne l'apprend).

### 4.5 Base gratuite : 500 Mo puis lecture seule

**Constat.** Le projet partagé est sur un plan gratuit : **500 Mo de base**, puis passage en **lecture seule** ; 5 Go d'egress par mois ; pas de facturation d'excédent automatique.

**Mesure.** La base est loin du mur (13 tables, quelques centaines de lignes), mais **aucun contrôle ne mesure la taille** : ni la base, ni la croissance, ni l'egress. Les veilles quotidiennes (`shared-db-watch`) vérifient que le site lit la bonne base, pas combien elle pèse.

**Pourquoi ça compte.** Le jour où la limite tombe, l'école n'écrit plus : les encaissements du guichet échouent, et l'autorité se découvre par un incident. Une lecture en excès (`select('*')` sur neuf tables à chaque démarrage) consomme de l'egress, gratuit jusqu'à 5 Go puis restreint.

**Correctif.** Un contrôle quotidien qui **lit et publie** : taille de la base (si l'API le donne ; sinon le nombre de lignes par table, qui est déjà lu par `check:recette-base`), tendance à 7 jours, et un seuil d'alerte à 70 % du plafond. Le publier dans la preuve d'action du run, comme le reste.

### 4.6 « Business E2E » rouge par construction — **résolu le 2026-10-12**

**Constat.** `check:recette-base` refuse d'écrire sur la base partagée parce qu'elle porte des données d'école (`students 497 · parents 12 · payments 97`) et propose deux issues : un projet Supabase de recette dédié, ou `--allow` en connaissance de cause. Le job est donc rouge à chaque déploiement — y compris sur le commit précédent, à l'identique.

**Pourquoi ça compte.** Un rouge permanent ne se lit plus : il masquerait la prochaine vraie panne de la recette. Et les cycles métier (élève → paiement → parent → salaire → dépense) ne sont donc **exercés nulle part** de bout en bout aujourd'hui.

**Correctif.** Trancher, et l'écrire : pointer la recette sur un projet de recette (`vulbmmzhcmnzswcvswfk` répond, mais il faut un déploiement qui le lise), ou assumer le partage avec `--allow` et descendre le job au vert en le nommant. Ne pas laisser un rouge de principe.

**Résolu le 2026-10-12 — et par aucune des deux issues proposées.** Les deux étaient mauvaises, et la mesure l'a montré : la recette déclarée (`vulbmmzhcmnzswcvswfk`) était **morte** (son nom ne résout plus, mesuré le 2026-10-12) — une ressource externe qu'aucun contrôle ne relève pourrit en silence ; et `--allow` aurait seulement rendu le job vert en continuant d'écrire des comptes éphémères et des lignes de démo chez l'école. Le job monte donc **sa propre pile** (`supabase start` : Postgres, GoTrue, PostgREST, RLS, les 34 migrations du dépôt, base vierge), construit l'application **pointée dessus** (`build:staging`), la sert en local, y pilote les cycles, puis jette le tout avec le runner — **aucun secret, et les données de l'école ne sont ni lues ni écrites**. Le déclencheur est passé du « fin d'un déploiement Vercel réussi » à **`push` sur `main`** (+ `workflow_dispatch`) : le job ne dépend plus d'aucune ressource externe, donc il peut se rejouer pour lui-même au lieu d'attendre un déploiement, et un rouge permanent n'est plus possible par construction. `npm run check:recette-base` passe **avant la première écriture** — si la base visée n'est pas vierge, le job refuse d'écrire et nomme les tables qu'il a comptées. La garde anti-résidus passe en `if: always()`.

**Et le même chemin a été pris le même jour par le pixel-check PDF**, qui écrivait lui aussi un compte éphémère — et parfois un élève + un paiement de démo — dans la base de l'école : `pdf-e2e.yml` monte sa pile, sert le build de son commit sur `127.0.0.1:4173` et y exécute la garde CSP (7 pages) et les pixel-checks (paie, reçu des parents — plus, depuis, le reçu des mois cochés au guichet et le reçu MUET rattrapé par la fiche, voir `DEVELOPMENT_HISTORY.md`). Ce qui reste **en lecture seule** contre la production, c'est ce qui ne demande aucun compte : la fraîcheur du déploiement, et la politique servie — cette dernière comparée **mot pour mot** à `vercel.json` par `verify-csp-guard.mjs --policy-only`, sans navigateur ni session. Le groupe de concurrence partagé par les deux workflows (il existait parce que les deux écrivaient dans la même base et se jugeaient mutuellement leurs résidus) a disparu avec l'écriture partagée.

**Preuves.** Recette métier : run `38299556209` **vert** sur `d804ca0` (2026-10-12). Pixel-check PDF : run `38300159455` **vert** sur `c3d447b`, 3 min 41 s — fraîcheur confirmée sur le build de ce commit, politique servie par la production conforme (10 directives), garde CSP 7/7 pages · 0 violation, pixel-checks `9/9` et `12/12` sur `http://127.0.0.1:4173/`, nettoyage final **0 enregistrement parcouru** dans la pile de recette. Ce que ces deux jobs ne prouvent **pas**, et qui est dit : le réseau ni la plateforme hébergée (latence, quotas, mise en pause d'un projet) — c'est le métier des veilles qui, elles, visent le vrai domaine (`shared-db-watch`, `check:public-origin`).

### 4.7 Les politiques RLS de la base ne se comparaient à rien — **contrôle ajouté le 2026-10-13**

**Constat.** `check:hosted-schema` compare les COLONNES (canal PostgREST, clé anon : les politiques ne s'y lisent pas) et `check:public-rls` si chaque table PORTE RLS — jamais ce que la politique dit. Mesuré le 2026-10-13 sur la base partagée : **27 écarts** sur 70 politiques, entre ce que les migrations déclarent et ce que `pg_policies` porte — **5 politiques déclarées ABSENTES** : `academic_years` ×2 (« Allow admin write access… », « Allow authenticated read access… », 20260820000000), `custom_grades` ×2 (« Authenticated read/insert custom grades », 20260828000002/3 — cette table ne porte **aucune** politique en base) et `vendor_expenses` ×1 (« Finance admins delete vendor_expenses », 20260906000002 : c'est la moitié DELETE de la migration du 2026-09-06 qui n'a jamais été appliquée — son INSERT jumeau a été réparé le 2026-10-13 par `20261014000000_finance_writer_staff_vendor.sql`, ce qui explique que la table porte la règle d'ÉCRITURE neuve et garde l'ancienne de SUPPRESSION) ; et **22 politiques que personne ne déclare ni ne retire** — la génération d'avant les migrations, présente sur `students`, `parents`, `expenses`, `staff`, `todos`, `user_profiles`, `academic_years`, `salary_payments` et `vendor_expenses` (`Authenticated users can read students` et consorts, dont plusieurs ouvrent `true` à tout compte authentifié).

**Pourquoi ça compte.** C'est la classe de défaut la plus silencieuse du dépôt : l'écran montre un bouton, la base le refuse, rien ne le dit — et la même chose dans l'autre sens (l'économe ne voyait pas l'icône ✚ alors que la base ACCEPTAIT déjà sa dépense). Les retirer ou les appliquer n'est pas neutre : une politique, c'est un DROIT.

**Correctif.** `npm run check:rls-policies` (+ `scripts/lib/rls-policies.mjs`, testé sans base par `tests/rls-policies.test.ts`) rejoue les `CREATE`/`DROP POLICY` des 37 migrations — `DROP` retire, `CREATE` (re)pose, dans l'ordre des horodatages — et compare aux 70 politiques de `pg_policies`, en nommant chaque écart : ABSENTE, EN TROP, ou CHANGÉE (champ par champ). Branché dans la veille `public-rls-watch` (même secret, même base, fail-on-gap), coché dans l'inventaire `check-guard-immunity`. Il ne corrige rien.

**Ce qu'il refuse de faire passer pour un vert.** Aucune politique déclarée ou lue ⇒ exit 2 ; une exemption muette, périmée, ou qui cacherait une politique déclarée ⇒ un problème nommé. Deux écritures de la même règle ne sont pas un écart (`is_admin()` = `role IN ('admin','dev')` = son `EXISTS` en clair) : un contrôle qui crie toujours ne se lit plus — et `is_admin()` face à `is_finance_writer()` reste, lui, une dérive.

**Réparé le 2026-10-13 — un des cinq manques : le Gestionnaire Principal peut (enfin) supprimer une dépense fournisseur.** Après la fermeture des politiques héritées du même jour, il restait **12** écarts, dont `vendor_expenses` : « Finance admins delete vendor_expenses » ABSENTE face à DEUX noms hérités `is_admin()` EN TROP (« Admin can delete vendor_expenses », qu'aucune migration ne déclarait, et « Promoter delete vendor_expenses »). La migration du 2026-09-06 ne se rejouait pourtant plus telle quelle : `db:apply` la REFUSAIT (« déjà ABSENT avant : policy:Promoter insert vendor_expenses »), parce que sa moitié INSERT avait été livrée le 2026-10-13 par `20261014000000_finance_writer_staff_vendor.sql`, sous une règle PLUS LARGE (`public.is_finance_writer()`, économe inclus) — la recréer aurait rouvert un second nom pour la même écriture. Le fichier porte donc désormais la SEULE moitié DELETE, et il retire les deux noms hérités. **Mesures** : `db:apply` (« avant » 1 ajout absent sur 1 et 2 retraits présents sur 2 → « après » 1 présent, 2 partis, COMMIT) ; `check:rls-policies` **12 → 9** écarts, **0** sur `vendor_expenses` (base 55 → 54 politiques, 49 alignées) ; sonde `pg` sur la base réelle en transaction ANNULÉE, `SET LOCAL ROLE` **et les deux claims JWT**, suppression d'une dépense fournisseur de DÉMO : `admin` **1**, `dev` **1**, `general_manager` **1**, économe **0**, compte connecté SANS profil **0**, `anon` **0**, et `vendor_expenses` à **0** ligne avant comme après. Côté app, `vendor_expenses` quitte `ADMIN_ONLY_DELETE_TABLES` et la corbeille de l'onglet Fournisseurs suit `canDeleteVendorExpenses` (`public.is_finance_admin()`, lue sur le PROFIL du poste) — le détail est dans `DEVELOPMENT_HISTORY.md`.

**Réparé le 2026-10-17 — la dérive tombe à ZÉRO : cinq politiques héritées retirées, deux déclarées posées.** `supabase/migrations/20261017000000_rls_declared_alignment.sql` fait deux choses, et les deux sont des décisions de DROITS, prises nommément : **renommer** sur `academic_years` (les deux noms hérités « Authenticated read academic_years » et « Admin manage academic_years » cèdent la place aux deux noms que `20260820000000` déclare, à règle IDENTIQUE — `SELECT … USING true` et `ALL … is_admin()` à la lecture comme à l'écriture) et **dédupliquer** sur `user_profiles` (« Users can read own profile or admin reads all », « Admin can update profiles ») et `todos` (« Authenticated users can manage todos », un `ALL … true`) — chacun ayant, sur la même table et la même COMMANDE, un homologue déclaré de règle identique et d'audience plus large, ou les quatre déclarées qui couvrent le `ALL`. **Aucun droit n'est ouvert ni fermé** : la carte des écritures (lire, insérer, corriger, supprimer, pour chaque rôle présent et `anon`, `SET LOCAL ROLE` + les deux claims JWT, transaction annulée) est **identique avant et après**, `diff` vide — et c'est MESURÉ, pas déduit du texte des policies, parce que les politiques permissives s'additionnent. **Les deux « manques » de `custom_grades` n'étaient pas des droits : la table est RETIRÉE par `20260828000004`**, donc le contrôle réclamait un `CREATE POLICY` impossible ; il a été corrigé à la CAUSE (`scripts/lib/rls-policies.mjs` : une table retirée par le corpus efface les politiques qu'il déclarait avant elle, `DROP TABLE` repéré jusque dans les blocs `DO $$ … $$`, et le retrait est NOMMÉ dans la sortie au lieu d'être tu), et non contourné par une exemption ou par la recréation d'une table que le dépôt a lui-même retirée. **Mesures** : `db:apply` (« avant » 2 ajouts absents sur 2 et 5 retraits présents sur 5 → « après » 2 présents, 5 partis, COMMIT) ; `check:rls-policies` **9 → 0** — **40 migrations, 51 politiques déclarées, 51 en base, 51 alignées** (la base en portait 54) ; `check:hosted-schema` vert (15 tables, 138 colonnes) ; `db:snapshot` 40 migrations en phase ; `npm run lint` **exit 0** ; `npm test` **3014 tests, 0 échec**. Les suites qui verrouillent : `tests/rls-declared-alignment.test.ts` (**18 cas** — les cinq retraits FIGÉS, les deux poses identiques champ par champ à la déclaration, l'homologue de commande exigé retrait par retrait, mutations comprises) et 5 cas neufs de `tests/rls-policies.test.ts` sur la table retirée. Reste sur ce contrôle : RIEN — la veille `public-rls-watch` n'a plus d'écart à porter, et elle repassera verte à sa prochaine lecture (même commande, même base). Le détail est dans `DEVELOPMENT_HISTORY.md`.

### 4.8 Les index, contraintes et déclencheurs de la base ne se comparaient à rien — **contrôle ajouté le 2026-10-18**

**Constat.** `check:hosted-schema` compare les COLONNES, `check:public-rls` si chaque table PORTE RLS, `check:rls-policies` ce que les POLITIQUES disent. Trois familles d'objets restaient hors de toute garde, et chacune a sa façon de faire mal en silence : un INDEX absent ne casse rien — il ralentit, et un index UNIQUE absent accepte des doublons que le dépôt croit interdits ; une CONTRAINTE absente laisse entrer ce que l'application refuse d'écrire (`payments_months_shape_check` est ce qui empêche une clé de mois illisible d'être stockée) ; un DÉCLENCHEUR absent est le plus silencieux des trois — `on_auth_user_created` crée la fiche de rôle de chaque compte, donc un compte créé sans lui n'a pas de profil et l'application ne sait plus qui il est.

**Correctif.** `npm run check:db-objects` (+ `scripts/lib/db-objects.mjs`, pur, testé sans base par `tests/db-objects.test.ts` — 39 cas) rejoue les `CREATE`/`DROP` des 40 migrations — `DROP` retire, `CREATE` (re)pose, dans l'ordre des horodatages, un `DROP TABLE` emportant ce que la table portait jusque dans un bloc `DO $$ … $$` — et compare à `pg_index`, `pg_constraint` et `pg_trigger` par connexion **directe**. Chaque écart est **NOMMÉ** : ABSENT (avec le fichier qui le déclare), EN TROP (décrit par ce qu'il est), ou CHANGÉ champ par champ. Les noms que Postgres dérive lui-même (`students_pkey`, `students_student_id_key`, `students_parent_id_fkey`, `user_profiles_role_check`) sont **dérivés** du SQL, jamais recopiés du catalogue ; deux écritures de la même règle (`IN (…)` face à `= ANY (ARRAY[…])`) ne sont pas une dérive ; et l'index d'une clé (`constraint_owned`) se compare du côté CONTRAINTE, une fois. La connexion est celle de `check:rls-policies` (`scripts/lib/hosted-db.mjs`) : deux conventions de connexion finiraient par juger deux bases différentes, en silence. Branché dans la veille `public-rls-watch` (même secret, même base, fail-on-gap) et coché dans l'inventaire `check-guard-immunity`. Depuis le **2026-10-16**, il est aussi joué **avant le build** par les deux chaînes de publication (porte n°5 de `deploy.yml`, gate n°2 de `desktop-release.yml`) — mesuré le jour où la migration du nom d'école, qui n'ajoute AUCUNE colonne, est restée invisible de la porte des colonnes pendant que ce contrôle nommait sa contrainte ABSENTE. Il ne corrige rien.

**Ce qu'il refuse de faire passer pour un vert.** Sans mot de passe, sans migration lue, ou sans aucun objet lu ⇒ sortie **2** ; une exemption muette, périmée, ou qui cacherait un objet DÉCLARÉ ⇒ un problème nommé ; et une ligne du catalogue que le module n'arrive **pas** à lire rend le verdict **faux** (« un objet non lu n'est pas un objet aligné ») sans être comptée en dérive. Un type de contrainte hors modèle (les NOT NULL de PostgreSQL 18, `contype = 'n'`) est NOMMÉ à part (`unmodeled`) plutôt que comparé en silence.

**La première mesure a trouvé une dérive… dans le contrôle.** La comparaison criait sur CHAQUE contrainte nommée du dépôt — toutes posées par `ALTER TABLE … ADD CONSTRAINT` : la lecture recollait le mot-clé sur un texte qui le portait déjà (`CHECK CHECK (…)`), une dérive qui n'existait que dans le module. Corrigé à la cause, et verrouillé dans les deux sens — le rendu de Postgres (`CHECK (((months)::text ~ '…'::text))`) n'est PAS une dérive, la définition doublée en EST une. Deux autres défauts sont sortis des tests purs : un `DROP TABLE` cherché **après** la boucle des instructions retirait les objets d'un `CREATE` situé plus loin dans le MÊME fichier (l'ordre DANS le fichier décide — la leçon déjà payée sur les politiques), et une **colonne retirée** n'emportait pas les index qui la nomment (une dérive permanente que personne n'aurait pu réparer, faute de colonne à indexer).

**Mesures (2026-10-18, base partagée `rpcjdohfxwukbqngbprw`, lecture seule).** `npm run check:db-objects` : **vert, exit 0** — 40 migrations lues, **41 objets déclarés** (8 index, 29 contraintes, 4 déclencheurs) et **41 alignés**, 0 absent, 0 en trop, 0 changé ; 15 tables lues pour les index et contraintes (schéma `public`), 16 pour les déclencheurs (`public` + `auth`). Les 5 objets que le corpus déclare puis retire sont nommés avec leur **cause** (`custom_grades_name_unique` retirée par la migration qui pose l'index d'expression, `custom_grades_name_lower_unique` et `custom_grades_pkey` par la table que `20260828000004` retire, et les deux générations de `user_profiles_role_check`). Et **rouge sur un catalogue mutilé**, mesuré sans rien écrire en base : le MÊME contrôle, avec une contrainte déclarée en plus de celles du dépôt, sort en **1** en nommant `public.payments.payments_probe_absent_check` et sa migration — exactement la forme du défaut qu'il poursuit.

**Limites dites.** La veille `public-rls-watch` n'a pas été déclenchée depuis ce poste (les runs GitHub ne partent pas d'ici) : ce qui est prouvé l'est par la ligne de commande, sur la même base et le même secret, pas par un run. Le contrôle ne lit ni les droits (`GRANT`/`REVOKE`), ni les colonnes (`check:hosted-schema` s'en charge), ni les fonctions. Et il n'écrit RIEN : appliquer un manque reste `npm run db:apply`, avec sa preuve avant/après.

### 4.9 Les portes d'affichage de l'app ne se comparaient pas aux politiques d'écriture de la base — **contrôle ajouté le 2026-10-18**

**Constat.** Trois défauts mesurés, tous de la même famille — l'écran et la base ne disaient pas la même chose : le **2026-10-05**, un compte `econome` enregistrait la paie hors ligne et chaque rejeu revenait en `42501`, les saisies restant dans la file ; le **2026-10-13**, le Gestionnaire Principal et l'économe étaient refusés sur `staff` et `vendor_expenses` pendant que l'écran leur CACHAIT l'action ; le même jour, `expenses` ACCEPTAIT l'économe alors que l'icône « Ajouter une dépense » ne s'affichait pas chez lui. Les deux moitiés étaient pourtant vérifiées séparément : `tests/finance-rights.test.ts` compare les listes de `src/lib/*Rights.ts` aux fonctions des migrations, et `check:rls-policies` compare les politiques de la BASE à celles des migrations. **Ce qui manquait était la TRAVERSE** : personne ne croisait *qui la base autorise* avec *qui l'écran laisse voir* — les deux contrôles pouvaient être verts pendant qu'un bouton menait à un 42501.

**Correctif.** `npm run check:write-gates` (+ `scripts/lib/write-gates.mjs`, pur, testé par `tests/write-gates.test.ts` — **41 cas**) croise les ÉCRITURES de l'app (lues dans `src/lib/dataOps/*.ts`, la seule couche qui écrit : `.from('t').insert/update/delete`, `.rpc('f')` — aucune liste à tenir), les PORTES D'AFFICHAGE (l'inventaire nomme l'écran, l'action et la garde qu'il lit ; les rôles sont lus par le **parseur TypeScript** dans le `.ts` qui les DÉCLARE, alias compris — une seule copie existe) et les POLITIQUES D'ÉCRITURE des migrations (rejouées par `rls-policies.mjs`, chaque condition résolue en un ensemble de rôles lu dans les fonctions de rôle : `is_admin()`, `is_finance_writer()`, `is_payment_deleter()`…). **Hors ligne** : migrations + source, aucune base, aucun secret. Branché dans `lint:chain` et coché dans `check:guard-immunity` (**42 contrôles**).

**Les deux verdicts, nommés rôle par rôle.** ① *L'écran montre ce que la base refuse* — la file hors ligne, puis le `42501` : la garde lit une liste qui ne correspond plus à la politique. ② *La base accepte ce que l'écran cache* — une capacité muette ; un écart VOULU se **DÉCLARE** (`narrower`, avec sa raison) et s'imprime à chaque exécution, sinon il échoue. Trois pièges sont fermés en plus : une porte déclarée que l'écran ne LIT pas est refusée (« une garde déclarée, pas appliquée »), une écriture de l'app qu'aucune entrée ne croise **ou** une entrée qui garde une action que l'app n'exécute plus sont deux échecs nommés (l'inventaire ne peut donc pas se laisser dépasser en silence), et une condition que le module n'a pas su lire rend `ILLEGIBLE` ⇒ sortie **2**, jamais une supposition.

**Mesures (2026-10-18, hors ligne).** `npm run check:write-gates` : **vert, exit 0** — 40 migrations lues, 8 fichiers de la couche d'écriture, **34 écritures croisées** (26 couples table × commande) **+ 2 fonctions** (`set_payment_months`, `reassign_payment_student` — dont la garde est lue dans le CORPS de la fonction, pas recopiée), **29 portes d'affichage** déclarées, **17 listes de rôles** lues dans l'app, **39 couples (table, commande)** lus dans les migrations, **4 écarts DÉCLARÉS** nommés à chaque run : `staff::DELETE` (l'écran ne montre la corbeille du personnel qu'à `admin`/`dev` alors que la base accorde aussi `general_manager` — **décision de droits à confirmer avec le propriétaire**, nommée plutôt que tue), `expenses::INSERT` et `expenses::UPDATE` (la base ouvre à tout compte connecté, l'écran réserve aux rôles financiers) et `vendor_expenses::UPDATE` (la base laisse `TO authenticated … USING (true)` corriger une dépense fournisseur — le montant reste modifiable en base par un rôle qui ne voit pas le bouton : l'écart est DÉCLARÉ, et il est nommé à chaque exécution). `tests/write-gates.test.ts` : **41 cas, 0 échec**, dont la **preuve de vie sur le corpus réel** — déplacer UN rôle dans une porte réelle (`staff::DELETE` vers `FINANCE_WRITER_ROLES`) fait rougir le contrôle en nommant `econome`.

**Limites dites.** Le contrôle croise l'action (table, commande) avec l'écran qui l'offre : un SECOND écran qui offrirait la même action avec une garde plus étroite (l'import Excel, montré à `admin`/`dev`/`general_manager` par une condition écrite en clair dans `AppHeader.tsx`) n'est pas modélisé — la direction dangereuse (montrer ce que la base refuse) reste couverte par l'écran le plus large, mais cette limite est ici écrite plutôt que découverte. Il ne lit ni les droits `GRANT`/`REVOKE`, ni la base : `check:rls-policies` prouve déjà qu'elle porte ces politiques-là. Et il n'écrit rien.

---

## 5. P2 — performance, expérience, dette

### 5.1 Octets et requêtes

**Mesure.** `dist/` = **5,9 Mo** ; plus gros morceaux : `pdf.worker.min` **1,3 Mo**, `xlsx` 492 Ko, `pdf` 488 Ko, `App` 409 Ko, `jspdf` 399 Ko, `BarChart` 375 Ko. `electron-ui-dist/` = **4,1 Mo**. Le dépôt embarque **trois** bibliothèques PDF (`jspdf`, `pdf-lib`, `pdfjs-dist`) et `xlsx` (chargé en lazy, tant mieux). Le seul seuil de performance est le **score lighthouse médian ≥ 0,7** (`scripts/check-performance.mjs`).

**Pourquoi ça compte.** Un dépôt qui impose un **budget de lignes par fichier** (`check-line-budget.mjs`, 700 lignes) mais **aucun budget d'octets livrés** protège son code et laisse filer ce que l'école télécharge — sur une connexion de Bamako, c'est le premier facteur d'expérience. Un plancher de 70/100 n'est pas un objectif, c'est un filet.

**Correctif.** (1) Un budget d'octets par morceau, vérifié dans la chaîne (rouge au dépassement, avec la liste des morceaux). (2) Un objectif lighthouse à 0,9 sur la page de connexion et le tableau de bord, mesuré en médiane de plusieurs runs (le script sait déjà le faire). (3) Index manquants, mesurés par ce qui filtre et joint réellement : les migrations ne déclarent que **9 index** — 6 `CREATE INDEX` (`academic_year` sur `students`, `payments`, `expenses` ; `calendar_notes.note_date` ; `audit_logs.created_at`, dont un partiel) et 3 uniques (`custom_grades.name` insensible à la casse, `custom_classes.code` insensible à la casse, la clé métier d'élève). Or **les trois clés étrangères n'ont aucun index** — PostgreSQL n'en crée pas automatiquement : `payments(student_id)` (et la cascade `ON DELETE`), `students(parent_id)`, `salary_payments(staff_id)` — et rien ne couvre `payments(date)`, `payments(receipt_number)` (or `report-duplicates.mjs` **groupe** sur cette colonne), `expenses(date)`, `vendor_expenses(date)`, `todos(due_date)`.

### 5.2 Expérience du guichet

**Mesure.** Le 2026-10-10, **95 paiements** ont été saisis en base — c'est le geste chaud de l'application, et il se fait au guichet, souvent sous pression. La file hors ligne et le bandeau sont là (`OfflineBanner`, compteur d'attente, échecs nommés), les états vides existent (`Aucun`/`Aucune` ≈ 50 occurrences), les toasts sont partout (≈ 130), et le doublon suspect a son écran (`DuplicateReviewModal`).

**Pistes, par valeur attendue.** (1) **Saisie clavier complète** du paiement : montant, mois, enregistrement, impression, sans souris — c'est le geste répété 95 fois par jour. (2) **Détection de doublon AVANT l'enregistrement** (même élève, même montant, même jour, à quelques minutes), pas après. (3) L'écran de carte de caisse existe déjà et se date sur le calendrier du poste : en faire la **surface d'ouverture** du caissier. (4) Un « dernier reçu » visible en permanence, avec réimpression en un geste.

### 5.3 Accessibilité

**Mesure (sur 66 composants, 31 d'entre eux des modales).** `aria-*` 73, `aria-label` 51, `aria-modal` 8, `role=` 17, `Escape` 73 — la base est sérieuse. Mais : **`aria-live` 0**, **piège de focus 0**, `.focus()` 8, `htmlFor=` 3, `tabIndex` 1, `onKeyDown` 4 (10 en comptant `src/app`).

**Pourquoi ça compte.** (1) Sans piège de focus, la tabulation sort de la modale et va cliquer des boutons derrière — dans un guichet, c'est un paiement écrit sur le mauvais écran. (2) Sans `aria-live`, la bascule hors ligne/en ligne et l'échec d'une synchronisation ne sont **jamais annoncés** : l'information la plus importante de l'application est visuelle seulement.

**Correctif.** Un composant de modale unique (piège de focus, retour du focus à l'ouverture/fermeture, `Escape` — déjà global) et une **région live** pour : hors ligne rétabli, file vidée, échec de rejeu. Deux gestes, appliqués partout.

### 5.4 Numéro de reçu

**Mesure.** `REC-${Date.now().toString().slice(-6)}` : les 6 derniers chiffres d'un horodatage, soit **10⁶ valeurs**, qui se répètent toutes les **16 min 40 s**. État réel : **97 paiements, 97 numéros distincts, 0 collision** — et 0 paiement sans numéro.

**Pourquoi ça compte.** Le calcul de la mesure rend le risque honnête : la probabilité d'une paire identique croît en carré du volume (~50 % vers 1 200 reçus). Or « numéros de reçu réutilisés » est précisément l'un des deux signaux que `scripts/report-duplicates.mjs` traite comme une anomalie. Un identifiant de caisse n'a pas à être tiré d'une horloge.

**Correctif.** Un numéro attribué **par la base** (séquence par exercice, ou `default` sur la colonne), donc unique par construction, et l'ancien format conservé pour les reçus déjà imprimés.

### 5.5 Dette et hygiène du dépôt

| constat | mesure | correctif |
|---|---|---|
| deux verrous de dépendances, l'un figé | `bun.lock` (737 lignes) **sans** `electron-updater`, à côté de `package-lock.json` (9 756 lignes) | supprimer `bun.lock` (le projet et la CI utilisent npm) |
| fichier étranger au produit | `metadata.json` : `"name": "Executive Finance Suite"` | supprimer |
| secret inlinable, sans consommateur | `vite.config.ts` `define` `process.env.GEMINI_API_KEY`, exigé par `scripts/verify-env-build.mjs:35`, référencé par **aucun** source, absent de `dist/` | retirer le `define` et l'exigence — un `define` transforme une clé en constante publique le jour où un appel est ajouté |
| en-têtes | CSP solide (`default-src 'self'`, `connect-src` limité, `frame-ancestors 'self'`) mais **pas de HSTS, ni COOP/CORP, ni `report-uri`** | les ajouter, et faire remonter les violations CSP |
| chaîne locale | 2 min 36 s par commit, tests = 74 % (1 min 56 s), 2 650 tests | paralléliser la suite par fichiers (le dépôt mesure déjà le gain) ; garder le reste |
| paniques de fork | 4 pendant cette session (push, commit, requêtes) — reprises par `scripts/git-retry.mjs` | rien à coder : le remède existe ; le documenter comme condition de travail normale |
| style du code | 0 `TODO`/`FIXME`/`HACK`/`XXX`, 2 `eslint-disable`, 6 `@ts-expect-error` | rien — c'est exceptionnel |

---

## 6. Ce qui est déjà solide, et qu'il ne faut pas casser

Le dire fait partie de l'état des lieux, parce que la tentation d'une refonte est le risque suivant.

- **Electron est durci** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `setWindowOpenHandler` et `will-navigate` maîtrisés (`electron/main.cjs`).
- **RLS réellement éprouvée sur les tables déclarées** : 210 politiques, refus anon vérifié par `verify-anon-rls` en CI et par une veille quotidienne (`prod-anon-rls`). Ce dispositif est solide — il n'a simplement rien pu dire d'une table que personne ne lui avait nommée (3.0).
- **Le canal de mise à jour est le seul de cette analyse à avoir ses trois états nommés** : tête livrable, 25 versions publiées rattachées, frein d'urgence lisible, le tout **sans jeton** — et un diagnostic qui dit *pourquoi* quand rien ne répond.
- **La sauvegarde est un artefact pensé** : manifeste qui dit ce qu'il contient, empreintes, chiffrement obligatoire en CI, refus avant écriture, restauration idempotente qui recompte.
- **Le hors-ligne est un parti pris assumé**, avec sa file, son rejeu, ses échecs comptés et une histoire d'incidents écrite.
- **La chaîne est sérieuse** : 2 650 tests, 35 contrôles inventoriés avec leur immunité prouvée, 18 workflows, `check-line-budget`, contrastes WCAG, bilingue fr/en vérifié (`l10n-verify`), zéro marqueur de dette.

---

## 7. Ce que je n'ai pas mesuré

- **La taille réelle de la base et son egress** : le plan gratuit n'expose pas ces chiffres par l'API REST ; seul un comptage de lignes par table est possible depuis ici (fait).
- **Le plafond effectif de lignes** du projet : aucune table ne dépasse 1 000 lignes aujourd'hui, donc la troncature **n'a pas pu être observée**, seulement déduite du réglage par défaut documenté par Supabase (1 000, silencieux). C'est la première chose à vérifier le jour où `payments` s'en approche.
- **Le comportement réel du parc** : aucun poste ne remonte quoi que ce soit (c'est le point 4.2) ; tout ce qui suit l'installation (crashs, versions en circulation, échecs de mise à jour côté poste) est invisible d'ici.
- **La latence perçue** au guichet : le score lighthouse est mesuré en CI, mais aucun relevé n'existe sur un poste d'école, sur la connexion de l'école.
- **Le détail de chaque policy RLS** : 210 politiques déclarées, refus anon prouvé sur cinq tables — je n'ai pas revu ligne à ligne les politiques par rôle (admin/staff), seulement leur existence et leur effet anon.
- **L'inventaire exhaustif des tables** : le point d'entrée OpenAPI de PostgREST (`GET /rest/v1/`) n'a rendu aucun chemin, donc l'exposition a été testée sur les **17 tables connues des migrations et du code** — dont une s'est révélée ouverte. Une table créée à la main, hors migration, n'aurait pas été vue : c'est exactement pourquoi le correctif de 3.0 recommande un contrôle qui **énumère** au lieu de vérifier une liste.

---

## 8. Plan ordonné

| ordre | geste | ce qu'il prouve | effort |
|---|---|---|---|
| 1 | Supprimer `students_dupe_backup_20261005` (après archivage) | la clé publique rend **0 ligne** : plus de données de mineurs sur Internet | petit |
| 2 | Contrôle qui **énumère** les tables et refuse celles sans RLS | la classe entière est fermée, pas seulement cette table | moyen |
| 3 | `check:ledger` : réconcilier `amount_paid` et `payments`, réparer depuis les lignes | le registre se referme (rouge aujourd'hui : −4 000 FCFA) | petit |
| 4 | Rendre l'échec d'écriture de la file **visible** + plafond nommé | un paiement ne peut plus être « enregistré » et perdu | petit |
| 5 | Anonymiser les noms d'élèves dans les fichiers suivis | le dépôt public ne porte plus d'identités d'élèves | petit |
| 6 | Garde de complétude des lectures (total vs reçu) + pagination des tables qui grandissent | une réponse partielle devient un état visible | moyen |
| 7 | Déclencheur en base pour `amount_paid` (fin de la dérivation client) | la valeur ne dépend plus d'un instantané mémoire | moyen |
| 8 | Sauvegarde vers un stockage durable + alerte d'âge + escrow de la phrase | la copie survit au 31ᵉ jour, et on le sait | moyen |
| 9 | Journal d'incident local + écran « état du poste » | une panne cesse d'être muette | moyen |
| 10 | ~~Trancher « Business E2E »~~ — **fait le 2026-10-12** : chaque workflow E2E monte sa propre pile (ni projet hébergé, ni `--allow`) | la recette métier **et** le pixel-check sont exercés à chaque push, et ni l'un ni l'autre n'écrit dans la base de l'école | fait |
| 11 | Budget d'octets + objectif lighthouse 0,9 + index manquants | ce que le poste télécharge est borné | moyen |
| 12 | Modale unique (piège de focus) + région live | la tabulation ne quitte plus la modale, l'état hors ligne est annoncé | petit |
| 13 | Numéro de reçu attribué par la base | unicité par construction | petit |
| 14 | Hygiène : `bun.lock`, `metadata.json`, `define` Gemini, HSTS/COOP | moins de pièges dormants | petit |

Les deux premiers gestes ne sont pas de l'amélioration, ce sont des **réparations** : des données de mineurs sont lisibles depuis Internet, et une valeur financière est fausse en base. Les quatre suivants répondent à la même question : *l'école peut-elle perdre de l'argent, ou exposer ses élèves, sans que personne ne l'apprenne ?* Aujourd'hui la réponse mesurée est oui, sur quatre chemins distincts (table ouverte, solde faux, file qui perd, sauvegarde périssable). Le reste rend la panne visible avant qu'elle ne coûte.
