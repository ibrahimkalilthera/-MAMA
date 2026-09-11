#!/usr/bin/env node
/**
 * Purge report — how often does this machine actually leave node.exe orphans
 * behind, and when?
 *
 * The msys fork panic has always been described anecdotally ("an orphaned
 * node.exe left by a hard timeout"), which makes it impossible to tell a fixed
 * problem from a quieter week. Every purge — INCLUDING the ones that kill
 * nothing — is therefore recorded by the quality chain and its detached guard
 * (scripts/lib/orphan-node.mjs), and this reads that log.
 *
 * Zeros are the point: a log with only the hits has no denominator.
 *
 * Usage: node scripts/sweep-report.mjs [--last N] [--json]   (npm run orphans:report)
 */
import { readSweepLog, SWEEP_LOG_REL, sweepLogPath } from './lib/orphan-node.mjs';

const args = process.argv.slice(2);
const lastIdx = args.indexOf('--last');
const last = lastIdx >= 0 ? Math.max(1, parseInt(args[lastIdx + 1] ?? '10', 10) || 10) : 10;

const entries = readSweepLog();

if (args.includes('--json')) {
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

if (entries.length === 0) {
  console.log(`🧹 Aucune purge enregistrée (${SWEEP_LOG_REL}).`);
  console.log("   La chaîne qualité écrit une ligne à CHAQUE sortie — même quand elle");
  console.log('   ne purge rien — sans quoi la fréquence réelle du fork-panic reste');
  console.log('   une anecdote. Lancez `npm run quality` (ou committez) une fois.');
  process.exit(0);
}

const killedOf = (e) => Number(e.killed) || 0;
const total = entries.reduce((n, e) => n + killedOf(e), 0);
const nonEmpty = entries.filter((e) => killedOf(e) > 0);

const byOrigin = new Map();
for (const e of entries) {
  const key = String(e.origin ?? '?');
  const seen = byOrigin.get(key) ?? { count: 0, killed: 0 };
  seen.count += 1;
  seen.killed += killedOf(e);
  byOrigin.set(key, seen);
}

const firstAt = Date.parse(String(entries[0].at));
const lastAt = Date.parse(String(entries[entries.length - 1].at));
const spanMs = Number.isFinite(firstAt) && Number.isFinite(lastAt) ? lastAt - firstAt : 0;

console.log(
  `🧹 ${entries.length} purge(s) enregistrée(s) — ${nonEmpty.length} avec des orphelins, ${total} node.exe tués.`,
);
if (spanMs > 0) {
  const days = spanMs / 86400000;
  // A rate needs a denominator worth dividing by. A single non-empty purge in
  // a window of 52 minutes reads as "27.61/jour" — invented precision, and the
  // exact kind of confident number this log exists to replace. Below a day the
  // window is printed alone.
  const window = days >= 1 ? `${days.toFixed(1)} jour(s)` : `${(spanMs / 3600000).toFixed(1)} h`;
  const rate =
    days >= 1
      ? ` — ${(nonEmpty.length / days).toFixed(2)} purge(s) non vide(s)/jour`
      : ' — fenêtre trop courte pour un taux (il grandit avec les runs)';
  console.log(`   fenêtre : ${window}${rate}`);
}
console.log('   par origine :');
for (const [origin, seen] of [...byOrigin].sort((a, b) => b[1].killed - a[1].killed)) {
  console.log(`     ${origin} — ${seen.count} purge(s), ${seen.killed} tué(s)`);
}
console.log(`   dernières (${Math.min(last, entries.length)}) :`);
for (const e of entries.slice(-last)) {
  console.log(`     ${e.at} | ${e.origin ?? '?'} | ${killedOf(e)} tué(s) | ${e.passes ?? '?'} passe(s)`);
}
console.log(`\n   journal : ${sweepLogPath()}`);
