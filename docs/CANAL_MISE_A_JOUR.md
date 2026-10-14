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
5. **la précondition de la base** : il juge la base qu'il va nourrir **avant toute requête** (`scripts/lib/db-ready.mjs`, sur le verdict de `check:hosted-schema`) et **refuse de publier** quand une migration déclarée n'est pas en base — y compris quand le contrôle n'a pas pu rendre de verdict, parce qu'une publication ne se reprend pas. L'ordre « base d'abord » ne dépend donc plus du déploiement du site : un installeur publié avant sa migration aurait équipé tout le parc d'une application qui écrit dans une table absente.

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
| `seen_at` | horodatage |

**Aucune donnée d'école, aucune identité, aucun nom** : un relevé de parc, pas une télémétrie d'usage.

**Protection — et l'`upsert` a dû céder la place à une fonction (arbitré le 2026-10-14).** La clé publique `anon` est livrée dans le bundle, donc la table doit être **inscriptible par `anon`** et **illisible par `anon`**. Or un `upsert` PostgREST est un `INSERT … ON CONFLICT DO UPDATE` : il exige le privilège `UPDATE` **et** une politique `UPDATE` — précisément les deux que cette section refuse. L'écriture passe donc par une **fonction nommée**, `public.record_station_beat(p_station_id, p_app_version, p_os_version, p_last_check, p_last_check_version)`, `SECURITY DEFINER`, dont l'`EXECUTE` est accordé au **seul `anon`** ; elle applique elle-même l'unicité (`ON CONFLICT (station_id) DO UPDATE`, une ligne par poste, l'historique n'est pas conservé). La table, elle, n'ouvre **rien** : RLS activée et **aucune politique** — `anon` lit 0 ligne et toute écriture REST directe est refusée (`401 42501`), comme `student_matricule_counters`. `station_id` est **borné** (8..64), les versions aussi (1..32), `last_check` est contraint à ses quatre états, et `seen_at` a une valeur par défaut posée par la base, jamais par le client : bornes appliquées **dans la fonction** (refus bruyant, nommé) **et** par des contraintes `CHECK` nommées.

**Le point sensible, chiffré.** Une clé publique qui peut écrire est un point d'entrée : rien n'empêche quelqu'un d'appeler la fonction avec des `station_id` inventés, et la table grossirait alors sans fin. Trois garde-fous, tous trois **nommés** : un contrôle qui rougit au-delà d'un seuil de lignes (`--max-rows`, 200 par défaut — le parc réel est de l'ordre de la dizaine), la possibilité de **désactiver le battement** sans toucher au canal (`STATION_HEARTBEAT=off` sur le poste : une écriture refusée n'a aucun effet sur les mises à jour), et les **bornes** ci-dessus, qui refusent une ligne qui ne dit rien d'exploitable. Le contrôle anon existant prouve **les deux directions**, et sans laisser de résidu : la sonde d'insertion passe un `station_id` volontairement **hors bornes**, donc un `400` prouve que la fonction a été atteinte (le GRANT tient) *puis* a refusé — aucune ligne de sonde ne peut ensuite être comptée comme un poste par le relevé. La lecture anon, elle, rend **0 ligne** (mesuré le 2026-10-14 sur la base partagée : `200 []`).

**Ordre d'implémentation, imposé par cette spécification.** Le **canal d'abord** (sections 2 à 6) — il retire la dépendance, c'est la demande. Le **battement ensuite** (section 7), et **jamais activé avant** que le contrôle anon ne prouve l'insertion sans lecture : la seule surface d'écriture anonyme de l'application ne peut pas précéder sa preuve.

**Lecture.** `npm run fleet:versions [--silent-days=N] [--max-rows=N]` imprime la répartition par version, la répartition du dernier contrôle, et **nomme les postes silencieux** (aucun battement depuis N jours, `--silent-days`, 7 par défaut) au lieu de les supposer à jour — un poste silencieux est une **information** (sortie 0), pas un échec ; la sortie 1 est réservée au désaccord entre le relevé et le dépôt, et la 2 à « je n'ai pas pu regarder ». Elle lit avec la clé `service_role` : la clé publique ne voit rien de cette table, par construction. **Ce qu'elle ne peut pas voir, et le dit** : un poste qui n'a **jamais** battu est invisible — on ne nomme pas ce qu'on n'a jamais vu —, donc la bascule du parc (section 6) se prouve aussi poste par poste ; ce relevé ne la remplace pas.

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
| battement | cas unitaire (une ligne, champs exacts) + l'inégalité anon prouvée en CI par `verify-anon-rls` (les deux directions, la sonde skippée sur coupure de transport) ; et la table en base : `check:public-rls` la nomme « scellée », `check:db-objects` aligne ses 6 contraintes, `check:hosted-schema` juge ses 6 colonnes |

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
