// Suite for scripts/lib/chain-timings.mjs — where the quality chain's time goes,
// and what parallelising would buy.
//
// Pure by construction: timings go in, lines come out, and the previous run is
// injected (no clock, no file). The file cache is exercised through an in-memory
// fs, so the assertions are about the CONTRACT (malformed cache → [], keep the
// last runs, never throw) rather than about this disk.
// Plain-node suite.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INDEPENDENT_READ_ONLY,
  PARALLEL_FLOOR_MS,
  formatDelta,
  formatDuration,
  formatTimingReport,
  parallelPlan,
  previousSteps,
  readTimings,
  summarizeTimings,
  timingsPath,
  writeTimings,
} from '../scripts/lib/chain-timings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('summarizeTimings — le coût RELATIF, pas seulement la durée', () => {
  it('trie par coût, calcule les parts, et le total', () => {
    const summary = summarizeTimings([
      { name: 'lint', ms: 6000 },
      { name: 'tests', ms: 34000 },
      { name: 'audit-gate', ms: 2000 },
    ]);
    assert.deepEqual(summary.rows.map((r) => r.name), ['tests', 'lint', 'audit-gate']);
    assert.equal(summary.totalMs, 42000);
    assert.equal(Math.round(summary.rows[0].share * 100), 81);
    assert.equal(summary.hasPrevious, false);
  });

  it('compare à l’exécution précédente, et distingue un maillon NOUVEAU', () => {
    const summary = summarizeTimings(
      [
        { name: 'lint', ms: 8000 },
        { name: 'tests', ms: 30000 },
        { name: 'build', ms: 500 },
      ],
      { previous: [{ name: 'lint', ms: 6000 }, { name: 'tests', ms: 34000 }] },
    );
    const byName = new Map(summary.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('lint')?.deltaMs, 2000, 'une régression est visible');
    assert.equal(byName.get('tests')?.deltaMs, -4000);
    assert.equal(byName.get('build')?.deltaMs, null, 'un maillon sans historique n’invente pas de delta');
    assert.equal(summary.hasPrevious, true);
  });

  it('entrées bancales : durées négatives ou absentes ramenées à zéro, jamais NaN', () => {
    const summary = summarizeTimings([{ name: 'x', ms: -5 }, { name: 'y' }, null as never]);
    assert.equal(summary.rows.length, 2);
    assert.equal(summary.totalMs, 0);
    assert.equal(summary.rows.every((r) => Number.isFinite(r.share)), true);
  });
});

describe('parallelPlan — le gain, et son coût', () => {
  it('parallélise les maillons indépendants : total − somme + max', () => {
    const plan = parallelPlan([
      { name: 'lint', ms: 6000 },
      { name: 'l10n', ms: 800 },
      { name: 'audit-gate', ms: 3000 },
      { name: 'tests', ms: 34000 },
    ]);
    assert.deepEqual(plan.group, ['lint', 'l10n', 'audit-gate']);
    assert.equal(plan.sequentialMs, 9800);
    assert.equal(plan.parallelMs, 6000);
    assert.equal(plan.savedMs, 3800);
    assert.equal(plan.worthwhile, false, `sous le plancher de ${PARALLEL_FLOOR_MS} ms, pas de concurrence`);
  });

  it('au-dessus du plancher, le gain est retenu', () => {
    const plan = parallelPlan([
      { name: 'lint', ms: 30000 },
      { name: 'l10n', ms: 800 },
      { name: 'audit-gate', ms: 2000 },
    ]);
    assert.equal(plan.savedMs, 2800);
    assert.equal(plan.worthwhile, false);

    const bigger = parallelPlan([
      { name: 'lint', ms: 40000 },
      { name: 'l10n', ms: 9000 },
      { name: 'audit-gate', ms: 2000 },
    ]);
    assert.equal(bigger.savedMs, 11000);
    assert.equal(bigger.worthwhile, true);
  });

  it('moins de deux maillons indépendants présents → aucun plan', () => {
    const plan = parallelPlan([{ name: 'lint', ms: 9000 }, { name: 'tests', ms: 30000 }]);
    assert.deepEqual(plan.group, []);
    assert.equal(plan.savedMs, 0);
    assert.equal(plan.worthwhile, false);
  });

  it('`tests` et `build` ne sont PAS déclarés indépendants (et la raison est écrite)', () => {
    // Ils spawnent des centaines de processus (la pression du fork-panic) et
    // `build` écrit `dist/` : les déclarer indépendants serait un mensonge.
    assert.deepEqual(INDEPENDENT_READ_ONLY, ['lint', 'l10n', 'audit-gate']);
    assert.equal(INDEPENDENT_READ_ONLY.includes('test'), false);
    assert.equal(INDEPENDENT_READ_ONLY.includes('build'), false);
  });
});

describe('formatDuration / formatDelta', () => {
  it('millisecondes, secondes, minutes — et le signe du delta', () => {
    assert.equal(formatDuration(455), '455 ms');
    assert.equal(formatDuration(6600), '6.6 s');
    assert.equal(formatDuration(92500), '1 min 33 s');
    assert.equal(formatDelta(2000), '+2.0 s');
    assert.equal(formatDelta(-5200), '−5.2 s');
    assert.equal(formatDelta(null), '');
  });
});

describe('formatTimingReport — lisible, et honnête sur la concurrence', () => {
  const rows = [
    { name: 'tests', ms: 34000, ok: true, share: 0.8, deltaMs: -2000 },
    { name: 'lint', ms: 6000, ok: true, share: 0.14, deltaMs: 1500 },
    { name: 'audit-gate', ms: 2500, ok: false, share: 0.06, deltaMs: null },
  ];

  it('imprime coût, part, delta (avec alerte sur une régression) et l’échec', () => {
    const lines = formatTimingReport({ rows, totalMs: 42500, hasPrevious: true }, { parallel: parallelPlan(rows) }).join('\n');
    assert.match(lines, /⏱ {2}Maillons — total 42\.5 s/);
    assert.match(lines, /34\.0 s {3}80% {2}tests/);
    assert.match(lines, /−2\.0 s/);
    assert.match(lines, /\+1\.5 s ⚠️/, 'une régression est signalée, pas juste affichée');
    assert.match(lines, /\(échec\)/);
    assert.match(lines, /attaquer en premier : tests \(80% du total\)/);
  });

  it('quand la concurrence vaut le coup, elle est chiffrée AVEC sa contrepartie', () => {
    const many = [
      { name: 'lint', ms: 40000, ok: true, share: 0.7, deltaMs: null },
      { name: 'l10n', ms: 9000, ok: true, share: 0.16, deltaMs: null },
      { name: 'audit-gate', ms: 8000, ok: true, share: 0.14, deltaMs: null },
    ];
    const lines = formatTimingReport({ rows: many, totalMs: 57000, hasPrevious: true }, { parallel: parallelPlan(many) }).join('\n');
    assert.match(lines, /gain 17\.0 s/);
    assert.match(lines, /table de fork/, 'le coût machine est dit, jamais caché');
    assert.match(lines, /docs\/FORK_PANIC\.md/);
  });

  it('sans historique, le dit — et un total vide ne produit pas de NaN', () => {
    const first = formatTimingReport(summarizeTimings([{ name: 'lint', ms: 1000 }])).join('\n');
    assert.match(first, /aucune exécution précédente/);
    const empty = formatTimingReport(summarizeTimings([])).join('\n');
    assert.match(empty, /aucun maillon mesuré/);
    assert.doesNotMatch(empty, /NaN/);
  });
});

describe('cache des exécutions (fs injecté, aucun I/O réel)', () => {
  const memoryFs = () => {
    const files = new Map<string, string>();
    return {
      files,
      mkdirSync: () => {},
      writeFileSync: (file: string, content: string) => files.set(file, content),
      readFileSync: (file: string) => {
        if (!files.has(file)) throw new Error('ENOENT');
        return files.get(file) as string;
      },
    };
  };

  it('écrit puis relit, et ignore un cache illisible ou mal formé', () => {
    const fs = memoryFs();
    const run = { at: '2026-09-11T12:00:00.000Z', totalMs: 42000, steps: [{ name: 'tests', ms: 34000 }] };
    assert.equal(writeTimings(run, { root: '/tmp/x', fs: fs as never }), true);
    assert.equal(readTimings({ root: '/tmp/x', fs: fs as never }).length, 1);
    assert.deepEqual(previousSteps(readTimings({ root: '/tmp/x', fs: fs as never })), [{ name: 'tests', ms: 34000 }]);

    fs.files.set(timingsPath('/tmp/x'), '{ pas du json');
    assert.deepEqual(readTimings({ root: '/tmp/x', fs: fs as never }), [], 'un cache cassé ne fait pas échouer la chaîne');
    fs.files.set(timingsPath('/tmp/x'), '{"pas":"un tableau"}');
    assert.deepEqual(readTimings({ root: '/tmp/x', fs: fs as never }), []);
    assert.deepEqual(readTimings({ root: '/tmp/inexistant', fs: fs as never }), []);
  });

  it('ne garde que les dernières exécutions (le cache ne grossit pas sans fin)', () => {
    const fs = memoryFs();
    for (let i = 0; i < 25; i++) {
      writeTimings({ at: `2026-09-11T12:00:${String(i).padStart(2, '0')}.000Z`, totalMs: i, steps: [] }, { root: '/tmp/y', fs: fs as never });
    }
    const kept = readTimings({ root: '/tmp/y', fs: fs as never });
    assert.equal(kept.length <= 20, true, `gardé ${kept.length} exécutions`);
    assert.equal(kept.at(-1)?.totalMs, 24, 'la plus récente est conservée');
  });

  it('un fs qui refuse d’écrire n’échoue jamais (best-effort)', () => {
    const brokenFs = {
      mkdirSync: () => {
        throw new Error('EACCES');
      },
      writeFileSync: () => {},
      readFileSync: () => '[]',
    };
    assert.equal(writeTimings({ at: 'x', totalMs: 1, steps: [] }, { root: '/tmp/z', fs: brokenFs as never }), false);
  });
});

describe('câblage — la chaîne mesure ET affiche', () => {
  const chain = readFileSync(join(ROOT, 'scripts', 'quality-chain.mjs'), 'utf8');

  it('le rapport est imprimé et l’exécution est enregistrée', () => {
    assert.match(chain, /formatTimingReport\(summary/);
    assert.match(chain, /writeTimings\(/);
    assert.match(chain, /readTimings\(\{ root \}\)/, 'la comparaison est lue AVANT l’écriture');
  });

  it('les maillons de hygiène sont mesurés eux aussi (ils coûtent des secondes)', () => {
    assert.match(chain, /name: 'sweep:chrome'/);
    assert.match(chain, /name: 'sweep:electron'/);
    assert.match(chain, /name: `purge:\$\{origin\}`/);
  });
});
