# MAMA THERA Finance Suite

Application de gestion financière scolaire (élèves, parents, paiements, dépenses, paie, audit) — React 19 + TypeScript strict + Vite 6 + Tailwind 4, backend Supabase (Auth + RLS), i18n fr/en, 6 thèmes, file d'écriture offline pour le terrain (Bamako).

> Documentation d'historique et d'architecture détaillée : voir `DEVELOPMENT_HISTORY.md`.

## Démarrage rapide

**Prérequis** : Node.js **22** (pinné dans `.nvmrc`) — **aucun gestionnaire de version à installer**. Le projet provisionne lui-même le runtime qu'il épingle : `npm run setup:node` (aussi lancé en douceur par `npm install`), et **toutes** les entrées du projet passent par `scripts/with-pinned-node.mjs`, qui bascule sur ce runtime : les hooks git, les gates (`npm run lint`, `npm run quality`) et les commandes du quotidien (`npm run dev`, `build`, `preview`, `electron:ui`) — celles-ci par le mode `--bin`, qui exécute l'entrée que le paquet déclare lui-même (`vite`), donc **plus aucune commande ne résout son outil par `PATH`**. Ce pin n'est **plus** injecté dans la variable `PATH` : le lanceur écrit `node`, `npm` et `npx` dans `node_modules/.bin`, le dossier que npm met **déjà en tête** pour chaque script (`eslint`, `tsc` s'y résolvent ainsi) — le pin devient structurel au lieu d'être réécrit dans l'environnement, et une recherche PATH (`where npm`) ne peut plus tomber sur un de nos wrappers en le prenant pour l'npm de la machine. Sur une machine déjà en 22 (comme la CI), la bascule est un no-op : rien à télécharger. Pour un **terminal** sur ce runtime : `npm run shell` (ou, dans un terminal déjà ouvert, `export PATH="$(npm run --silent shell -- --print):$PATH"`).

> ⚠️ **Version de Node — pourquoi 22 ?**
> Les tests utilisent `mock.module()` avec l'option `namedExports`, **seule API disponible sur Node 22** (celle de la CI). Sur Node ≥ 25, cette option est dépréciée au profit de `exports` (warning `DeprecationWarning` local). Node 23/24 fonctionnent avec un warning ; rester sur 22 garantit la parité CI/local. Migrer vers `exports` seulement quand Node 22 EOL et que la CI passe sur Node ≥ 25.

```bash
# 1. Installer les dépendances (npm uniquement — package-lock.json est la source de vérité)
npm install

# 2. Configurer l'environnement
cp .env.example .env
# puis remplir VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (obligatoires)

# 3. Lancer le serveur de développement
npm run dev            # http://localhost:3000

# 4. Vérifier la qualité avant de commit
npm run quality        # lint (0 warning) + tests + audit de contraste
```

## Environnements

| Fichier | Mode | Usage |
|---|---|---|
| `.env` | development | dev local |
| `.env.staging` | staging | build `npm run build:staging` |
| `.env.production` | production | build `npm run build:production` |

Variables (voir `.env.example`) :
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — **requis** (client browser)
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_PASSWORD` — serveur uniquement (seed)
- `GEMINI_API_KEY` — assistant IA

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Vite dev server (port 3000, mode development) |
| `npm run dev:staging` | dev server en mode staging |
| `npm run build[:staging\|:production]` | build de production |
| `npm test` | 921 tests (node:test + tsx, module-mocks expérimental) |
| `npm run lint` | **parité de version Node** (`.nvmrc` ↔ poste) + ESLint 0-warning + tsc strict + guards custom (props, `any`, harnais de tests, **intégrité des suites**, stylelint, CSS, i18n, emoji, dates Windows, budget de lignes, **parité CI ↔ package.json**, snapshot SQL) |
| `npm run quality` | lint + tests + audit de contraste WCAG 6 thèmes (identique au pre-commit/CI) |
| `npm run check:node-layout` | vérifie **sur la machine** le layout npm réel (`<prefix>/node_modules/npm` sous Windows, `<prefix>/lib/node_modules/npm` sous Unix) et que le chemin trouvé **exécute** npm ; en CI, une matrice l'exécute sur `ubuntu-latest` **et** `windows-latest` |
| `npm run check:contrast` | audit de contraste seul (backend fixtures, aucun secret ; `AUDIT_FIXTURES=0` + `AUDIT_EMAIL`/`AUDIT_PASSWORD` pour un vrai backend) |
| `npm run seed` | seed de DÉMO (dev/staging uniquement — garde : refuse la prod sans `VITE_APP_ENV=dev\|staging`, et `--clean` refuse le projet de production) ; `:staging` ; `seed:production` = script structurel |
| `npm run db:snapshot` | régénère `supabase/FULL_SETUP_MIGRATION.sql` depuis les migrations |
| `npm run db:snapshot:check` | CI : échoue si le snapshot SQL a dérivé des migrations |
| `npm run db:profiles:export` | exporte `user_profiles` (rôles) via la service key → JSON |
| `npm run db:profiles:restore -- --file F.json` | restaure les rôles après migration sur base vide (confirmation interactive) |
| `npm run dev` / `build` / `preview` | commandes du quotidien : elles exécutent l'entrée `bin` de `vite` sous le runtime épinglé (`--bin`), jamais celui du shell. Au démarrage, `dev` **affiche le runtime qui sert** (version + chemin exact) et **prévient si un autre majeur de Node est présent dans l'environnement** — un écart de majeur ne casse pas au démarrage, il casse plus loin (`scripts/lib/runtime-banner.mjs`) |
| `npm run shell` | terminal où `node`/`npm`/`npx` sont le runtime épinglé (`-- --print` n'imprime que `node_modules/.bin`, à préfixer à `PATH` dans un terminal déjà ouvert — un shell interactif est le seul cas où l'environnement doit porter le pin) |
| `npm run git:retry -- <commande git>` | relance une commande git (`commit`, `push`, `pull`, `rebase`) avec retry sur signature de fork-panic + purge des `node.exe` orphelins (`--sweep`) ; c'est le moteur que le shim machine `git.cmd` branche sur ces quatre sous-commandes |
| `npm run orphans:report` | journal des purges d'`node.exe` **et des fork-panics** : combien de purges (chaîne qualité, garde détaché, chaque `--sweep` du wrapper git), combien ont tué quelque chose, et **combien de fois la panique a réellement frappé une commande git** et laquelle (`--last N`, `--json`) — le dénominateur qui manquait |
| `npm run orphans:doctor` | état machine en une commande, **en lecture seule** (`--fix` : second passage qui applique les remèdes mécaniques qu'il a nommés — lanceurs husky, `core.hooksPath`, entrées du pin dans `node_modules/.bin` — un par un et après confirmation ; `--yes` pour un script) : node.exe vivants (âge, mémoire, script), orphelins de chaîne que le sweep prendrait (avec la commande exacte), chaînes en cours, gardes détachés et ce qu'ils surveillent, node.exe étrangers, chrome/electron restants, **état des hooks** (`core.hooksPath`, lanceur husky présent, hook routé via le moteur de retry), mémoire et journal (`--json`, `--strict` : sortie 2 sur un constat alarmant) |
| `npm run optimize:stamp` | optimise le tampon scolaire (PNG → 38 Ko) |
| `node scripts/rebase-dependabot-prs.mjs` | rebase les PR Dependabot en retard sur `main` (workflow `dependabot-rebase.yml`) — sans le secret `DEPENDABOT_REBASE_TOKEN` il se contente d'avertir |

## Base de données (Supabase)

Les migrations sont dans `supabase/migrations/` (19 migrations ordonnées).
`supabase/FULL_SETUP_MIGRATION.sql` est un **snapshot généré** (concaténation des migrations)
— après toute nouvelle migration : `npm run db:snapshot` ; `npm run db:snapshot:check`
(dans la chaîne lint, donc pré-commit + CI) garantit qu'il ne dérive jamais des migrations.

```bash
npx supabase migrations up   # ou via le dashboard Supabase
npm run seed                 # données de démo (env .env — refusé sans VITE_APP_ENV dev|staging)
```

> **Runners hérités supprimés** : `supabase/run-migrations.mjs` et `supabase/run_migration.mjs`
> (qui appliquaient un schéma d'août périmé) ont été retirés en septembre 2026.
> Les helpers `_update_role.cjs`, `debug-auth.cjs`, `scripts/audit-user-profiles.mjs`
> restants sont des scripts ponctuels d'une époque où le schéma n'était pas
> versionné — certains embarquent des identifiants de production, ne les
> exécutez pas sur la base courante ; l'application du schéma se fait
> exclusivement via le CLI/Dashboard Supabase sur `supabase/migrations/`.

RLS activé sur toutes les tables, politiques par rôle (`admin` / `staff` / `dev` / `general_manager` / `econome`).

## Tests

```bash
npm test                    # toute la suite (~60 s)
node --import tsx --experimental-test-module-mocks --test tests/payments.test.tsx   # une seule suite
```

- Framework : `node:test` natif + `tsx`, rendu DOM via `happy-dom`
- Mocks de module : une suite n'écrit plus le nom de l'option — il **dépend du runtime** (`namedExports` jusqu'à Node 22 ; `exports` à partir de 24.20 / 25.9, où l'ancien nom est déprécié). `tests/module-mock.ts` **sonde** la capacité du Node qui exécute la suite et rend la forme qu'il lit ; une suite écrit `mockModule('node:fs', { … })`. Le nom n'est recopié nulle part (testé), et un cas **vivo** prouve que la forme choisie mocke pour de vrai — sur Node 22, l'autre nom enregistre un mock qui ne remplace rien. Mesuré sur deux runtimes réels : **124/124** et **7/7** verts sur Node 26.8.1 **sans un seul `DeprecationWarning`**, autant sur le Node 22 du pin.
- Garde-fous testés : file offline (replay FIFO), PDF (tampon, i18n), contraste calculé ≥ 4,5:1, focus traps, ARIA, contrats de props (`MainViewsProps`), RLS anon (CI Supabase local)
- Garde-fou des garde-fous : `scripts/check-test-integrity.mjs` refuse une suite qui ne peut pas échouer — `mock.module()`/`mockModule()` que personne ne charge (vérifié contre la fermeture d'imports réelle), mock vide, branche d'OS asserée sans injecter `platform`, suite sautée selon la plateforme, fichier sans assertion. Un saut légitime (le shim `git.cmd` a besoin d'un vrai `cmd.exe`) se **déclare** en commentaire (`// @platform-skip : …`, `// @platform-guard : …`) et le gate l'affiche dans son résumé à chaque run — la couverture manquante reste visible au lieu de compter comme des tests verts.

## Chaîne qualité (pre-commit + CI)

Le hook husky `pre-commit` et le workflow `perf-guard` exécutent la même chaîne :
**lint (0 warning, guards) → tests → audit npm → Lighthouse ≥ 0,60 → audit contraste (6 thèmes × 8 overlays)**.
`deploy.yml` ne déploie que si la porte qualité est verte sur le commit exact.

Et « la même chaîne » se lit au sens strict : le job CI lance **`npm run lint`**, la commande du poste telle quelle, jamais un sous-ensemble recopié. Il exécutait auparavant `npx eslint .` + `npx tsc` + deux gardes et sautait donc en silence stylelint, les sélecteurs CSS, emoji, i18n, les dates Windows, le budget de lignes, les gardes du harnais de tests et le contrôle du snapshot SQL.

Cette fois la règle n'est plus une convention pour le seul job `lint` : **`scripts/check-ci-commands.mjs`** compare **chaque workflow** à `package.json` et refuse toute étape qui **recopie** une commande existante au lieu de l'appeler par son nom. Trois formes, un remède chacune : **recopie exacte** (`node scripts/theme-contrast-audit.mjs` alors que `check:contrast` EST cette commande — non allowlistable), **maillon de chaîne** (un `&&` d'un script, comme `check-node-version.mjs` en tête de `lint:chain` : modifier le script laisserait la CI derrière), **outil piloté à la main** (`npx eslint .` avec ses propres drapeaux — c'est le drapeau qui dérive). Le remède nomme **l'entrée publique** remontée par les liens `--npm` (`npm run lint`, pas `lint:chain`, qui sauterait le runtime épinglé), et chaque exception vit dans une allowlist **motivée** dont une entrée qui ne correspond plus fait échouer le gate. Le dépôt est en 0 recopie : les 4 pas de parité Node sont grandfathered (chaque job doit prouver le majeur dans **son** log), et le contraste est appelé par son nom — c'était la recopie que le premier run a trouvée. Zéro workflow ou zéro commande lue est une **erreur**, pas un vert.

La chaîne `lint` commence par `scripts/check-node-version.mjs` : elle vérifie que le majeur **réellement exécuté** est celui de `.nvmrc` (donc de la CI). Les points d'entrée pinnent ce runtime (`scripts/with-pinned-node.mjs`) et le gate le contrôle — pinner sans vérifier laisserait passer un PATH détourné, et vérifier sans pinner bloquait tout poste sans gestionnaire de version. Un « vert » local sur un autre majeur ne doit plus jamais passer pour une validation — c'est exactement ce qui a bloqué deux déploiements (voir « Version de Node » ci-dessus). Côté CI, l'audit de contraste **ne demande plus aucun secret** : il construit le bundle contre un hôte Supabase factice et répond à toutes ses requêtes depuis un jeu de données figé (`scripts/lib/audit-fixtures.mjs`), grant de mot de passe compris — le formulaire de login est donc rempli pour de vrai, et la session stockée est celle que l'audit a fournie. Le gate tourne donc **à l'identique** sur un push, une PR interne, une PR **Dependabot** ou une PR de fork, avec exactement les mêmes données à chaque run (une couleur ne doit pas changer de verdict parce qu'une ligne a été ajoutée en base). Pour auditer un vrai backend : `AUDIT_FIXTURES=0 AUDIT_EMAIL=… AUDIT_PASSWORD=… npm run check:contrast`. Deux réglages rendent le jeu figé **utilisable** et non seulement présent : toutes ses lignes portent `FIXTURE_ACADEMIC_YEAR`, épinglée sur l'année par défaut de `YearProvider` par un test (une vue filtrée par année vide ses lignes **en silence** quand les deux dérivent — c'est ainsi que « Fiche Élève » est restée non mesurée dans les six thèmes), et l'étape « Fiche Élève » **échoue** désormais si le tableau est vide au lieu d'être déclarée « non applicable ». La règle est générale : comme le jeu de fixtures est figé, chaque surface auditée y a toujours son déclencheur — **sous fixtures, « non applicable » est donc un KO** (déclencheur perdu), pas une variation de données ; sous un vrai backend (`AUDIT_FIXTURES=0`) l'absence de déclencheur reste légitime, mais elle est **imprimée** dans le rapport. Une surface que personne n'a mesurée doit être une ligne, jamais un silence. **Et une surface que le thème ne peint pas en sombre garde sa propre couleur de texte** : le fond **résolu** sous chaque thème sombre est le critère (une surface encore claire n'a pas été repeinte), donc le texte posé dessus doit passer AA 4,5:1 — un futur panneau clair au texte blanc échoue tout seul, sans liste à tenir, et `text-white` (sans nuance chiffrée) est enfin lu par un scanner. La règle est vérifiée sur l'arbre réel **et** sur une fixture injectée qui prouve qu'elle mord.

Une machine ne peut prouver que **son** layout npm — et c'est précisément ce qu'un test qui fabrique une arborescence ne peut pas faire : un arbre inventé valide la liste des candidats, jamais ce que le runner a installé. C'est ainsi que `resolveNpmCliJs` était vert ici et levait sur ubuntu. D'où un job **`node-layouts`** en matrice (`ubuntu-latest` + `windows-latest`, `fail-fast: false`) qui exécute **`npm run check:node-layout`** sur un vrai runner : il résout npm, vérifie que le fichier existe, l'**exécute** (`node npm-cli.js --version` doit rendre une version — un chemin qui existe n'est pas npm), et exige que la résolution tombe sur le npm **de la machine**, dans le layout de sa plateforme. Il ne fait aucun `npm ci` — ce qu'il vérifie est justement l'installation du runner, pas la nôtre — et il sort en rouge avec le chemin trouvé, le chemin attendu et la source quand les deux divergent.

Le hook peut aussi mourir **avant** de tourner : la panique de fork msys frappe le `sh` que git utilise pour lancer un hook (contexte et procédure dans `DEVELOPMENT_HISTORY.md`). `scripts/git-shim.cmd`, installé comme `git.cmd` sur le PATH utilisateur par `node scripts/install-git-shim.mjs`, intercepte nativement `git commit`, `git push`, **`git pull`** et **`git rebase`** et les rejoue via `scripts/git-retry.mjs` : retry **uniquement** sur signature de panique (un conflit, une branche divergée ou un push rejeté ressortent au premier essai avec le code de git), purge des `node.exe` orphelins qui entretiennent la panique, watchdog qui tue l'arbre entier. `pull` et `rebase` sont couverts pour deux raisons cumulées — ils lancent aussi des hooks (`post-merge`, `post-rewrite`, `pre-rebase`) et, étant longs et *stateful*, ce sont eux que la panique interrompt au pire moment : un rejeu coupé en plein vol laisse un état à nettoyer à la main. Git Bash et les outils node qui spawn `git` sans shell ignorent le shim (ils trouvent `git.exe`) : y garder `npm run git:retry -- …`.

**La chaîne purge ses propres orphelins — en lignée, et une mesure a corrigé le modèle.** Le déclencheur documenté de la panique est un `node.exe` orphelin laissé par un timeout dur. Mesuré sur ce poste, ce n'est pas ainsi qu'un arbre node fuit : un enfant node **non détaché** meurt avec son parent — 9 descendants sur 9 disparus en 500 ms après un `taskkill /PID <racine> /F` (sans `/T`), et de même avec `Stop-Process -Force` (comportement Windows documenté de Node : seul `detached: true` laisse un enfant survivre ; libuv l'obtient par un job object). L'orphelin atteignable est donc le **détaché** — sonde réelle : 1 descendant sur 4 survit à la mort de sa racine, et cette purge l'a tué — ou un **wrapper dont le parent non-node est mort**, produit de la panique elle-même : le `sh.exe` qui lance un hook git meurt, le node qu'il a déjà lancé continue et porte alors la chaîne entière. Ce second cas est *périmé par définition* (son pid a disparu depuis longtemps) et reste le travail du filtre par ligne de commande de `scripts/git-retry.mjs`, qui ne matche que ces wrappers. La purge de sortie, elle, est en **lignée** : elle ne tue que ce que cette exécution a créé, identifié par pid **et** horodatage de création — un pid recyclé porte un autre horodatage et est ignoré, donc un `node.exe` étranger (serveur de dev, chaîne d'un autre agent) ne peut pas y passer — et elle tourne sur **tous** les chemins de sortie (fin normale, étape en échec, `SIGINT`/`SIGTERM`). Le garde détaché couvre le seul chemin inatteignable (kill externe) en relevant les descendants **pendant** que la chaîne vit, ce qui authentifie chaque cible. Une purge qui n'a pas pu s'exécuter est comptée comme un **échec**, jamais présentée comme « rien à tuer ». Chaque purge est journalisée, **zéros compris** — sans dénominateur, « à quelle fréquence la panique arrive-t-elle ? » reste une anecdote — Pour voir cet état **avant** d'agir, `npm run orphans:doctor` (lecture seule : il ne tue rien, il nomme la commande qui le ferait). Et le chemin où la panique frappe vraiment — la commande git — est mesuré lui aussi : chaque `--sweep`/`--sweep-all` écrit son compteur (nombre tué, commande git, **avant la 1re tentative ou après une panique**), et chaque fork-panic détecté par le wrapper écrit **la panique elle-même** (commande git, code de sortie, tentative). C'est la seule façon de répondre à « à quelle fréquence ? » : une panique sans `--sweep` ne purge rien, donc compter les purges ne mesure jamais les paniques. `npm run orphans:report` lit ce journal (totaux par origine, paniques par commande git, fenêtre, dernières entrées ; un taux n'est affiché qu'au-delà d'un jour, sinon la fenêtre qui le porte est trop courte pour vouloir dire quelque chose).

**La chaîne ne cherche plus ses outils dans `PATH`.** Chaque étape découpe son script de `package.json` en maillons et les exécute **explicitement** — `node <abs>/node_modules/eslint/bin/eslint.js`, `tsc` par l'entrée déclarée par `typescript`, `vite` par la sienne (`scripts/lib/chain-links.mjs`) — au lieu de `npm run <script>`, qui lance un shell et laisse ce shell résoudre `node`, `eslint`, `tsc` et `stylelint` selon l'**ordre** du `PATH`. L'entrée est **lue** dans le champ `bin` du paquet installé : le chemin explicite et celui qu'npm aurait utilisé sont donc le **même fichier**, et le nom de commande n'est jamais supposé être le nom du paquet (`tsc` est déclaré par `typescript` — une table d'alias serait une seconde définition de ce qu'npm sait déjà). Un maillon non résoluble **échoue** : il n'est jamais rendu au `PATH`, car ce repli réinstallerait une dépendance à la fois, exactement ce que ce module supprime. Trois processus node disparaissent aussi par étape (npm → shell → outil), c'est-à-dire trois `node.exe` de moins sur la table de fork. Le pin écrit dans `node_modules/.bin` reste nécessaire aux **entrées** npm lancées avec un shell (`npm run lint`, `npm test`) et aux shells interactifs ; la chaîne, elle, n'en dépend plus. Le `timeout` du watchdog est désormais **par maillon** : un maillon bloqué est tué (arbre entier) et **nommé**, au lieu d'emporter les treize autres.

**Chaque run termine par la répartition de son temps** : coût par maillon, part du total, écart avec l'exécution précédente (le rapport lit le cache **avant** de l'écrire), et ce que paralléliser les maillons indépendants rapporterait — **chiffré, avec sa contrepartie** : `lint`, `l10n` et `audit-gate` ne font que lire, donc ils sont parallélisables, mais chaque processus concurrent de plus charge la table de fork msys, c'est-à-dire la pression qui fabrique la panique. Les maillons d'hygiène (sweeps chrome/electron, purge de sortie) sont mesurés eux aussi : ce sont des secondes réelles, et un maillon qu'on ne mesure pas est un maillon sur lequel personne ne peut décider.

**Runbook unique : [`docs/FORK_PANIC.md`](docs/FORK_PANIC.md)** — symptômes exacts, **quel mécanisme couvre quoi** (et ce qu'il ne couvre pas), table de décision, récupération manuelle pas à pas, limites connues. `DEVELOPMENT_HISTORY.md` reste la trace datée des mesures ; le runbook décrit l'état actuel.

**Précondition vérifiée, pas supposée** : Windows compose le PATH en [machine puis utilisateur] et `cmd.exe` essaie les extensions dans l'ordre, donc un `git.cmd` ne peut être atteint que si son **dossier précède tout dossier contenant un `git.exe`**. L'installeur fait deux auto-tests et **échoue** (`exit 1`) quand le shim est parasité par un `git.exe` du PATH machine, en nommant le remède : `git --version` répond la même chose dans les deux cas, donc il ne prouve rien. Tant que le dossier du shim n'est pas en tête du PATH **machine** (droits admin), le shim est installé mais jamais exécuté — `npm run git:retry -- <commande>` reste alors le chemin fiable.

## PR Dependabot — jamais de vérifications périmées

GitHub n'a **aucune** option « rebaser automatiquement quand la base change » : le seul rebasage automatique de Dependabot concerne les **conflits**, pas l'obsolescence. Une PR Dependabot dont les checks ont tourné sur un état de `main` qui n'existe plus reste donc verte-sur-du-vide — et la commande `@dependabot rebase` postée par un workflow avec le `GITHUB_TOKEN` est **refusée** depuis 2023 (« only users with push access can use that command »).

`.github/workflows/dependabot-rebase.yml` comble ce trou : à chaque push sur `main` (et une fois par jour, pour les PR ouvertes *après* le dernier push), il liste les PR `dependabot/*` de ce dépôt visant `main`, demande leur avancement, met la branche à jour, et se rabat sur `@dependabot rebase` en cas de conflit — Dependabot sachant régénérer le lockfile, pas nous. Les PR de fork ne sont **jamais** touchées.

**Le token est un PAT, jamais le `GITHUB_TOKEN`** — c'est le point que ce fichier existe pour rendre impossible : une mise à jour faite avec le `GITHUB_TOKEN` ne déclenche **aucun** workflow (son push est invisible pour Actions), donc la branche serait à jour et les vérifications toujours périmées, en vert. Un PAT produit un push d'utilisateur, `synchronize` part, et la chaîne qualité rejoue réellement. Pour l'activer : créer un PAT (fine-grained : *Contents* + *Pull requests* en lecture/écriture ; classic : scope `repo`) et le poser dans **Settings → Secrets and variables → Actions** sous le nom `DEPENDABOT_REBASE_TOKEN` — pas dans « Dependabot secrets », qui ne sert qu'aux workflows déclenchés **par** Dependabot. Sans ce secret le job avertit et sort en 0 ; le mettre à jour est volontairement un geste humain. `tests/dependabot-rebase.test.ts` verrouille l'invariant : le workflow ne référence aucun `GITHUB_TOKEN`, et le script ne le lit jamais.

### Un run vert ne prouve rien — `npm run check:automations`

C'est ce même secret manquant qui a rendu nécessaire le workflow `automation-audit.yml` : `Dependabot rebase` était **vert à chaque push depuis 22 runs sans jamais rien rebaser**, et rien dans la liste des runs ne distinguait ça d'un run qui avait mis trois PR à jour. La règle est écrite une fois (`scripts/lib/automation-evidence.mjs`) : **une automatisation qui ne peut pas agir le DIT**, avec une marque `[inactif]` dans son **journal** — pas dans le titre de l'annotation, que le runner n'y conserve pas (vérifié sur un run réel ; une marque logée dans le titre faisait passer une automatisation morte pour vérifiée). L'audit lit, pour **chaque** workflow, le dernier run **terminé** sur `main` et le journal de ses jobs — vert + aucune marque = a agi. Sont des échecs : une marque `Inactif` (vert sans avoir agi), un journal **illisible** (invérifiable n'est pas un vert), un cron sans run récent (un cron qui ne part pas est en panne), et un audit qui n'a **rien** pu lire (un token sans `actions: read` ressemble à un dépôt propre). Un run **rouge** est signalé sans doubler l'alerte, et un run **en cours** n'est jamais pris pour une dormance. Le job ne demande que `actions: read`, tourne au push et une fois par jour, et **ne bloque aucun déploiement** : c'est un signal, pas une porte.

**Conséquence assumée** : tant que `DEPENDABOT_REBASE_TOKEN` n'est pas posé, ce job est **rouge** — il nomme l'automatisation morte qui était verte depuis 22 runs. En local : `GITHUB_TOKEN=… npm run check:automations` (les journaux de runs ne sont pas publics, donc sans token le script sort en **2** au lieu de rendre un vert qu'il n'a pas mesuré).

## Une seule base de données pour tout le monde

Tous les postes — l'installeur Windows, le site déployé — doivent lire et écrire la **même** base Supabase : un paiement saisi au bureau doit apparaître sur le portable du directeur. Ça n'était vérifié nulle part : la ref `rpcjdohfxwukbqngbprw` était écrite dans 16 endroits dispersés (`vercel.json`, quatre workflows, six scripts, l'historique) et **jamais dans l'application**, tandis que `.env` n'est pas commité (donc c'est ce que la machine de build avait sous la main) et que `.env.staging` nomme un autre projet. Deux installations pouvaient donc viser deux bases, chacune croyant voir les données des autres.

**La base partagée est nommée une fois** : `scripts/lib/shared-project.mjs` (importé par l'application *et* par les contrôles, donc pas deux définitions qui s'accordent aujourd'hui et divergent demain). Elle déclare aussi la **seule** dérive autorisée — staging, avec un jeu de données de test, à condition de déclarer `VITE_APP_ENV=staging` pour ne jamais se présenter comme la production.

**`npm run check:shared-db`** lit deux choses, parce que ce ne sont pas les mêmes vérités : les **fichiers d'environnement** (ce que le prochain build lira — là où une dérive se prépare) et l'**artefact construit** avec `--dist` (ce qui est réellement embarqué dans le JavaScript livré — là où une dérive se prouve). Un `.env` juste et un paquet faux (mode oublié, variable injectée par la plateforme, cache) ne se distinguent que par la lecture du paquet. Le garde-fou tourne dans la chaîne qualité **et** dans `electron:dist` / `electron:release` **avant** l'empaquetage. Un artefact sans aucune URL Supabase est un échec, pas un vert : une application qui ne joint aucune base ne sert personne.

**Le site DÉPLOYÉ est vérifié à part**, parce qu'aucun fichier ne peut le faire : `npm run check:shared-db:live` lit la page réellement servie, suit les modules qu'elle charge — la page n'en nomme qu'un, les autres sont dans le code, dont celui qui porte le client Supabase — et exige la base partagée. C'est la seule lecture qui attrape une variable d'environnement changée dans le tableau de bord de l'hébergeur, qui n'existe nulle part dans ce dépôt. Le workflow `shared-db-watch.yml` l'exécute à chaque push **et une fois par jour** (une bascule de réglage ne produit aucun commit). Mesure du 2026-09-12 : `mama-thera-finance.vercel.app` sert bien `rpcjdohfxwukbqngbprw`, la même base que l'installeur.

**Et l'installation le dit elle-même** : une base illisible ou divergente affiche un badge rouge « Base non partagée » — y compris en production, contrairement aux badges d'environnement. L'état dangereux est celui où chacun voit ses propres données en croyant voir celles des autres ; il ne doit jamais être silencieux.

## Version bureau (Windows)

L'application est aussi empaquetée en **application de bureau Windows** (shell Electron) :

- `electron/main.cjs` charge le **build local** de l'app (`electron-ui-dist/`) — le bureau s'ouvre même si le serveur Vercel est indisponible ; seuls les appels Supabase (login, données, PDF) passent par internet. Fallback : si le build local manque, l'URL hébergée est chargée.
- Sécurité : `contextIsolation` activé, `nodeIntegration` désactivé, sandbox activé ; les liens externes s'ouvrent dans le navigateur système ; les PDF téléchargés passent par une boîte de dialogue d'enregistrement (ou un dossier auto si `ELECTRON_DL_DIR` est défini).
- Icône : emblème officiel « COMPLEXE SCOLAIRE MAMA THERA » (photo fournie, `build/icon.png` 512×512, coins transparents pour l'emblème circulaire — régénérable via `node scripts/generate-app-icon.mjs [image] [size]`).

**Build + installeur :**

```bash
npm run electron:ui      # vite build --base=./ --outDir electron-ui-dist
npm run electron:dist    # electron:ui + empaquetage Windows (NSIS + portable)
# → release/MamaTheraFinance-<version>-setup.exe (installeur)
# → release/MamaTheraFinance-<version>-portable.exe (portable, sans installation)
```

**Vérification E2E du bureau** (login + navigation + téléchargement PDF dans l'app empaquetée) :

```bash
npm run electron:dist    # une fois, pour produire release/
node scripts/verify-desktop-app.mjs
```

**Mises à jour automatiques** (`electron-updater`) : l'app installée (NSIS) vérifie les **GitHub Releases** de ce repo au démarrage et, si une nouvelle version existe, télécharge et installe l'installeur (dialogue « Redémarrer maintenant / Plus tard »). `latest.yml` est généré à côté de l'installeur — il doit être publié dans le même release. Publication :

```bash
npm run electron:release  # electron:ui + electron-builder --win --publish always (GH_TOKEN requis)
```

**Signature de code Windows** : le build signe automatiquement **tous** les artefacts (exe win-unpacked, `elevate.exe`, installeur NSIS + son désinstalleur, portable) dès que les variables standard sont définies : `CSC_LINK` (chemin/URL du `.pfx`) + `CSC_KEY_PASSWORD`. En CI, `.github/workflows/desktop-release.yml` (workflow_dispatch) restaure le certificat depuis les secrets `CSC_PFX_B64` + `CSC_KEY_PASSWORD`, signe et publie le GitHub Release (canal updater). ⚠️ SmartScreen n'est levé qu'avec un certificat d'une autorité de confiance (**OV/EV**) — un certificat auto-signé ne change rien à SmartScreen. Marche à suivre complète (achat, export `.pfx`, secrets CI) : [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).

Le **portable** ne se met pas à jour (pas de répertoire d'installation — désactivé à la détection de `PORTABLE_EXECUTABLE_FILE`). Preuve E2E du mécanisme (feed local, exe empaqueté) :

```bash
node scripts/verify-updater.mjs   # attend release/win-unpacked/MamaTheraFinance.exe
```

**Prérequis** : Windows 10/11 x64, internet pour Supabase. L'installeur installe dans le dossier utilisateur (pas d'administration requise).

## Structure

```
src/
  app/            # hooks métier (usePayments, usePayroll, useStudents…), mainViewsProps.ts
  components/     # vues + modales (AppModals, modales métier, ProductivityPanel…)
  lib/            # supabase client, PDF, offline queue, guards utilitaires
  i18n/           # translations.ts (fr/en)
  index.css       # design system (sections 1-5) + styles d'impression
  themes/         # midnight.css + overrides.css : les remaps !important par thème
supabase/
  migrations/     # 22 migrations SQL (schéma + RLS) ; FULL_SETUP_MIGRATION.sql généré
scripts/          # guards qualité (props, contraste, i18n, any, …) + lib/ partagée
tests/            # 70 suites node:test (788 tests)
```

`src/index.css` garde le design system (sections 1-5) et les styles d'impression ; les surcharges de thème `!important` vivent dans `src/themes/` (`midnight.css`, `overrides.css`), importées **dans cet ordre** juste après le design system — c'est l'ordre qu'elles avaient dans le fichier unique, et les seules règles non-`!important` du bloc battent leurs concurrentes par spécificité, pas par position. Le budget de 700 lignes par fichier ne tolérait `index.css` que le temps de la scission : l'entrée `ALLOWLIST` a été retirée dans le même commit. Les gardes qui lisent ces feuilles (sélecteurs CSS, modèle de contraste des tests) passent par le **corpus** — `src/index.css` plus les couches qu'il importe, résolu par `scripts/lib/theme-css.mjs` — jamais par un chemin en dur : c'est ce qui empêche un garde de devenir vert en ne contrôlant plus rien après un déplacement de règles.
