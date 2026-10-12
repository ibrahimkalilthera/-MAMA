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

**Et le même chemin a été pris le même jour par le pixel-check PDF**, qui écrivait lui aussi un compte éphémère — et parfois un élève + un paiement de démo — dans la base de l'école : `pdf-e2e.yml` monte sa pile, sert le build de son commit sur `127.0.0.1:4173` et y exécute la garde CSP (7 pages) et les deux pixel-checks (paie, reçu des parents). Ce qui reste **en lecture seule** contre la production, c'est ce qui ne demande aucun compte : la fraîcheur du déploiement, et la politique servie — cette dernière comparée **mot pour mot** à `vercel.json` par `verify-csp-guard.mjs --policy-only`, sans navigateur ni session. Le groupe de concurrence partagé par les deux workflows (il existait parce que les deux écrivaient dans la même base et se jugeaient mutuellement leurs résidus) a disparu avec l'écriture partagée.

**Preuves.** Recette métier : run `38299556209` **vert** sur `d804ca0` (2026-10-12). Pixel-check PDF : run `38300159455` **vert** sur `c3d447b`, 3 min 41 s — fraîcheur confirmée sur le build de ce commit, politique servie par la production conforme (10 directives), garde CSP 7/7 pages · 0 violation, pixel-checks `9/9` et `12/12` sur `http://127.0.0.1:4173/`, nettoyage final **0 enregistrement parcouru** dans la pile de recette. Ce que ces deux jobs ne prouvent **pas**, et qui est dit : le réseau ni la plateforme hébergée (latence, quotas, mise en pause d'un projet) — c'est le métier des veilles qui, elles, visent le vrai domaine (`shared-db-watch`, `check:public-origin`).

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
