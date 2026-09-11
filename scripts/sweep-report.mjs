#!/usr/bin/env node
/**
 * Purge & panic report — how often does this machine actually leave node.exe
 * orphans behind, and how often does the msys fork panic hit a git command?
 *
 * The panic has always been described anecdotally ("an orphaned node.exe left
 * by a hard timeout"), which makes it impossible to tell a fixed problem from a
 * quieter week. Two producers write the journal, and both write ZEROS — a log
 * of hits only has no denominator:
 *   - scripts/lib/orphan-node.mjs  → the quality chain's own exit purge and the
 *     detached guard's post-mortem purge (`exit`, `guard` / `signal:*`);
 *   - scripts/git-retry.mjs        → every `--sweep` / `--sweep-all` pass
 *     (`git-retry:sweep*`, with the git subcommand and whether it ran before
 *     the first attempt or after a panic), plus the PANIC itself
 *     (`git-retry:panic`) — the one number the purge counter alone can never
 *     give, since a panic without `--sweep` purges nothing.
 *
 * Usage: node scripts/sweep-report.mjs [--last N] [--json]   (npm run orphans:report)
 */
import { readSweepLog, summarizeSweepLog, SWEEP_LOG_REL, sweepLogPath } from './lib/orphan-node.mjs';

const args = process.argv.slice(2);
const lastIdx = args.indexOf('--last');
const last = lastIdx >= 0 ? Math.max(1, parseInt(args[lastIdx + 1] ?? '10', 10) || 10) : 10;

const entries = readSweepLog();
const summary = summarizeSweepLog(entries);

if (args.includes('--json')) {
  console.log(JSON.stringify({ ...summary, entries: entries.slice(-last) }, null, 2));
  process.exit(0);
}

if (entries.length === 0) {
  console.log(`🧹 Aucune purge enregistrée (${SWEEP_LOG_REL}).`);
  console.log('   La chaîne qualité écrit une ligne à CHAQUE sortie — même quand elle');
  console.log('   ne purge rien — et le wrapper git à chaque `--sweep` et chaque');
  console.log('   fork-panic : sans les zéros, la fréquence réelle reste une anecdote.');
  console.log('   Lancez `npm run quality` (ou committez) une fois.');
  process.exit(0);
}

/**
 * A rate needs a denominator worth dividing by. A single event in a window of
 * 52 minutes reads as "27.61/jour" — invented precision, and the exact kind of
 * confident number this journal exists to replace. Below a day, the window is
 * printed alone.
 */
function rateText(spanMs, count) {
  if (!(spanMs > 0)) return '';
  const days = spanMs / 86400000;
  if (days < 1) return '';
  return ` — ${(count / days).toFixed(2)}/jour`;
}

function windowText(spanMs) {
  if (!(spanMs > 0)) return '';
  const days = spanMs / 86400000;
  return days >= 1 ? `${days.toFixed(1)} jour(s)` : `${(spanMs / 3600000).toFixed(1)} h`;
}

const { purges, panics } = summary;

console.log(
  `🧹 ${purges.count} purge(s) enregistrée(s) — ${purges.nonEmpty} avec des orphelins, ${purges.killed} node.exe tués` +
    (purges.failed > 0 ? `, ${purges.failed} impossible(s) à exécuter` : '') +
    '.',
);
if (summary.spanMs > 0) {
  console.log(
    `   fenêtre : ${windowText(summary.spanMs)}${rateText(summary.spanMs, purges.nonEmpty)} (purges non vides)`,
  );
}
console.log('   par origine :');
for (const origin of purges.byOrigin) {
  console.log(`     ${origin.key} — ${origin.count} purge(s), ${origin.killed} tué(s)`);
}

if (panics.count > 0) {
  console.log(
    `⚠️  ${panics.count} fork-panic msys observée(s) par le wrapper git${rateText(summary.spanMs, panics.count)}.`,
  );
  console.log('   par commande git :');
  for (const cmd of panics.byGitCommand) {
    console.log(`     git ${cmd.key} — ${cmd.count}`);
  }
} else {
  console.log('⚠️  Aucun fork-panic journalisé (le wrapper n’écrit une ligne qu’en cas de panique détectée).');
}

console.log(`   dernières (${Math.min(last, entries.length)}) :`);
for (const entry of entries.slice(-last)) {
  const kind = entry.kind === 'panic' ? 'PANIC' : 'purge';
  const killed = Number(entry.killed) || 0;
  const detail =
    entry.kind === 'panic'
      ? `exit ${entry.exitCode ?? '?'} — git ${entry.git || '?'}`
      : [
          `${killed} tué(s)`,
          entry.passes == null ? null : `${entry.passes} passe(s)`,
          entry.failed ? 'ÉCHEC' : null,
          entry.git ? `git ${entry.git}/${entry.phase ?? '?'}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
  console.log(`     ${entry.at} | ${kind} | ${entry.origin ?? '?'} | ${detail}`);
}
console.log(`\n   journal : ${sweepLogPath()}`);
