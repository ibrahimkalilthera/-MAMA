// Suite for scripts/lib/panic-doctor.mjs — the read-only diagnosis of the
// machine state around the msys fork panic.
//
// Everything is pure: a snapshot is text, a process is a record, and the clock
// is a number the caller passes. That matters because the interesting branches
// are exactly the ones you cannot produce on demand on a real machine — a chain
// orphan whose parent is gone, a guard watching a dead pid, a stranger node.exe
// that must never be purged. The CLI itself is NOT imported (importing it would
// run a diagnosis); its guarantees are asserted on its source instead:
//   - it is read-only (no kill primitive anywhere in it);
//   - it shares the sweep's own definition of a quality-chain leftover, so the
//     doctor can never describe a rule the sweep does not apply.
// Plain-node suite.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_CHAIN_WRAPPER_PATTERN,
  matchesKnownChainWrapper,
  snapshotDescendants,
  sweepOwnNodeOrphans,
} from '../scripts/lib/orphan-node.mjs';
import {
  NODE_PRESSURE_THRESHOLD,
  buildMachineSnapshotScript,
  describeAge,
  diagnose,
  formatDiagnosis,
  parseMachineSnapshot,
  shortCommand,
} from '../scripts/lib/panic-doctor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const bornAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

type Proc = {
  pid: number;
  ppid: number;
  name: string;
  born: string;
  memMb: number;
  cmd: string;
};

const proc = (over: Partial<Proc> = {}): Proc => ({
  pid: 100,
  ppid: 1,
  name: 'node.exe',
  born: bornAgo(5),
  memMb: 40,
  cmd: 'node scripts/quality-chain.mjs',
  ...over,
});

describe('buildMachineSnapshotScript', () => {
  it('demande pid, parent, nom, horodatage, mémoire et ligne de commande', () => {
    const script = buildMachineSnapshotScript();
    for (const field of ['ProcessId', 'ParentProcessId', 'CreationDate', 'WorkingSetSize', 'CommandLine']) {
      assert.match(script, new RegExp(field), `${field} est nécessaire au diagnostic`);
    }
    assert.match(script, /MEMFREE=/, 'la mémoire est une donnée d’ambiance du diagnostic');
  });
});

describe('parseMachineSnapshot', () => {
  it('lit les processus et la ligne mémoire, ignore le reste', () => {
    const stdout = [
      'PID=101;PPID=1;NAME=node.exe;BORN=2026-09-11T11:00:00.000Z;MEM=104857600;CMD=node scripts/quality-chain.mjs lint',
      'du bruit qui ne doit pas casser la lecture',
      'PID=cassé;PPID=x;NAME=node.exe;BORN=;MEM=1;CMD=',
      'PID=102;PPID=101;NAME=chrome.exe;BORN=2026-09-11T11:30:00.000Z;MEM=20971520;CMD=chrome.exe --type=renderer',
      'MEMFREE=7516192768;MEMTOTAL=17045651456',
    ].join('\n');
    const { processes, memory } = parseMachineSnapshot(stdout);
    assert.equal(processes.length, 2, 'les lignes illisibles sont ignorées, sans exception');
    assert.deepEqual(processes[0], {
      pid: 101,
      ppid: 1,
      name: 'node.exe',
      born: '2026-09-11T11:00:00.000Z',
      memMb: 100,
      cmd: 'node scripts/quality-chain.mjs lint',
    });
    assert.deepEqual(memory, { freeBytes: 7516192768, totalBytes: 17045651456 });
  });

  it('sortie vide → aucun processus, aucune erreur', () => {
    assert.deepEqual(parseMachineSnapshot(), {
      processes: [],
      memory: { freeBytes: null, totalBytes: null },
    });
  });
});

describe('describeAge / shortCommand', () => {
  it('âge lisible : secondes, minutes, heures, jours, inconnu', () => {
    assert.equal(describeAge(bornAgo(0.5), NOW), '30 s');
    assert.equal(describeAge(bornAgo(7), NOW), '7 min');
    assert.equal(describeAge(bornAgo(180), NOW), '3 h');
    assert.equal(describeAge(bornAgo(60 * 24 * 3), NOW), '3 j');
    assert.equal(describeAge('', NOW), 'âge inconnu');
    assert.equal(describeAge('pas une date', NOW), 'âge inconnu');
  });

  it('le nom du script remplace une ligne de commande illisible', () => {
    assert.equal(shortCommand('node /repo/scripts/quality-chain.mjs lint'), 'quality-chain.mjs');
    assert.equal(shortCommand('"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\scripts\\sweep-report.mjs'), 'sweep-report.mjs');
    assert.equal(shortCommand(''), '(ligne de commande illisible)');
    assert.ok(shortCommand(`node ${'x'.repeat(200)}.mjs`).endsWith('…'));
  });
});

describe('diagnose — ce que le sweep prendrait, et ce qu’il ne touchera jamais', () => {
  it('un wrapper à parent disparu est le seul orphelin, et il est nommé avec le remède', () => {
    const report = diagnose({
      processes: [
        proc({ pid: 500, ppid: 999, cmd: 'node C:\\repo\\scripts\\quality-chain.mjs lint' }),
        proc({ pid: 501, ppid: 500, cmd: 'node C:\\repo\\scripts\\lib\\orphan-guard.mjs 500' }),
      ],
      nowMs: NOW,
    });
    assert.equal(report.counts.chainOrphans, 1);
    assert.equal(report.counts.guards, 1, 'le garde n’est jamais compté comme un orphelin');
    assert.equal(report.chainOrphans[0]?.pid, 500);
    assert.equal(report.chainOrphans[0]?.parentGone, true);
    assert.match(report.chainOrphans[0]?.age ?? '', /min$/);
    const alarm = report.verdicts.find((v) => v.level === 'alarm');
    assert.ok(alarm, 'un orphelin de chaîne est un constat alarmant');
    assert.match(alarm.text, /--sweep/, 'le remède exact est donné, pas seulement le constat');
  });

  it('une chaîne ATTACHÉE (parent vivant) n’est pas un orphelin : c’est du travail en cours', () => {
    const report = diagnose({
      processes: [
        proc({ pid: 1, cmd: 'wrapper' }),
        proc({ pid: 500, ppid: 1, cmd: 'node C:\\repo\\scripts\\quality-chain.mjs lint' }),
      ],
      nowMs: NOW,
    });
    assert.equal(report.counts.chainOrphans, 0);
    assert.equal(report.counts.chainAttached, 1);
    assert.equal(report.verdicts.some((v) => v.level === 'alarm'), false);
    assert.match(report.verdicts.find((v) => v.level === 'ok')?.text ?? '', /rien à purger/);
  });

  it('un node.exe ÉTRANGER à parent disparu est montré, mais jamais candidat', () => {
    const report = diagnose({
      processes: [
        proc({ pid: 700, ppid: 404, cmd: 'node C:\\outils\\serveur-dev.mjs --port 3000' }),
        proc({ pid: 701, ppid: 700, cmd: 'node C:\\repo\\node_modules\\vite\\bin\\vite.js' }),
      ],
      nowMs: NOW,
    });
    assert.equal(report.counts.chainOrphans, 0);
    assert.equal(report.otherNode.length, 2);
    assert.equal(report.otherNode.every((p) => p.eligible === false), true);
    const note = report.verdicts.find((v) => v.level === 'info');
    assert.match(note?.text ?? '', /laissés tels quels|étrangers/i);
  });

  it('un garde qui surveille un pid mort est signalé (il devrait sortir)', () => {
    const report = diagnose({
      processes: [proc({ pid: 501, cmd: 'node C:\\repo\\scripts\\lib\\orphan-guard.mjs 424242' })],
      nowMs: NOW,
    });
    assert.equal(report.guards[0].watchedPid, 424242);
    assert.equal(report.guards[0].watchedAlive, false);
    assert.equal(report.verdicts.find((v) => /garde/.test(v.text))?.level, 'warn');
  });

  it('un garde qui surveille une chaîne vivante est une information, pas une alerte', () => {
    const report = diagnose({
      processes: [
        proc({ pid: 500, cmd: 'node C:\\repo\\scripts\\quality-chain.mjs lint' }),
        proc({ pid: 501, cmd: 'node C:\\repo\\scripts\\lib\\orphan-guard.mjs --relay 500' }),
      ],
      nowMs: NOW,
    });
    assert.equal(report.guards[0].watchedPid, 500);
    assert.equal(report.guards[0].watchedAlive, true);
    assert.equal(report.verdicts.find((v) => /garde/.test(v.text))?.level, 'info');
  });

  it('chrome/electron restants et pression node sont comptés, pas confondus', () => {
    const chrome = [proc({ pid: 900, name: 'chrome.exe', ppid: 898, cmd: 'chrome.exe --type=renderer' })];
    const many = Array.from({ length: NODE_PRESSURE_THRESHOLD + 1 }, (_, i) =>
      proc({ pid: 1000 + i, ppid: 1, cmd: 'node C:\\repo\\node_modules\\vite\\bin\\vite.js' }),
    );
    const report = diagnose({ processes: [...chrome, ...many], nowMs: NOW });
    assert.equal(report.counts.chromeLike, 1);
    assert.equal(report.counts.node, NODE_PRESSURE_THRESHOLD + 1);
    const texts = report.verdicts.map((v) => v.text).join(' | ');
    assert.match(texts, /chrome\/electron restants/);
    assert.match(texts, /table de fork msys est chargée/);
    assert.equal(report.counts.chainOrphans, 0, 'aucun de ces processus n’est un orphelin de chaîne');
  });

  it('le journal est résumé : zéros compris, et seules les paniques de 24 h comptent', () => {
    const journal = [
      { at: '2026-09-11T11:00:00.000Z', origin: 'exit', killed: 0 },
      { at: '2026-09-11T11:30:00.000Z', origin: 'guard', killed: 2 },
      { at: '2026-09-11T11:45:00.000Z', kind: 'panic', origin: 'git-retry:panic', git: 'push' },
      { at: '2026-09-01T11:45:00.000Z', kind: 'panic', origin: 'git-retry:panic', git: 'commit' },
    ];
    const report = diagnose({ processes: [], journal, nowMs: NOW });
    assert.deepEqual(
      [report.journal.purges.count, report.journal.purges.killed, report.journal.panics.count],
      [2, 2, 2],
    );
    const warn = report.verdicts.find((v) => /fork-panic/.test(v.text));
    assert.match(warn?.text ?? '', /1 fork-panic\(s\) journalisée\(s\) sur les dernières 24 h/);
    assert.match(warn?.text ?? '', /git push/, 'la commande que la panique a interrompue est citée');
  });

  it('aucun processus, aucun journal → un état vide se dit clairement, sans NaN', () => {
    const report = diagnose({ nowMs: NOW });
    assert.equal(report.counts.processes, 0);
    assert.equal(report.biggestNode.length, 0);
    const lines = formatDiagnosis(report, { nowMs: NOW }).join('\n');
    assert.doesNotMatch(lines, /NaN/);
    assert.match(lines, /Aucun orphelin de chaîne qualité/);
    assert.match(lines, /lecture seule/);
  });
});

describe('formatDiagnosis', () => {
  it('imprime les orphelins avec pid, âge et parent disparu', () => {
    const report = diagnose({
      processes: [proc({ pid: 500, ppid: 999, born: bornAgo(9), cmd: 'node C:\\repo\\scripts\\quality-chain.mjs' })],
      nowMs: NOW,
    });
    const lines = formatDiagnosis(report, { nowMs: NOW }).join('\n');
    assert.match(lines, /pid 500/);
    assert.match(lines, /9 min/);
    assert.match(lines, /parent 999 disparu/);
    assert.match(lines, /quality-chain\.mjs/);
  });
});

describe('câblage — le docteur ne peut ni tuer, ni diverger du sweep', () => {
  const doctorCli = readFileSync(join(ROOT, 'scripts', 'panic-doctor.mjs'), 'utf8');
  const doctorLib = readFileSync(join(ROOT, 'scripts', 'lib', 'panic-doctor.mjs'), 'utf8');
  const gitRetry = readFileSync(join(ROOT, 'scripts', 'git-retry.mjs'), 'utf8');

  it('le diagnostic est en LECTURE SEULE', () => {
    for (const killer of ['Stop-Process', 'taskkill', 'process.kill', 'killTree', 'pkill']) {
      assert.doesNotMatch(doctorCli, new RegExp(killer), `un docteur qui soigne cache l’état qu’on venait voir (${killer})`);
      assert.doesNotMatch(doctorLib, new RegExp(killer), `${killer} n’a rien à faire dans la bibliothèque de diagnostic`);
    }
  });

  it('le sweep et le docteur partagent LA MÊME définition d’un orphelin de chaîne', () => {
    assert.match(doctorLib, /matchesKnownChainWrapper/);
    assert.match(gitRetry, /\$\{KNOWN_CHAIN_WRAPPER_PATTERN\}/, 'le filtre PowerShell vient de la constante partagée');
    assert.equal(
      /quality-chain\\+\.mjs\|npm-cli/.test(gitRetry),
      false,
      'plus aucune copie littérale du filtre dans le wrapper : une copie dérive en silence',
    );
  });

  it('la constante partagée classe un wrapper et épargne un serveur de dev', () => {
    assert.equal(matchesKnownChainWrapper('node C:\\repo\\scripts\\quality-chain.mjs lint'), true);
    assert.equal(matchesKnownChainWrapper('node npm-cli.js run lint'), true);
    assert.equal(matchesKnownChainWrapper('node --test tests/foo.test.ts'), true);
    assert.equal(matchesKnownChainWrapper('node --test tests\\foo.test.ts'), true, 'le séparateur Windows aussi');
    assert.equal(matchesKnownChainWrapper('node node_modules/vite/bin/vite.js'), false);
    assert.equal(matchesKnownChainWrapper('node scripts/git-retry.mjs --sweep -- push'), false);
    assert.equal(matchesKnownChainWrapper(''), false);
    assert.match(KNOWN_CHAIN_WRAPPER_PATTERN, /\\\.mjs/, 'des points littéraux, pas des jokers');
  });

  it('la classification ne dépend pas de l’OS — mais l’inventaire et la purge, si', async () => {
    // Injecté explicitement : hors Windows il n’y a ni instantané ni purge, et
    // le docteur le dit (seul le journal reste) au lieu d’afficher un zéro qui
    // aurait l’air d’un état machine propre.
    assert.equal(matchesKnownChainWrapper('node scripts/quality-chain.mjs lint'), true);
    assert.equal(await snapshotDescendants({ rootPids: [1], platform: 'linux' }), null, 'aucun relevé, pas un relevé vide');
    assert.deepEqual(await sweepOwnNodeOrphans({ platform: 'linux' }), {
      killed: 0,
      passes: 0,
      failed: 0,
      seen: 0,
    });
    assert.equal(await snapshotDescendants({ platform: 'win32', rootPids: [] }), null, 'sans racine, rien à relever');
  });

  it('le docteur est branché en npm script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['orphans:doctor'], /panic-doctor\.mjs/);
  });

  it('la purge du hook s’annonce comme telle, pas comme une commande git', () => {
    const hook = readFileSync(join(ROOT, 'scripts', 'hook-quality-chain.mjs'), 'utf8');
    assert.match(hook, /sweepOrigin: sweepAll \? 'hook-quality-chain:sweep-all' : 'hook-quality-chain:sweep'/);
  });
});
