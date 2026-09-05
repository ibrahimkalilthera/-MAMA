# RecruiterFlow-AI / MAMA Finance Suite – AGENTS.md

## Scope

- These instructions apply to the entire repository and all subdirectories.

## Dev environment

- Use Node.js with `npm` at the repo root.
- Install dependencies with `npm install`.
- Run the app locally with `npm run dev`.
- Prefer fast search tools (e.g. `rg`) when scanning the codebase.
- **msys/Git-Bash fork failure (this machine)** — `bash: fork: retry: Resource temporarily
  unavailable` / `dofork … died unexpectedly, exit code 0xC0000142` means Windows system-wide
  Mandatory ASLR is breaking Git-for-Windows fork/exec, NOT orphan node processes or Defender.
  Fix: disable `ForceRelocateImages` per-program for every exe under `C:\Program Files\Git`
  (`Set-ProcessMitigation -Name <exe> -Disable @('ForceRelocateImages')`); reapply to any new
  exe a Git update adds. Error text misleads: msys-linked binaries dying with silent 127 mean
  only `bash.exe` is covered so far.

## Git safety & consent (required)

- Do not create/delete branches or worktrees unless the user explicitly asks, or the user explicitly approves after you propose it.
- Do not use `git stash` (push/apply/pop/drop/clear) unless the user explicitly asks, or the user explicitly approves after you propose it.
- Do not “revert to a previous version” (e.g., `git reset`, `git revert`, `git checkout <ref>`, `git restore`) unless the user explicitly asks, or the user explicitly approves after you propose it.
- Do not run destructive or history-altering git operations without the user’s explicit approval, including (non-exhaustive):
  - `git reset --hard`, `git clean -fd`, `git checkout -- .`, `git restore --source`, `git revert`, `git rebase`, `git push --force`
  - `git stash pop`, `git stash drop`, `git stash clear`
- If the workspace is messy or recovery is needed, propose a safe plan first (e.g., snapshot commit on the current branch, or a separate worktree) and wait for explicit approval before executing any operation that could discard or hide work.

## Testing & build

- Before considering a change “ready”, run from repo root:
  - `npm run lint` (if available)
  - `npm run typecheck` or `npx tsc --noEmit`
  - `npm run build`
- Do not add new global build/test tooling; reuse the existing scripts in `package.json`.
- Keep changes scoped and incremental so that build failures are easy to trace back to a small set of edits.

## Deployment topology (user-stated, not in repo)

- **Frontend: Vercel.** `vercel.json` (framework vite, output `dist`) + the
  `Deploy (Vercel)` workflow (`.github/workflows/deploy.yml`) deploy only after the
  quality gate passes; production env vars (`VITE_SUPABASE_URL`, keys) live in the
  Vercel dashboard, not the repo.
- **Backend: fly.io** (user statement). The repo itself contains NO server code and
  NO `fly.toml` — everything talks to Supabase via `VITE_SUPABASE_URL` + anon key,
  so "backend on fly.io" means the Supabase stack (DB/PostgREST/auth) is
  self-hosted there rather than on `*.supabase.co`. Any future fly work
  (deploys, CORS, migrations, service-role scripts) happens outside this repo's
  files unless the user says otherwise.

## Supabase / database work

- Treat Supabase as the source of truth for persistent data and schema.
- **Schema evolution actually happens via ordered files in `supabase/migrations/`**
  (`YYYYMMDDHHMMSS_*.sql`), not `supabase db push`.
  `supabase/FULL_SETUP_MIGRATION.sql` is GENERATED: never hand-edit it — add a migration, then
  run `npm run db:snapshot`; `npm run db:snapshot:check` is the drift gate (safe in CI).
- **`useSupabaseData` fetches only under a session**: the initial load awaits
  `supabase.auth.getSession()` and refires on `SIGNED_IN`; `SIGNED_OUT` clears the domain
  state. Never reintroduce an unconditional mount `fetchAll()` (anon reads on the login
  screen) — regression-locked by `tests/data-auth-gate.test.tsx`.
- Never hardcode secrets (tokens, PATs, keys) into code or into this file; rely on runtime environment configuration (`.env`).
  The legacy `supabase/run-*.mjs` + debug helpers that embedded production credentials were
  removed — schema is applied via the Supabase CLI/dashboard only.
- Local `.env` should hold, at minimum, the repo’s Supabase access keys:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Code & style

- Keep changes minimal and consistent with the existing TypeScript/React style in this repo.
- Prefer fixing issues at the root cause instead of adding one‑off hacks.
- Avoid drive‑by refactors that are unrelated to the current task.
- When updating existing flows, preserve current behaviour by default and gate new behaviour behind configuration or clear conditions when risk is high.
- File size discipline: Avoid expanding "god files" where possible, split logically when appropriate.
- **App.tsx is now a wiring hub under budget**: the root shell JSX lives in
  `src/components/AppShell.tsx`. Its props = `MainViewsProps & AppModalsProps`
  (spread of the `viewsProps` literal, still owned by App.tsx) + `AppShellExtras`
  for shell-only values. New shell-level JSX goes into AppShell, new state/hooks
  stay in App.tsx, and the wiring guard
  (`scripts/check-component-props.mjs`) resolves the `viewsProps` spread from
  the `literal` file each component entry names.
- **Domain types live once in `src/lib/domainTypes.ts`** (Language, User, Parent,
  Student, Staff, …, SchoolClass, DEFAULT_SCHOOL_CLASSES). `src/app/types.ts` and
  `src/lib/useSupabaseData.ts` only re-export from it — never re-declare an interface.
- **Data layer = `useSupabaseData.ts` (the hook only) + helpers**: row→type mappers +
  `createTempId` in `src/lib/rowMappers.ts`; the Excel Smart Ingestion logic is the pure
  `importBatchData(category, records, options, deps)` in `src/lib/batchImport.ts`.
- **Hooks surface user errors via a `toastError(msg)` dep** (App wires `toast.error`);
  native `alert()` is gone from business hooks. Business hooks also receive `showToast()`
  for success feedback.
- **`xlsx` is a pinned CDN tarball** (npm-registry 0.18.5 is CVE-ridden). The pin is
  enforced by `scripts/check-sheetjs-pin.mjs` (package.json + lockfile) wired into lint —
  bump the tarball + constant + lockfile together.
- **AppModals overlays are config-driven**: ONE ordered `overlays` registry (in
  `src/components/AppModals.tsx`) — list order = JSX order = focus-trap slot = Escape priority;
  no numbered `overlayRoots.current[N]` literals anymore. Adding/removing an overlay only edits
  the list. Keep extracted modals presentational: AppModals owns `<AnimatePresence>` + the open
  condition; the modal root receives `overlayRef` + `onClose`.
- **ModalShell is the shared dialog chrome** — every modal (coordinated AND
  self-managed) renders through `src/components/ModalShell.tsx`: overlay root + backdrop +
  panel + header. Self-managed modals (StudentForm/AddClass/EditClass/ConfirmDialog,
  AddUser, MonthlyPayrollDraft, ExcelImport) keep their own focus trap + escape and forward
  their `rootRef` through the shell's `overlayRef` callback. Non-accent chrome (light headers,
  banners, alert rows, dark bars with controls) goes through the `header` override prop,
  never by re-scaffolding. Widths via `maxWidth` (incl. `max-w-sm`/`max-w-3xl`/`max-w-5xl`),
  radii via `panelRadius` — do not append conflicting Tailwind classes via `panelClassName`.
  Modals take `currentTheme: CurrentTheme`, never flattened `theme*` props — no exceptions.
- **Modal surface fills live in `src/lib/modalTokens.ts`** — never hardcode a light fill
  (`bg-*-50/100/200`) in a modal's JSX: reference a token instead. Every token carries its
  `dark:` counterpart in the same string (structural pairing, policed by
  `tests/modal-tokens.test.ts`); paper surfaces repeat the same fill as `dark:` ON PURPOSE
  (white paper in every theme). That is why the midnight-lock exemption list
  (`tests/theme-contrast-remap.test.ts`) no longer contains modal entries — keep it that way.
