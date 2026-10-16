# Canal de mise à jour indépendant de la visibilité du dépôt

**Spécification de conception — 2026-10-11**
**Statut : approuvée en design, à relire avant implémentation.**

Demande du propriétaire : « Rends le canal de mise à jour indépendant de la visibilité du dépôt, en servant le flux et le frein d'urgence depuis une origine publique, avec le chemin de bascule pour les postes déjà installés. »

Décisions prises avec lui : les octets vivent dans un **dépôt public dédié aux releases** ; la bascule du parc se **mesure** par un **battement de version** émis depuis le poste, plutôt que d'être supposée à une date.

---

## 1. Le problème, mesuré

Du **2026-10-07 au 2026-10-11**, le dépôt est passé en privé : un lecteur anonyme recevait un 404 sur `github.com/<owner>/<repo>/releases/latest`, et **le parc ne pouvait plus rien recevoir**. Le défaut n'était pas dans le publieur : il était dans la **topologie** — le flux, les octets et le frein vivaient tous sur une origine dont la visibilité décide, et c'est une visibilité qui se change en un clic, sans commit, sans test, sans que personne ne l'apprenne avant qu'un poste ne réclame.

Le diagnostic (commit `5965a8e`) a rendu la panne **lisible** ; cette spécification la rend **impossible** : après elle, la visibilité du dépôt source n'a plus d'effet sur ce qu'un poste installé reçoit.

### Ce qui est déjà en place, et qu'on ne remplace pas

- `electron/main.cjs` : `if (process.env.UPDATER_FEED_URL) autoUpdater.setFeedURL({ provider: 'generic', url: … })` — le poste **sait déjà** lire un flux `generic`.
- `electron/main.cjs` : `holdsUrlFrom({ feedOverride: process.env.UPDATER_HOLD_URL || process.env.UPDATER_FEED_URL, appUpdateYml })` → le frein est **dérivé du même réglage**, résolu en `new URL('updates/holds.json', base)`. Viser notre origine déplace donc **le flux et le frein d'un seul geste**, et le chemin `updates/holds.json` est déjà celui du dépôt.
- `electron/public-origin.cjs` : `PUBLIC_ORIGIN`, une seule définition, embarquée dans chaque installeur, relue par `check-public-origin.mjs` et l'inventaire des liens embarqués.
- `scripts/verify-updater.mjs` : un serveur de flux local qui **exerce l'updater de bout en bout** — le harnais de preuve existe.
- `scripts/publish-release.mjs` : publie un **seul** release par version, et refuse de publier autre chose que ce que `latest.yml` annonce.

### Faits vérifiés dans le code livré (pas supposés)

| fait | où | conséquence |
|---|---|---|
| une URL **absolue** dans `files[].url` garde son domaine (`new URL(pathname, baseUrl)`) | `node_modules/electron-updater/out/util.js` (6.8.9) | le flux peut vivre chez nous et les octets ailleurs |
| l'URL de **base** écrase la *query* de l'URL absolue | même fichier | l'URL de base ne doit porter **aucune query** |
| `app-update.yml` ne porte que **le premier** `publish`, et l'updater n'a **aucun repli** entre providers | `electron-builder` 26 / `providerFactory.ts` | tout repli est **notre** code, et doit être nommé |
| un fichier statique **gagne** la réécriture attrape-tout du site | mesuré : `/templates/recu-parent.pdf` → `application/pdf` | poser le flux et le frein dans `public/` fonctionne |
| un chemin **absent répond 200 en `text/html`** | mesuré : `/updates/inexistant.json` → 200, `text/html`, 1056 o | **un flux disparu n'est pas un 404** : le canal doit refuser un 200-HTML comme « absent » |

---

## 2. Anatomie cible

| objet | source de vérité | diffusion | URL lue par un poste |
|---|---|---|---|
| flux `latest.yml` | produit au release par `publish-release.mjs` | `public/latest.yml`, commité | `https://mama-thera-finance.vercel.app/latest.yml` |
| frein `updates/holds.json` | `updates/holds.json` du dépôt | miroir généré dans `public/updates/holds.json` | `https://mama-thera-finance.vercel.app/updates/holds.json` |
| installeur + blockmap | `release/` du poste de build | dépôt public dédié aux releases | URL **absolue** dans `files[].url` du flux |
| manifeste d'arborescence | `release/` | dépôt d'octets | aucune (preuve de build) |

Le dépôt d'octets est un dépôt **public** qui ne contient que des releases (`MAMA-releases` proposé : visibilité publique permanente, aucun code, aucune donnée d'école). Son URL est `https://github.com/<owner>/MAMA-releases/releases/download/v<version>/<fichier>`.

Trois invariants en découlent :

1. **La tête du canal est la version du flux.** En `generic`, il n'existe plus d'endpoint « le dernier release » : une seule source dit quelle version est en tête, au lieu de deux (le flux et l'API) qui pouvaient diverger en silence. Le quota anonyme partagé de `api.github.com` — cause mesurée d'un rouge de trois jours en septembre — cesse d'être un sujet.
2. **Le flux est l'interrupteur.** Parce que `files[].url` est absolue, changer d'hébergeur d'octets, ou revenir temporairement à GitHub, se fait en **éditant un fichier**, sans reconstruire ni réinstaller.
3. **Le frein suit le flux, pas une copie.** Aucune URL de frein n'est recopiée : les deux se déduisent du même `app-update.yml`.

---

## 3. Côté poste

- `electron-builder.yml` passe à `publish: { provider: generic, url: https://mama-thera-finance.vercel.app/ }` (sans query). `electron-builder` écrit alors `app-update.yml` avec ce seul provider ; `--publish never` reste inchangé, c'est `publish-release.mjs` qui publie.
- `UPDATER_FEED_URL` et `UPDATER_HOLD_URL` restent : ils servent le **mode preuve** (serveur local) et la porte de secours par machine. Ils ne sont pas le plan de bascule.
- La promesse d'octets (`feedUrlForPoste` / rehachage) résout désormais l'URL **telle qu'elle est annoncée** ; si le flux annonce une URL absolue, elle est suivie telle quelle.
- **Aucun repli silencieux.** Si l'origine ne répond pas (ou répond en HTML), le journal de mise à jour le **dit** (`check-failed`, nommant l'origine). Un repli vers GitHub, s'il est gardé pendant le pont, est un état **nommé** dans le journal, jamais une substitution muette.

---

## 4. Côté publieur

`publish-release.mjs` conserve sa discipline (un seul release par destination, rien de publié que le flux n'annonce) et gagne :

1. **une seconde destination** : les octets vérifiés (installeur, blockmap, portable, manifeste) sont téléversés dans le dépôt d'octets ;
2. **l'écriture du flux** : `latest.yml` est **réécrit** avec les URL absolues du dépôt d'octets, puis posé dans `public/latest.yml` — le flux est donc produit **à partir de ce qui a été téléversé et vérifié**, jamais d'une intention ;
3. **le miroir du frein** : `updates/holds.json` → `public/updates/holds.json`, copie **générée et vérifiée** (un contrôle refuse une copie en retard, comme `db:snapshot:check` le fait pour le fichier complet) ;
4. le commit de ces deux fichiers, que le déploiement du site sert ensuite ;
5. **la précondition de la base** : il juge la base qu'il va nourrir **avant toute requête** (`scripts/lib/db-ready.mjs`) et **refuse de publier** quand une migration déclarée n'est pas en base — y compris quand un contrôle n'a pas pu rendre de verdict, parce qu'une publication ne se reprend pas. La question est posée **trois fois**, pas une : les COLONNES (`check:hosted-schema`), les INDEX, CONTRAINTES et DÉCLENCHEURS (`check:db-objects`), et les POLITIQUES (`check:rls-policies`) — mesuré le **2026-10-16**, la migration du nom d'école n'ajoute aucune colonne, seulement une contrainte, et la question des colonnes seule répondait « la base est prête » pour une base qui n'avait pas la règle du build. L'ordre « base d'abord » ne dépend donc plus du déploiement du site : un installeur publié avant sa migration aurait équipé tout le parc d'une application qui écrit dans une table absente. Et depuis le même jour, les **deux chaînes** posent ces trois questions **avant leur build** (porte n°5 de `deploy.yml`, gate n°2 de `desktop-release.yml`) : un push qui oublie une migration n'atteint même pas la compilation — pour le site, la base en retard est **rouge** et « je n'ai pas pu regarder » **neutre** (78) ; pour l'installeur, les deux **refusent**, parce qu'une publication ne se reprend pas.

**Jeton.** `github.token` est limité au dépôt source et ne peut pas écrire ailleurs : un secret dédié est requis, de périmètre minimal (`contents: write` **sur le dépôt d'octets uniquement**). Le même geste reste exécutable à la main depuis le poste du propriétaire en secours.

**Conséquence assumée :** un release implique désormais un **déploiement du site**. Le contrôle lit le flux **tel que le site le sert**, pas tel qu'il est dans Git.

**Et une seconde, du même ordre :** publier demande une base **À JOUR**. La porte existait côté site (la quatrième de `deploy.yml`) ; elle existe maintenant là où l'octet part réellement, donc un `npm run release:publish` lancé à la main depuis un poste ne peut plus la contourner.

---

## 5. Côté contrôles

- `check-release-coherence.mjs --channel` lit le nouveau canal comme un poste : flux **sans jeton**, frein **sans jeton**, octets rehachés depuis l'URL absolue. Il conserve le verdict à trois états du frein.
- Deux refus **nommés** s'ajoutent : **200-HTML = absent** (le piège mesuré de cette origine) et **désaccord flux ↔ dépôt d'octets** (l'un annonce un fichier que l'autre n'a pas, ou une taille/empreinte qui ne correspond pas).
- La veille `release-channel-watch.yml` **perd `GH_TOKEN`** : la preuve redevient sans jeton **par construction**. Le mode `--needed`, le gate du workflow de release et les contrôles qui relisent les octets publiés changent de source, pas de doctrine.
- Le frein et le flux sont servis avec **`Cache-Control: no-store`** (en-tête ajouté dans `vercel.json`) : aujourd'hui la fraîcheur du frein était décidée par `raw.githubusercontent.com`, demain elle doit l'être par nous — un frein en cache est un levier d'urgence qui ne retient rien.

---

## 6. Bascule du parc

1. **Une dernière mise à jour par GitHub.** Un poste en 1.0.27 ne lit que `provider: github` : rien de ce qu'on livre aujourd'hui ne l'atteint autrement. Le dépôt source **doit rester public** jusqu'à ce que cette mise à jour soit passée.
2. La version de bascule embarque le provider `generic` (section 3) ; à partir d'elle, un poste ne dépend plus de la visibilité du dépôt.
3. **Le battement de version** (section 7) dit quand le parc est passé. Le dépôt source ne peut redevenir privé que quand **tous les postes connus** sont ≥ la version de bascule.
4. **Porte de secours**, pas plan : `UPDATER_FEED_URL` posé à la main sur une machine (accès administrateur requis).

**Retour arrière.** Le flux étant l'interrupteur, un retour se fait en réécrivant `public/latest.yml` — y compris pour repointer les octets vers GitHub ; les postes déjà au-dessus de la version de bascule gardent le provider `generic` et suivent ce que le flux annonce. Aucun poste n'a besoin d'être réinstallé pour un changement d'hébergeur.

---

## 7. Battement de version

**Ce qui est écrit.** Une ligne par poste, au démarrage et après chaque mise à jour :

| champ | nature |
|---|---|
| `station_id` | identifiant **aléatoire**, rangé dans `userData` (même dossier que la file hors ligne) |
| `app_version` | la version installée |
| `os_version` | le majeur de Windows |
| `last_check` | `ok` / `feed-absent` / `html` / `unreachable`, et la version proposée |
| `install_mode` | la **forme** du poste, telle qu'il la déclare : `portable` / `installed`, ou **rien** quand elle n'est pas mesurée (application non empaquetée) |
| `converted_at` | la date (posée par la **base**) de la **première** conversion `portable` → `installed` **observée** sur ce poste |
| `converted_to_version` | la version exécutée au battement qui a **porté** cette conversion |
| `seen_at` | horodatage |

**La forme du poste, et la trace d'une conversion (migration `20261021000000_station_install_mode.sql`).** Depuis le 2026-10-16, un poste **portable** n'est plus condamné à rester en arrière : il télécharge l'installeur annoncé, l'exécute en silencieux et devient un poste **installé**, qui se met à jour tout seul ensuite (`PORTABLE_INSTALL_ARGS`, `electron/updater-policy.cjs`). Le geste était décidé, éprouvé et justifié — et **invisible**. Le relevé portait la version et le dernier contrôle, **jamais la forme** : « le parc s'est converti » restait une espérance, et une école dont le poste restait portable était indiscernable d'une école dont le poste s'était converti — la leçon de la section 6, une affirmation que personne ne peut confirmer. Deux lectures sont donc ajoutées, et elles ne disent **pas** la même chose : la forme **déclarée** au dernier battement (`install_mode`), qui dit qui se met à jour tout seul et qui, resté portable, ne se corrigera **pas** à distance (une installation manuelle, une fois, et il se met à jour seul ensuite) ; et la trace `converted_at`/`converted_to_version`, une conversion **datée par la base**, donc un fait au lieu d'une supposition. Le mode `portable` est **mesuré** et jamais deviné (`app.isPackaged` + `PORTABLE_EXECUTABLE_FILE`, dans `electron/station-beat.cjs`) — une application non empaquetée ne déclare aucune forme. Et la reconnaissance de la transition vit **dans la fonction d'écriture** (`ON CONFLICT … DO UPDATE`, dont les expressions lisent la ligne d'avant) : le relevé ne garde aucune histoire, donc une transition ne se voit qu'à l'instant où elle arrive, sans lecture préalable et sans course possible entre ce qui serait lu et ce qui serait écrit. `converted_at` n'est **jamais effacé** : la colonne porte un fait, pas l'état du jour — un poste relancé en portable plus tard garde la trace de sa conversion, et le relevé le **dit**. Le geste a gagné un argument (`p_install_mode TEXT DEFAULT NULL`), donc l'ancienne signature est **retirée** avant que la nouvelle soit créée : Postgres identifie une fonction par (nom, types d'arguments), et deux surcharges rendraient ambigu l'appel d'un poste resté sur la version en service.

**Aucune donnée d'école, aucune identité, aucun nom** : un relevé de parc, pas une télémétrie d'usage. Et cela reste vrai **du relevé** depuis qu'un nom d'école existe dans l'application (2026-10-16) : ce nom ne monte pas ici, il monte par le canal des incidents, à côté du nom de la machine (point 2, plus bas).

**Le nom du poste, et par où il remonte quand une école se convertit (ajouté le 2026-10-16).** La promesse ci-dessus tient, et rien de ce qui suit ne l'assouplit : le relevé ne porte **aucun nom**, aucune identité d'école. Elle laissait pourtant une question sans réponse, et c'est la première que la conversion pose : **quelle école ?** Le relevé **date** la conversion (`converted_at`, posée par la base) mais ne peut pas la nommer — `station_id` est aléatoire et rangé sur la machine. La réponse ne vient donc pas du relevé : elle vient du canal qui **nomme** déjà les postes, celui des incidents. Au battement qui porte la conversion, le processus principal lit la forme **d'AVANT** — le seul instant où elle existe encore, puisque `recordBeat` remplace le fichier — et, si elle est passée de `portable` à `installed`, il inscrit le fait dans le **journal local** du poste (`electron/update-journal.cjs`) avec le nom de la machine (`os.hostname()`, le champ `station` que portent déjà tous les rapports de blocage). Ce fait **attend sans session**, part au **premier démarrage connecté** par la file existante, et arrive au journal d'audit composé comme une conversion : l'action le dit (« poste portable converti en poste installé — il se met à jour tout seul désormais — remonté depuis le journal du poste »), le poste est nommé, les deux versions sont écrites (celle du passage, et celle d'avant), et il n'est **pas** regroupé comme une panne (`blockedIncidents` ne le touche pas, et `parseBlockedReport` le refuse : ce n'est pas un rapport d'échec). Et, depuis le 2026-10-16, ce rapport porte **aussi le nom de l'école**, juste après celui du poste : la question « quelle école ? » a maintenant sa réponse, et le point 2 ci-dessous dit laquelle — et ce qu'elle ne couvre pas.

Trois choses changent, et elles se disent plutôt que se découvrir :

1. **Le même fait a maintenant deux lectures, et elles ne couvrent pas la même chose.** Le relevé **date** ce que la base a observé, sans nom, pour tout le parc ; le canal des incidents **nomme** le poste, une école à la fois, à partir de ce que la machine a constaté. Les deux peuvent diverger : un poste qui ne rouvre **jamais** de session porte un fait que le relevé date et que l'audit n'a pas reçu (le journal attend sur place) ; un poste dont la ligne en base a disparu (réinstallation, base restaurée) porte un fait que le journal nomme et que le relevé n'a jamais vu. Aucune des deux lectures ne remplace l'autre : le relevé dit **combien**, l'audit dit **laquelle**.
2. **Le nom qui remontait était celui du POSTE seul — un nom d'école l'accompagne désormais (limite corrigée le 2026-10-16).** Ce point disait l'application **sans** champ « nom de l'école » : c'était vrai alors, et c'était la limite écrite — deux écoles dont les machines portent le même nom se confondaient, parce que ce n'était pas le canal qui était en cause, mais ce que l'application contenait. Le champ existe maintenant, et il a la forme que son sujet demande : **une seule ligne** d'`app_settings` (clé `school.name`, contrat `src/lib/schoolName.ts` — 2 à 120 caractères, séparateur des rapports « · » refusé), écrite une fois pour tout le parc par l'**administration** (les politiques d'`app_settings` réservent déjà l'écriture à `public.is_admin()` ; la migration `20261022000000_school_name.sql` n'ajoute **aucune** politique, seulement la contrainte de forme), et lue par un poste **connecté**. Chaque remontée du canal la compose **juste après le nom de la machine** : `poste PC-DIRECTION · école Complexe Scolaire Mama Thera · version 1.0.4 → 1.0.5 · motif : …` — placée là, avant la version et le motif, pour que le regroupement des incidents (`src/lib/blockedIncidents.ts`, qui cherche ces marqueurs par leur préfixe) lise exactement la même chose qu'avant. Quatre choses ne changent **pas**, et elles sont la raison pour laquelle cette correction n'assouplit rien : **le relevé** (§7, la table) ne porte toujours **aucun** nom — c'est le canal des incidents qui répond, pas le recensement ; il faut **toujours une session** pour que la remontée parte (c'est le rendu qui lit le nom, pas le processus principal : le journal local du poste ne le porte pas) ; le nom n'est **jamais inventé** (aucune école déclarée, nom illisible ou lecture ratée ⇒ **aucun champ**, jamais « école inconnue », qui se lirait comme le nom d'une école parmi d'autres) ; et le geste se déclare **sans réseau** (le changement part en file, et le rejeu écrit exactement la même ligne — `src/lib/offlineReplaySchoolName.ts`). À ce jour, **aucune remontée portant un nom d'école n'a encore été reçue** : ce qui est décrit ici est ce que le poste compose.
3. **Cette remontée ne part que si quelqu'un se connecte.** Comme un blocage : le délai est celui du premier démarrage connecté après la conversion, et un poste qui n'ouvre plus de session garde son fait dans son journal local, lisible sur place (`updates:open-journal`). Le remède, quand on veut le nom tout de suite, est le même que pour un blocage : ouvrir une session sur le poste.

**Ce qui ne change PAS, et la borne est copiée de la base.** Une forme **jamais mesurée** n'est pas une conversion, ni ici ni en base : la comparaison exige `portable` → `installed`, et lui seul (l'inverse — relancer l'exe portable sur une machine installée — est un retour en arrière, pas un basculement). Un poste dont le relevé d'avant ne déclarait aucune forme (version antérieure à ce champ, application non empaquetée) ne produit donc **ni** `converted_at` en base, **ni** fait de journal : c'est la même règle des deux côtés, *exprès* — le journal ne peut pas annoncer une conversion que le relevé ne date pas, sinon les deux lectures du même événement se contrediraient, et une contradiction sur un fait daté est pire qu'un silence. **Conséquence à dire** : tant que le parc tourne sur une version qui ne **déclare** pas sa forme, une conversion ne laisse **aucune** trace ; le premier fait **nommé** sera celui d'un poste qui déclarait déjà sa forme avant de basculer, c'est-à-dire à partir de la version publiée qui envoie ce champ.

**Et la date n'a pas la même source selon le canal.** Le fait du journal est horodaté par l'**horloge du poste** (comme tout rapport qui attend : c'est le même mécanisme de file), alors que `converted_at`, en base, est posé par la **base**. Quand les deux diffèrent, c'est la date de la base qui fait foi — l'horloge d'un poste d'école peut être fausse, et c'est exactement pourquoi `seen_at` n'a jamais été posé par le poste (§7, et `beatPayload` ne l'invente pas non plus).

**Protection — et l'`upsert` a dû céder la place à une fonction (arbitré le 2026-10-14).** La clé publique `anon` est livrée dans le bundle, donc la table doit être **inscriptible par `anon`** et **illisible par `anon`**. Or un `upsert` PostgREST est un `INSERT … ON CONFLICT DO UPDATE` : il exige le privilège `UPDATE` **et** une politique `UPDATE` — précisément les deux que cette section refuse. L'écriture passe donc par une **fonction nommée**, `public.record_station_beat(p_station_id, p_app_version, p_os_version, p_last_check, p_last_check_version, p_install_mode)`, `SECURITY DEFINER`, dont l'`EXECUTE` est accordé au **seul `anon`** ; elle applique elle-même l'unicité (`ON CONFLICT (station_id) DO UPDATE`, une ligne par poste, l'historique n'est pas conservé). La table, elle, n'ouvre **rien** : RLS activée et **aucune politique** — `anon` lit 0 ligne et toute écriture REST directe est refusée (`401 42501`), comme `student_matricule_counters`. `station_id` est **borné** (8..64), les versions aussi (1..32), `last_check` est contraint à ses quatre états, et `seen_at` a une valeur par défaut posée par la base, jamais par le client : bornes appliquées **dans la fonction** (refus bruyant, nommé) **et** par des contraintes `CHECK` nommées.

**Le point sensible, chiffré.** Une clé publique qui peut écrire est un point d'entrée : rien n'empêche quelqu'un d'appeler la fonction avec des `station_id` inventés, et la table grossirait alors sans fin. Trois garde-fous, tous trois **nommés** : un contrôle qui rougit au-delà d'un seuil de lignes (`--max-rows`, 200 par défaut — le parc réel est de l'ordre de la dizaine), la possibilité de **désactiver le battement** sans toucher au canal (`STATION_HEARTBEAT=off` sur le poste : une écriture refusée n'a aucun effet sur les mises à jour), et les **bornes** ci-dessus, qui refusent une ligne qui ne dit rien d'exploitable. Le contrôle anon existant prouve **les deux directions**, et sans laisser de résidu : la sonde d'insertion passe un `station_id` volontairement **hors bornes**, donc un `400` prouve que la fonction a été atteinte (le GRANT tient) *puis* a refusé — aucune ligne de sonde ne peut ensuite être comptée comme un poste par le relevé. La lecture anon, elle, rend **0 ligne** (mesuré le 2026-10-14 sur la base partagée : `200 []`).

**Ordre d'implémentation, imposé par cette spécification.** Le **canal d'abord** (sections 2 à 6) — il retire la dépendance, c'est la demande. Le **battement ensuite** (section 7), et **jamais activé avant** que le contrôle anon ne prouve l'insertion sans lecture : la seule surface d'écriture anonyme de l'application ne peut pas précéder sa preuve.

**L'annonce, en tête du relevé (ajouté avec la trace).** Les conversions sont listées plus bas, et c'est le défaut : **une liste se lit quand on la cherche**. Or la **première** conversion est l'événement que ce relevé existe pour rendre visible — le jour où un poste cesse d'être un poste à convertir à la main. Elle est donc **annoncée en tête**, avec le poste, la version du passage et le **jour** où la base l'a datée : `🔔 PREMIÈRE conversion portable → installé observée le …`. Son **absence** est annoncée de la même façon (`🔔 aucune conversion … observée à ce jour`), et l'annonce dit ce qu'elle **ne peut pas** nommer : le relevé ne porte **aucun nom d'école** (§7), l'identité du poste est aléatoire et rangée sur la machine — « quelle école » ne se lit donc **jamais dans le relevé** : l'annonce renvoie au journal du poste — et, depuis l'ajout ci-dessus, au journal d'audit, où le nom du poste arrive par le même canal d'incidents (le relevé, lui, ne le porte toujours pas : c'est le poste qui parle, et c'est le seul habilité à dire comment on l'appelle). La même annonce part avec la **preuve publiée** par la veille quotidienne (la première conversion, sa date et sa version) : c'est l'annotation « Automation evidence » qui la porte, parce qu'un journal de CI ne laisse pas voir une liste. Un horodatage illisible ne prend jamais le titre de « première » — nommer un fait daté sans en avoir lu la date serait inventer — et l'annonce le dit alors autrement.

**Lecture.** `npm run fleet:versions [--silent-days=N] [--max-rows=N]` imprime la répartition par version, la répartition du dernier contrôle, la **forme des postes** (combien d'installés, combien d'encore-portables, combien sans forme déclarée), les **conversions portable → installé observées** (nommées, datées, avec la version du passage), **annonce la première en tête**, et **nomme les postes silencieux** (aucun battement depuis N jours, `--silent-days`, 7 par défaut) au lieu de les supposer à jour — un poste silencieux est une **information** (sortie 0), pas un échec ; la sortie 1 est réservée au désaccord entre le relevé et le dépôt, et la 2 à « je n'ai pas pu regarder ». Et un zéro de conversion **dit ce qu'il ne peut pas couvrir** (un poste converti avant l'arrivée de ce champ n'a laissé aucune trace) plutôt que de laisser lire « il ne s'est rien passé ». Une base **en retard** sur la migration de la forme est **nommée avec le remède** (`npm run db:apply -- supabase/migrations/20261021000000_station_install_mode.sql`) au lieu d'un « HTTP 400 » nu : on met la base à niveau, jamais le relevé. Elle lit avec la clé `service_role` : la clé publique ne voit rien de cette table, par construction. **Ce qu'elle ne peut pas voir, et le dit** : un poste qui n'a **jamais** battu est invisible — on ne nomme pas ce qu'on n'a jamais vu —, donc la bascule du parc (section 6) se prouve aussi poste par poste ; ce relevé ne la remplace pas.

**Exécution — une commande que rien n'appelait ne mesurait rien (arbitré le 2026-10-19).** Le lecteur existait et le battement écrivait en base ; il manquait le geste qui décide de tout : **personne ne l'exécutait**. Le mot `fleet` n'apparaissait dans aucun workflow, donc « le parc n'a aucun relevé par version » restait vrai à chaque livraison, et « toutes les stations sont passées » se prouvait **poste par poste** — c'est-à-dire ne se prouvait pas. `.github/workflows/fleet-versions-watch.yml` l'exécute désormais **chaque jour à 07:20 UTC** (après la veille de la base partagée, loin de l'audit des automatisations qui juge sa preuve), plus un `push` limité aux chemins du relevé — le moment où le contrôle lui-même change — et un `workflow_dispatch`. Les **chiffres** (postes recensés, silencieux, contrôles non aboutis) sont publiés par le script lui-même, sous le mandat de l'étape (`AUTOMATION_EVIDENCE=1`) : un run vert qui ne dirait pas combien de postes il a vus prouverait autant qu'un run qui n'a rien regardé. Un relevé quotidien est ce qui distingue cette mesure d'une photo : un poste qui se tait ne produit aucun commit, donc le silence d'une école ne se voit que dans le temps.

---

## 8. Preuves attendues

| geste | preuve |
|---|---|
| anatomie complète exercée de bout en bout | `scripts/verify-updater.mjs` étendu : flux à la racine, frein sous `/updates/`, octet en URL **absolue**, les quatre passes de seuil et la passe de retenue inchangées |
| flux réécrit correctement | cas unitaire du réécrivain : URL absolue, taille et `sha512` conservés, aucune query dans la base |
| frein en phase | cas qui refuse une copie `public/updates/holds.json` en retard sur `updates/holds.json` |
| absence ≠ contenu | cas qui refuse un **200-HTML** comme « absent », sur le flux comme sur le frein |
| canal jamais authentifié | `npm run check:release:channel` vert **sans aucun jeton**, et la veille sans `GH_TOKEN` |
| désaccord entre origines | cas qui refuse un flux annonçant un fichier absent du dépôt d'octets |
| battement | cas unitaire (une ligne, champs exacts) + l'inégalité anon prouvée en CI par `verify-anon-rls` (les deux directions, la sonde skippée sur coupure de transport) ; et la table en base : `check:public-rls` la nomme « scellée », `check:db-objects` aligne ses 8 contraintes, `check:hosted-schema` juge ses 9 colonnes |
| forme du poste et conversions | `tests/station-beat.test.ts` (la forme se **mesure** : empaquetée + `PORTABLE_EXECUTABLE_FILE` ; une forme inconnue n'est pas recopiée) + `tests/station-version.test.ts` (forme inconnue refusée **avant** l'appel, et l'accord avec la **dernière** déclaration de la fonction : une seule signature, l'ancienne retirée, la conversion datée par la base et jamais déplacée) + `tests/fleet-versions.test.ts` (répartition de forme où « non mesurée » n'est jamais « installée », conversions nommées avec leur date et la version **du passage**, **première** conversion = la plus ANCIENNE et non la plus récente — un horodatage illisible ne prend jamais ce titre —, annonce placée **avant** la liste et son absence dite aussi, zéro qui dit ce qu'il ne couvre pas, base en retard nommée avec sa migration) + la veille quotidienne, qui **annonce** la première conversion (poste, version, jour) en tête de sortie et dans la preuve publiée |
| la conversion **nommée** par le poste | `tests/station-beat.test.ts` (le sens `portable` → `installed` et lui seul, une forme jamais mesurée n'est pas une conversion, une version non lue reste `null`, et la constatation se fait **avant** l'écriture : après, la forme d'avant n'existe plus) + `tests/gate-report.test.ts` (une conversion remonte par la **même file**, nommée par le poste, marquée comme partie, et **ne se dit pas** « poste bloqué » ; le code est le même dans les deux modules — le poste l'écrit, le rendu le lit ; le câblage de `main.cjs` est lu dans le fichier : lecture d'avant, fait pur, inscription au journal) + `tests/blocked-incidents.test.ts` (une conversion n'entre dans aucun incident et n'en fabrique pas : elle reste une ligne lisible, et elle nomme le poste) |
| relevé du parc **exécuté** | `tests/fleet-versions.test.ts` (36 cas : drapeau inconnu refusé, ordre **numérique** des versions, état de contrôle inconnu compté, forme du poste où « non mesurée » n'est jamais « installée », conversions **observées** nommées avec leur date et la version du passage, silence mesuré sur `seen_at`, seuil de volume qui fait échouer) + la veille `fleet-versions-watch.yml`, dont le run **publie ses propres chiffres** — postes recensés, silencieux, contrôles non aboutis — dans l'annotation « Automation evidence » que lit l'audit des automatisations : un run vert sans chiffres ne vaut pas mieux qu'un run qui n'a rien regardé |

---

## 9. Hors périmètre

- **La signature de code** (`docs/CODE_SIGNING.md`) : le parc reste servi par des binaires non signés, et le contrat embarqué le dit (`NotSigned`). Un canal indépendant ne rend pas un binaire signé, et l'inverse est vrai aussi.
- **Le stockage Supabase et tout autre hébergeur d'octets** : le dépôt d'octets a été choisi ; changer d'hébergeur plus tard est un édit de flux (section 2, invariant 2), pas un chantier.
- **La refonte de `publish-release.mjs`** : il gagne une destination, il ne change pas de forme.

## 10. Risques ouverts

1. **Le pont dépend encore de la visibilité du dépôt** (section 6, point 1). Incompressible par le code : c'est un fait de topologie, il est dit.
2. **Le dépôt d'octets est encore GitHub** : sa visibilité est sous notre contrôle et il ne contient aucun code, mais la dépendance à un hébergeur demeure — elle est nommée, pas cachée.
3. **Le déploiement du site devient une étape du canal** : un release dont le déploiement échoue laisse un flux périmé — d'où la vérification du flux **servi**, et non du fichier du dépôt.
4. **Le battement introduit la première surface d'écriture anonyme de l'application.** C'est le point le plus sensible de cette spécification : il doit être cadré par les tests anon **avant** d'être activé, et désactivable si l'école le refuse.
