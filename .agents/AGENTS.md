# RecruiterFlow-AI / MAMA Finance Suite – AGENTS.md

## Scope

- These instructions apply to the entire repository and all subdirectories.

## Dev environment

- Use Node.js with `npm` at the repo root.
- Install dependencies with `npm install`.
- Run the app locally with `npm run dev`.
- Prefer fast search tools (e.g. `rg`) when scanning the codebase.

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

## Supabase / database work

- Treat Supabase as the source of truth for persistent data and schema.
- For schema changes or ad‑hoc SQL, use the Supabase CLI (`npx supabase db push`) or Supabase REST API endpoints rather than editing SQL files without applying them.
- Never hardcode secrets (tokens, PATs, keys) into code or into this file; rely on runtime environment configuration (`.env`).
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
