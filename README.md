# MAMA THERA Finance Suite

Application de gestion financière scolaire (élèves, parents, paiements, dépenses, paie, audit) — React 19 + TypeScript strict + Vite 6 + Tailwind 4, backend Supabase (Auth + RLS), i18n fr/en, 6 thèmes, file d'écriture offline pour le terrain (Bamako).

> Documentation d'historique et d'architecture détaillée : voir `DEVELOPMENT_HISTORY.md`.

## Démarrage rapide

**Prérequis** : Node.js **22** (pinné dans `.nvmrc`) — **aucun gestionnaire de version à installer**. Le projet provisionne lui-même le runtime qu'il épingle : `npm run setup:node` (aussi lancé en douceur par `npm install`), et les points d'entrée qui comptent — hooks git, `npm run lint`, `npm run quality` — passent par `scripts/with-pinned-node.mjs`, qui bascule sur ce runtime et l'injecte dans leur PATH. Sur une machine déjà en 22 (comme la CI), la bascule est un no-op : rien à télécharger. Pour un **terminal** sur ce runtime : `npm run shell` (ou, dans un terminal déjà ouvert, `export PATH="$(npm run --silent shell -- --print):$PATH"`).

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
| `npm test` | 525 tests (node:test + tsx, module-mocks expérimental) |
| `npm run lint` | **parité de version Node** (`.nvmrc` ↔ poste) + ESLint 0-warning + tsc strict + 7 guards custom (props, `any`, stylelint, CSS, i18n, emoji, snapshot SQL) |
| `npm run quality` | lint + tests + audit de contraste WCAG 6 thèmes (identique au pre-commit/CI) |
| `npm run check:contrast` | audit de contraste seul (backend fixtures, aucun secret ; `AUDIT_FIXTURES=0` + `AUDIT_EMAIL`/`AUDIT_PASSWORD` pour un vrai backend) |
| `npm run seed` | seed de DÉMO (dev/staging uniquement — garde : refuse la prod sans `VITE_APP_ENV=dev\|staging`, et `--clean` refuse le projet de production) ; `:staging` ; `seed:production` = script structurel |
| `npm run db:snapshot` | régénère `supabase/FULL_SETUP_MIGRATION.sql` depuis les migrations |
| `npm run db:snapshot:check` | CI : échoue si le snapshot SQL a dérivé des migrations |
| `npm run db:profiles:export` | exporte `user_profiles` (rôles) via la service key → JSON |
| `npm run db:profiles:restore -- --file F.json` | restaure les rôles après migration sur base vide (confirmation interactive) |
| `npm run shell` | terminal où `node`/`npm`/`npx` sont le runtime épinglé (`-- --print` n'imprime que le dossier de shim, à préfixer à `PATH`) |
| `npm run optimize:stamp` | optimise le tampon scolaire (PNG → 38 Ko) |

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
- Garde-fous testés : file offline (replay FIFO), PDF (tampon, i18n), contraste calculé ≥ 4,5:1, focus traps, ARIA, contrats de props (`MainViewsProps`), RLS anon (CI Supabase local)

## Chaîne qualité (pre-commit + CI)

Le hook husky `pre-commit` et le workflow `perf-guard` exécutent la même chaîne :
**lint (0 warning, guards) → tests → audit npm → Lighthouse ≥ 0,60 → audit contraste (6 thèmes × 8 overlays)**.
`deploy.yml` ne déploie que si la porte qualité est verte sur le commit exact.

Et « la même chaîne » se lit au sens strict : le job CI lance **`npm run lint`**, la commande du poste telle quelle, jamais un sous-ensemble recopié. Il exécutait auparavant `npx eslint .` + `npx tsc` + deux gardes et sautait donc en silence stylelint, les sélecteurs CSS, emoji, i18n, les dates Windows, le budget de lignes, les gardes du harnais de tests et le contrôle du snapshot SQL — et un test échoue désormais si l'un de ces sous-ensembles réapparaît dans le workflow.

La chaîne `lint` commence par `scripts/check-node-version.mjs` : elle vérifie que le majeur **réellement exécuté** est celui de `.nvmrc` (donc de la CI). Les points d'entrée pinnent ce runtime (`scripts/with-pinned-node.mjs`) et le gate le contrôle — pinner sans vérifier laisserait passer un PATH détourné, et vérifier sans pinner bloquait tout poste sans gestionnaire de version. Un « vert » local sur un autre majeur ne doit plus jamais passer pour une validation — c'est exactement ce qui a bloqué deux déploiements (voir « Version de Node » ci-dessus). Côté CI, l'audit de contraste **ne demande plus aucun secret** : il construit le bundle contre un hôte Supabase factice et répond à toutes ses requêtes depuis un jeu de données figé (`scripts/lib/audit-fixtures.mjs`), grant de mot de passe compris — le formulaire de login est donc rempli pour de vrai, et la session stockée est celle que l'audit a fournie. Le gate tourne donc **à l'identique** sur un push, une PR interne, une PR **Dependabot** ou une PR de fork, avec exactement les mêmes données à chaque run (une couleur ne doit pas changer de verdict parce qu'une ligne a été ajoutée en base). Pour auditer un vrai backend : `AUDIT_FIXTURES=0 AUDIT_EMAIL=… AUDIT_PASSWORD=… npm run check:contrast`.

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
supabase/
  migrations/     # 19 migrations SQL (schéma + RLS) ; FULL_SETUP_MIGRATION.sql généré
scripts/          # guards qualité (props, contraste, i18n, any, …)
tests/            # 82 suites node:test (525 tests)
```
