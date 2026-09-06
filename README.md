# MAMA THERA Finance Suite

Application de gestion financière scolaire (élèves, parents, paiements, dépenses, paie, audit) — React 19 + TypeScript strict + Vite 6 + Tailwind 4, backend Supabase (Auth + RLS), i18n fr/en, 6 thèmes, file d'écriture offline pour le terrain (Bamako).

> Documentation d'historique et d'architecture détaillée : voir `DEVELOPMENT_HISTORY.md`.

## Démarrage rapide

**Prérequis** : Node.js **22** (pinné dans `.nvmrc`).

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
| `npm test` | 496 tests (node:test + tsx, module-mocks expérimental) |
| `npm run lint` | ESLint 0-warning + tsc strict + 6 guards custom (props, `any`, stylelint, CSS, i18n, emoji) |
| `npm run quality` | lint + tests + audit de contraste WCAG 6 thèmes (identique au pre-commit/CI) |
| `npm run check:contrast` | audit de contraste seul |
| `npm run seed` | seed Supabase (dev) ; variantes `:staging`, `:production` |
| `npm run db:snapshot` | régénère `supabase/FULL_SETUP_MIGRATION.sql` depuis les migrations |
| `npm run db:snapshot:check` | CI : échoue si le snapshot SQL a dérivé des migrations |
| `npm run db:profiles:export` | exporte `user_profiles` (rôles) via la service key → JSON |
| `npm run db:profiles:restore -- --file F.json` | restaure les rôles après migration sur base vide (confirmation interactive) |
| `npm run optimize:stamp` | optimise le tampon scolaire (PNG → 38 Ko) |

## Base de données (Supabase)

Les migrations sont dans `supabase/migrations/` (18 migrations ordonnées).
`supabase/FULL_SETUP_MIGRATION.sql` est un **snapshot généré** (concaténation des migrations)
— après toute nouvelle migration : `npm run db:snapshot` ; `npm run db:snapshot:check`
en CI garantit qu'il ne dérive jamais des migrations.

```bash
npx supabase migrations up   # ou via le dashboard Supabase
npm run seed                 # données de démo (env .env)
```

> **Runners hérités** : `supabase/run-migrations.mjs` / `run_migration.mjs` (et
> les helpers `_update_role.cjs`, `debug-auth.cjs`, `scripts/audit-user-profiles.mjs`)
> sont des scripts ponctuels d'une époque où le schéma n'était pas versionné.
> Ils ne couvrent qu'une partie des migrations et certains embarquent des
> identifiants de production — ne les exécutez pas sur la base courante ;
> l'application du schéma se fait exclusivement via le CLI/Dashboard Supabase
> sur `supabase/migrations/`.

RLS activé sur toutes les tables, politiques par rôle (`admin` / `staff` / `dev` / `general_manager` / `econome`).

## Tests

```bash
npm test                    # toute la suite (~60 s)
node --import tsx --experimental-test-module-mocks --test tests/payments.test.tsx   # une seule suite
```

- Framework : `node:test` natif + `tsx`, rendu DOM via `happy-dom`
- Garde-fous testés : file offline (replay FIFO), PDF (tampon, i18n), contraste calculé ≥ 4,5:1, focus traps, ARIA, contrats de props (`MainViewsProps`, 201 props)

## Chaîne qualité (pre-commit + CI)

Le hook husky `pre-commit` et le workflow `perf-guard` exécutent la même chaîne :
**lint (0 warning, guards) → tests → audit npm → Lighthouse ≥ 0,60 → audit contraste réel (6 thèmes × 8 overlays)**.
`deploy.yml` ne déploie que si la porte qualité est verte sur le commit exact.

## Structure

```
src/
  app/            # hooks métier (usePayments, usePayroll, useStudents…), mainViewsProps.ts
  components/     # vues + modales (AppModals, modales métier, ProductivityPanel…)
  lib/            # supabase client, PDF, offline queue, guards utilitaires
  i18n/           # translations.ts (fr/en)
supabase/
  migrations/     # 18 migrations SQL (schéma + RLS) ; FULL_SETUP_MIGRATION.sql généré
scripts/          # guards qualité (props, contraste, i18n, any, …)
tests/            # 73 suites node:test (496 tests)
```
