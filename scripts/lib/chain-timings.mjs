// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/chain-timings.mjs — how long each link of the quality chain took,
// what it costs RELATIVELY, and what parallelising would actually buy.
//
// WHY THIS EXISTS
// ---------------
// The chain already printed each step's duration (`— tests: OK en 33757ms`), but
// a list you have to add up mentally answers none of the questions that matter:
// which link dominates, whether this run got slower than the last one, and
// whether the independence between links is worth a rewrite. So: a summary that
// states shares, a comparison against the previous run, and a parallelism
// figure — computed, not estimated.
//
// THE HONEST PART ABOUT PARALLELISM
// ---------------------------------
// Three links (`lint`, `l10n`, `audit-gate`) only READ the working tree, so they
// are independent and could run at once — `parallelPlan` computes the wall clock
// that would save (`total − sum(group) + max(group)`). But the machine this runs
// on pays for concurrency in a currency the panic cares about: every extra
// concurrent node process loads the msys fork table, which is exactly the
// pressure behind the fork panic (see docs/FORK_PANIC.md). The report therefore
// prints the gain AND what it costs — a saving measured in seconds is not free
// if it makes the next `git commit` panic. The gain is only taken when it
// exceeds that risk, and it says so instead of recommending blindly.
//
// Pure: entries in, lines out (the previous run is injected). The chain passes
// its own measured steps; the file cache is best-effort I/O at the edge.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the last runs are kept, under the already-ignored cache. */
export const TIMINGS_REL = 'node_modules/.cache/chain-timings.json';

/** Runs kept for comparison; enough to see a regression without growing. */
const KEPT_RUNS = 20;
/** A link must save at least this much to be worth concurrency. */
export const PARALLEL_FLOOR_MS = 4000;

/**
 * Below this, a delta is measurement noise, not a regression. Measured on a real
 * run: `+711 ms` on a 46 s link and `+6 ms` on a 436 ms link both got flagged —
 * and a warning that fires on noise is a warning nobody reads any more. The
 * first version of this report did exactly that.
 */
export const REGRESSION_FLOOR_MS = 1000;

/**
 * The links that only read the working tree. Declared here as data, with the
 * reason, so the report cannot claim an independence the code does not have:
 *   - `lint` (eslint/tsc/stylelint/guards/snapshot check) reads;
 *   - `l10n` reads;
 *   - `audit-gate` reads package-lock.json and the registry — network-bound;
 * `test` and `build` are NOT here: they spawn hundreds of processes (the panic's
 * own pressure) and `build` writes `dist/`.
 */
export const INDEPENDENT_READ_ONLY = ['lint', 'l10n', 'audit-gate'];

/**
 * Absolute path of the timing cache. */
export function timingsPath(root = process.cwd()) {
  return join(root, TIMINGS_REL);
}

/**
 * Rows sorted by cost, with each link's share of the total.
 * @param {{ name: string, ms?: number, ok?: boolean }[]} entries
 * @param {{ previous?: { name: string, ms?: number }[] }} [options]
 */
export function summarizeTimings(entries = [], { previous = [] } = {}) {
  const rows = (entries ?? [])
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({ name: e.name, ms: Math.max(0, Number(e.ms) || 0), ok: e.ok !== false }));
  const totalMs = rows.reduce((n, r) => n + r.ms, 0);
  const beforeOf = new Map((previous ?? []).map((p) => [p?.name, Number(p?.ms) || 0]));

  const shaped = rows
    .map((r) => ({
      ...r,
      share: totalMs > 0 ? r.ms / totalMs : 0,
      deltaMs: beforeOf.has(r.name) ? r.ms - beforeOf.get(r.name) : null,
      regression: beforeOf.has(r.name) ? r.ms - beforeOf.get(r.name) >= REGRESSION_FLOOR_MS : false,
    }))
    .sort((a, b) => b.ms - a.ms);
  return { rows: shaped, totalMs, hasPrevious: beforeOf.size > 0 };
}

/**
 * What running the independent links at the same time would save, and what the
 * longest link (a floor: it cannot be parallelised away) costs on its own.
 * @param {{ name: string, ms: number }[]} rows
 * @param {{ independent?: string[] }} [options]
 */
export function parallelPlan(rows = [], { independent = INDEPENDENT_READ_ONLY } = {}) {
  const group = (rows ?? []).filter((r) => independent.includes(r.name));
  if (group.length < 2) {
    return { group: [], savedMs: 0, sequentialMs: 0, parallelMs: 0, worthwhile: false };
  }
  const sequential = group.reduce((n, r) => n + r.ms, 0);
  const parallelMs = Math.max(...group.map((r) => r.ms));
  const savedMs = sequential - parallelMs;
  return {
    group: group.map((r) => r.name),
    sequentialMs: sequential,
    parallelMs,
    savedMs,
    worthwhile: savedMs >= PARALLEL_FLOOR_MS,
  };
}

/** Human duration: milliseconds below a second, seconds with one decimal above. */
export function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const minutes = Math.floor(n / 60_000);
  return `${minutes} min ${Math.round((n % 60_000) / 1000)} s`;
}

/** Signed delta, so a regression is visible without comparing numbers. */
export function formatDelta(deltaMs) {
  if (deltaMs === null || deltaMs === undefined) return '';
  const sign = deltaMs >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

/**
 * Is that delta a regression, or just noise? Only the caller's `regression`
 * field decides the warning; this helper exists so the rule is stated once.
 */
export function isRegression(deltaMs) {
  return typeof deltaMs === 'number' && deltaMs >= REGRESSION_FLOOR_MS;
}

/**
 * The report, as printable lines: cost, share, delta, then the parallelism
 * figure with its cost. Pure.
 * @param {{ rows: object[], totalMs: number, hasPrevious?: boolean }} summary
 * @param {{ parallel?: object, note?: string }} [options]
 */
export function formatTimingReport(summary, { parallel, note } = {}) {
  const { rows, totalMs } = summary;
  const lines = [`⏱  Maillons — total ${formatDuration(totalMs)}`];
  if (rows.length === 0) {
    lines.push('   (aucun maillon mesuré)');
    return lines;
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  for (const row of rows) {
    const share = `${Math.round(row.share * 100)}%`.padStart(4);
    const delta = formatDelta(row.deltaMs);
    lines.push(
      `   ${formatDuration(row.ms).padStart(8)}  ${share}  ${row.name.padEnd(width)}` +
        (delta ? `  ${delta}${row.regression ? ' ⚠️' : ''}` : '') +
        (row.ok ? '' : '  (échec)'),
    );
  }
  if (!summary.hasPrevious) {
    lines.push('   (aucune exécution précédente : pas de comparaison possible ce coup-ci)');
  }
  if (parallel && parallel.group.length >= 2) {
    lines.push(
      parallel.worthwhile
        ? `→ indépendants (${parallel.group.join(', ')}) : les paralléliser ferait passer ` +
          `${formatDuration(parallel.sequentialMs)} → ${formatDuration(parallel.parallelMs)} ` +
          `(gain ${formatDuration(parallel.savedMs)}), au prix de ${parallel.group.length} node.exe de plus en ` +
          `concurrence — la pression exacte de la table de fork (docs/FORK_PANIC.md).`
        : `→ indépendants (${parallel.group.join(', ')}) mais gain trop faible ` +
          `(${formatDuration(parallel.savedMs)} < ${formatDuration(PARALLEL_FLOOR_MS)}) : pas de concurrence à ` +
          `ajouter pour ça.`,
    );
  }
  const longest = rows[0];
  if (longest && longest.share >= 0.5) {
    lines.push(
      `→ à attaquer en premier : ${longest.name} (${Math.round(longest.share * 100)}% du total) — ` +
        `c'est lui qui plafonne tout le reste.`,
    );
  }
  if (note) lines.push(`   ${note}`);
  return lines;
}

/**
 * Append a run to the cache (last `KEPT_RUNS` kept). Best-effort: a cache that
 * cannot be written never fails a quality run.
 * @param {{ at: string, totalMs: number, steps: object[] }} run
 */
export function writeTimings(run, { root = process.cwd(), fs: injected = undefined } = {}) {
  const fs = injected ?? { readFileSync, writeFileSync, mkdirSync };
  try {
    const file = timingsPath(root);
    fs.mkdirSync(dirname(file), { recursive: true });
    const runs = [...readTimings({ root, fs }), run].slice(-KEPT_RUNS);
    fs.writeFileSync(file, JSON.stringify(runs, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the cache, oldest first. Unreadable or malformed content yields [] — the
 * timings are diagnostics, never a gate.
 */
export function readTimings({ root = process.cwd(), fs: injected = undefined } = {}) {
  const fs = injected ?? { readFileSync };
  try {
    const parsed = JSON.parse(fs.readFileSync(timingsPath(root), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === 'object') : [];
  } catch {
    return [];
  }
}

/** The steps of the previous run, for the delta column. */
export function previousSteps(runs = []) {
  const last = (runs ?? []).filter((r) => Array.isArray(r?.steps)).at(-1);
  return last ? last.steps : [];
}

/** Append one JSON line about this run — the comparison used by `appendFileSync`. */
export function appendTimings(run, { root = process.cwd() } = {}) {
  try {
    const file = `${timingsPath(root)}.jsonl`;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(run) + '\n');
    return true;
  } catch {
    return false;
  }
}
