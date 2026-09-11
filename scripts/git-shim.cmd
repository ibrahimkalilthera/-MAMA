@echo off
rem ─────────────────────────────────────────────────────────────────────────────
rem scripts/git-shim.cmd - native git proxy against the msys fork panic.
rem
rem Installed on the USER PATH (as git.cmd) by scripts/install-git-shim.mjs.
rem Runs natively (cmd.exe -> node.exe -> CreateProcess, never an msys fork),
rem so it stays alive exactly when the panic is active. It routes `git commit`,
rem `git push`, `git pull` and `git rebase` through the retry wrapper of the
rem CURRENT repo (scripts/git-retry.mjs --sweep): attempt 1 dies if the hook's
rem sh is hit by the panic (or mid-flight, for the stateful commands), the
rem sweep kills the orphaned node.exe that keeps the panic alive, attempt 2
rem succeeds. Every other git command is forwarded untouched to the real
rem git.exe.
rem
rem Safe to install: node-based tools that spawn("git") without a shell skip
rem .cmd files (CreateProcess finds git.exe), so they are unaffected. Git Bash
rem also resolves git.exe directly and ignores this file; from Git Bash keep
rem using `node scripts/git-retry.mjs ...` (see DEVELOPMENT_HISTORY.md).
rem ─────────────────────────────────────────────────────────────────────────────
setlocal EnableDelayedExpansion

rem Resolve the REAL git.exe - `where git.exe` skips .cmd files, so this can
rem never resolve to this shim; the guard also skips a git.exe living in the
rem shim's own directory.
set "REAL_GIT="
for /f "delims=" %%i in ('where git.exe 2^>nul') do (
  if not defined REAL_GIT (
    if /i not "%%~dpi"=="%~dp0" set "REAL_GIT=%%i"
  )
)
if not defined REAL_GIT (
  echo [git-shim] git.exe introuvable sur le PATH. 1>&2
  exit /b 1
)

rem Detect the subcommand: first non-option token, skipping the value of
rem -C / --git-dir / --work-tree.
set "SUB="
set "SKIP=0"
for %%a in (%*) do (
  if not defined SUB (
    if "!SKIP!"=="1" (
      set "SKIP=0"
    ) else (
      set "ARG=%%~a"
      if "!ARG:~0,1!"=="-" (
        if /i "!ARG!"=="-C" set "SKIP=1"
        if /i "!ARG!"=="--git-dir" set "SKIP=1"
        if /i "!ARG!"=="--work-tree" set "SKIP=1"
      ) else (
        set "SUB=!ARG!"
      )
    )
  )
)

rem Four subcommands need the retry wrapper, for two distinct reasons:
rem   - commit / push run a husky hook (the sh wrapper that dies of the fork
rem     bug before node even starts);
rem   - pull / rebase too (post-merge, post-rewrite, pre-rebase hooks), and
rem     they are also the two commands most likely to be running when the
rem     panic hits — a fetch or a replay is long, and an abort mid-flight
rem     leaves the user to clean the work up by hand.
rem Everything else goes straight to the real git.
if /i "!SUB!"=="commit" goto :retry
if /i "!SUB!"=="push" goto :retry
if /i "!SUB!"=="pull" goto :retry
if /i "!SUB!"=="rebase" goto :retry
"%REAL_GIT%" %*
exit /b %errorlevel%

:retry
rem Route through the CURRENT repo's wrapper when it exists; otherwise just
rem forward (other repos are unaffected by this shim). Only signatures of the
rem fork panic are retried — a real git failure (conflict, diverged branch,
rem rejected push) exits immediately with git's own code.
for /f "delims=" %%r in ('"%REAL_GIT%" rev-parse --show-toplevel 2^>nul') do set "ROOT=%%r"
where node >nul 2>&1 || goto :plain
if defined ROOT if exist "%ROOT%\scripts\git-retry.mjs" (
  set "GIT_RETRY_REAL_GIT=!REAL_GIT!"
  node "%ROOT%\scripts\git-retry.mjs" --sweep --timeout-ms 1500000 %*
  exit /b !errorlevel!
)
:plain
"%REAL_GIT%" %*
exit /b %errorlevel%