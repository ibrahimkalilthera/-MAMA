/**
 * `npm run deploy:prod` notice.
 *
 * The Vercel CLI is pinned in `tools/package.json` (its own lockfile) so its
 * transitive pins never live in the root package.json. Production deploys run
 * in GitHub Actions (`.github/workflows/deploy.yml`): they install that pinned
 * CLI and deploy on every push to `main`; Dependabot opens a reviewed PR in
 * `/tools` whenever a new CLI ships. Nothing local to install or run.
 */
console.log('');
console.log('ℹ️  Deploys now run via GitHub Actions, not this command.');
console.log('');
console.log('To deploy production:');
console.log('  1. Commit & push to the `main` branch.');
console.log('  2. Watch the "Deploy (Vercel)" workflow in the repo Actions tab.');
console.log('');
console.log('Required repository secrets (Settings ▸ Secrets ▸ Actions), documented');
console.log('in DEVELOPMENT_HISTORY.md:');
console.log('  • VERCEL_TOKEN      — Vercel access token');
console.log('  • VERCEL_ORG_ID     — team id (team_…)');
console.log('  • VERCEL_PROJECT_ID — project id (prj_…)');
console.log('');
console.log('Optional pre-deploy perf gate still available locally: `npm run check:perf`.');
console.log('');