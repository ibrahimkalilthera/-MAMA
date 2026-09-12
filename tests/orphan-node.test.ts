// Suite for scripts/lib/orphan-node.mjs — the purge of this run's own node.exe
// orphans, plus the log that makes the panic measurable.
//
// Everything is injected: no PowerShell, no real process is ever killed. The
// policy is what matters, and every assertion here exists because a real
// measurement on a killed chain said so:
//   - LINEAGE — descendants are found by closing over ParentProcessId, which
//     Windows retains after the creator exits (measured: a walk anchored at a
//     DEAD pid still found the surviving orphan). The recording phase and the
//     kill phase stay separate concerns anyway: the kill works from the
//     RECORDED set alone, because a live-tree snapshot is what authenticates a
//     target — a post-mortem walk has nothing left to check it against;
//   - STAMPS — a pid alone is not an identity: the kill only touches a process
//     that still carries the creation stamp we recorded, so a recycled pid can
//     never kill someone else's node.exe;
//   - HONESTY — a pass that could not RUN must never come back looking like
//     "nothing to kill". The first version of this purge did exactly that and
//     measured as a silent no-op on a real, freshly killed chain; hence the
//     KILLED= marker and the `failed` count;
//   - RECORDING — zeros are recorded too, otherwise "how often?" has no
//     denominator.
// Plain-node suite.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDescendantSnapshotScript,
  buildKillScript,
  parseDescendantSnapshot,
  readSweepLog,
  recordSweep,
  snapshotDescendants,
  summarizeSweepLog,
  sweepLogPath,
  sweepOwnNodeOrphans,
} from '../scripts/lib/orphan-node.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const noSleep = async () => {};
const node = (pid: number, born = `2026-09-11T11:00:0${pid % 10}.0000000+02:00`) => ({
  pid,
  name: 'node.exe',
  born,
});
const killed = (n: number) => ({ ok: true, stdout: `KILLED=${n}\r\n` });
const win = { platform: 'win32' as const };

describe('relevé des descendants — possible seulement racine vivante', () => {
  it('part des racines, ferme la descendance à toute profondeur, et horodate', () => {
    const script = buildDescendantSnapshotScript({ rootPids: [4242, 77] });
    assert.match(script, /\[void\]\$ids\.Add\(4242\);/);
    assert.match(script, /\[void\]\$ids\.Add\(77\);/);
    assert.match(script, /\$ids\.Contains\(\[int\]\$p\.ParentProcessId\)/);
    assert.match(script, /PID=' \+ \$p\.ProcessId \+ ';NAME=' \+ \$p\.Name/);
    assert.match(script, /CreationDate\.ToString\('o'\)/, "l'horodatage exact est ce qui prouve l'identité");
  });

  it('des racines invalides sont ignorées', () => {
    const script = buildDescendantSnapshotScript({ rootPids: [0, -3, Number.NaN] });
    assert.doesNotMatch(script, /Add\(0\)/);
    assert.doesNotMatch(script, /Add\(-3\)/);
  });

  it('parse les lignes valides et ignore le reste', () => {
    const out = [
      'PID=11;NAME=node.exe;BORN=2026-09-11T11:00:00.1234567+02:00',
      'blah',
      'PID=12;NAME=cmd.exe;BORN=2026-09-11T11:00:01.0000000+02:00',
      '',
    ].join('\r\n');
    const parsed = parseDescendantSnapshot(out);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0], { pid: 11, name: 'node.exe', born: '2026-09-11T11:00:00.1234567+02:00' });
    assert.equal(parsed[1].name, 'cmd.exe');
  });

  it('script vide ou hors Windows → null, JAMAIS une liste vide', async () => {
    // Une liste vide se lirait comme « aucun descendant », exactement la
    // confusion qui rendait la première version inerte.
    assert.equal(await snapshotDescendants({ rootPids: [], platform: 'win32' }), null);
    assert.equal(await snapshotDescendants({ rootPids: [1, 2], platform: 'linux' }), null);
    assert.equal(
      await snapshotDescendants({
        rootPids: [1],
        platform: 'win32',
        runScript: async () => ({ ok: false, stdout: '', error: 'fork: Resource temporarily unavailable' }),
      }),
      null,
    );
    const parsed = await snapshotDescendants({
      rootPids: [1],
      platform: 'win32',
      runScript: async () => ({ ok: true, stdout: 'PID=9;NAME=node.exe;BORN=b' }),
    });
    assert.equal(parsed?.[0].pid, 9);
  });
});

describe('kill — la borne est l’horodatage, pas le pid', () => {
  const script = buildKillScript({
    targets: [{ pid: 11, born: 'b1' }, { pid: 12, born: 'b2' }],
    excludePid: 999,
  });

  it('cible chaque pid avec son horodatage', () => {
    assert.match(script, /'11\|b1'/);
    assert.match(script, /'12\|b2'/);
    assert.match(script, /CreationDate\.ToString\('o'\) -eq \$parts\[1\]/);
  });

  it('ne touche que node.exe, jamais le purgeur ni un guard', () => {
    assert.match(script, /\$p\.Name -eq 'node\.exe'/);
    assert.match(script, /-ne 999/);
    assert.match(script, /-notmatch 'orphan-guard\\\.mjs'/);
  });

  it('sort un MARQUEUR, jamais un nombre nu', () => {
    assert.match(script, /Write-Output \('KILLED=' \+ \$k\)/);
  });

  it('un horodatage contenant une apostrophe est échappé', () => {
    const s = buildKillScript({ targets: [{ pid: 3, born: "a'b" }] });
    assert.match(s, /'3\|a''b'/);
  });
});

describe('sweepOwnNodeOrphans — politique', () => {
  it('hors Windows : rien n’est lancé', async () => {
    let called = 0;
    const r = await sweepOwnNodeOrphans({
      rootPids: [1],
      platform: 'linux',
      runScript: async () => {
        called++;
        return killed(5);
      },
    });
    assert.deepEqual(r, { killed: 0, passes: 0, failed: 0, seen: 0 });
    assert.equal(called, 0);
  });

  it('ni racine ni relevé : rien à faire, aucune passe', async () => {
    const r = await sweepOwnNodeOrphans({ ...win, rootPids: [], recorded: [] });
    assert.deepEqual(r, { killed: 0, passes: 0, failed: 0, seen: 0 });
  });

  it('ne cible que node.exe parmi les descendants (pas cmd.exe ni conhost)', async () => {
    const seen: string[] = [];
    const r = await sweepOwnNodeOrphans({
      ...win,
      passes: 1,
      rootPids: [4242],
      snapshot: async () => [node(11), { pid: 12, name: 'cmd.exe', born: 'b' }, { pid: 13, name: 'conhost.exe', born: 'c' }],
      runScript: async (script) => {
        seen.push(...[...script.matchAll(/'(\d+)\|[^']*'/g)].map((m) => m[1]));
        return killed(1);
      },
      sleep: noSleep,
    });
    assert.deepEqual(seen, ['11'], 'cmd.exe et conhost.exe ne sont jamais tués');
    assert.equal(r.killed, 1);
  });

  it('répète tant qu’une passe tue : les enfants meurent en vagues', async () => {
    const results = [killed(2), killed(1), killed(0)];
    const r = await sweepOwnNodeOrphans({
      ...win,
      rootPids: [4242],
      snapshot: async () => [node(11), node(12), node(13)],
      runScript: async () => results.shift() ?? killed(0),
      sleep: noSleep,
    });
    assert.equal(r.killed, 3, 'les trois vagues sont comptées');
    assert.equal(r.failed, 0);
    assert.ok(r.passes <= 4, 'la boucle est bornée par passes');
  });

  it('RACINE MORTE : la purge travaille sur le relevé, sans aucun relevé frais', async () => {
    // Le cas réel du guard : la chaîne est morte, donc la fermeture ne trouve
    // plus rien — c'est le relevé pris pendant qu'elle vivait qui compte.
    let snapshots = 0;
    const waves = [killed(2), killed(0)];
    const r = await sweepOwnNodeOrphans({
      ...win,
      rootPids: [4242],
      recorded: [node(11), node(12)],
      snapshot: async () => {
        snapshots++;
        return null; // racine morte : plus rien à voir
      },
      runScript: async (script) => {
        assert.match(script, /'11\|/, 'les cibles viennent du relevé');
        assert.match(script, /'12\|/);
        return waves.shift() ?? killed(0);
      },
      sleep: noSleep,
    });
    assert.equal(r.killed, 2, 'sans relevé, cette purge serait un no-op silencieux');
    assert.equal(r.failed, 0, 'un relevé vide n’est PAS un échec quand on a un relevé antérieur');
    assert.ok(snapshots >= 1);
  });

  it('un échec de relevé sans rien de mémorisé est compté, jamais déguisé en succès', async () => {
    const lines: string[] = [];
    const r = await sweepOwnNodeOrphans({
      ...win,
      rootPids: [4242],
      snapshot: async () => null,
      runScript: async () => killed(0),
      sleep: noSleep,
      log: (m) => lines.push(m),
    });
    assert.equal(r.killed, 0);
    assert.equal(r.failed, 3, 'réessayé avant d’abandonner');
    assert.equal(r.passes, 3);
    assert.match(lines[0], /purge impossible à exécuter/);
    assert.match(lines[0], /orphans:report/, 'le remède est nommé');
  });

  it('une purge sans marqueur KILLED= est un échec, pas une purge réussie', async () => {
    const r = await sweepOwnNodeOrphans({
      ...win,
      recorded: [node(11)],
      runScript: async () => ({ ok: true, stdout: '(aucune sortie)' }),
      sleep: noSleep,
      snapshot: undefined,
    });
    assert.equal(r.killed, 0);
    assert.equal(r.failed, 3);
  });

  it('exclut son propre pid et les guard du relevé', async () => {
    const scripts: string[] = [];
    const r = await sweepOwnNodeOrphans({
      ...win,
      passes: 1,
      recorded: [node(11), node(12)],
      excludePid: 11,
      snapshot: async () => [{ ...node(13), born: 'x-orphan-guard.mjs' }],
      runScript: async (script) => {
        scripts.push(script);
        return killed(1);
      },
      sleep: noSleep,
    });
    assert.equal(r.killed, 1);
    assert.doesNotMatch(scripts[0], /'11\|/, 'jamais son propre pid');
    assert.doesNotMatch(scripts[0], /orphan-guard\.mjs'/);
    assert.match(scripts[0], /'12\|/);
  });

  it('ne parle que quand il a tué, et jamais au pluriel faux', async () => {
    const lines: string[] = [];
    await sweepOwnNodeOrphans({ ...win, recorded: [node(11)], runScript: async () => killed(0), sleep: noSleep, log: (m) => lines.push(m) });
    assert.deepEqual(lines, [], 'une purge vide ne doit pas bruiter la sortie');

    const spoken: string[] = [];
    await sweepOwnNodeOrphans({
      ...win,
      recorded: [node(11)],
      passes: 1,
      runScript: async () => killed(2),
      sleep: noSleep,
      log: (m) => spoken.push(m),
    });
    assert.equal(spoken.length, 1);
    assert.match(spoken[0], /2 node\.exe orphelin\(s\) de cette exécution purgé\(s\) en 1 passe\(s\)/);
  });
});

describe('journal des purges — les zéros comptent', () => {
  it('écrit et relit les entrées, zéros compris', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-sweep-log-'));
    try {
      assert.equal(recordSweep({ origin: 'exit', killed: 0, passes: 1, failed: 0 }, { root: dir }), true);
      assert.equal(recordSweep({ origin: 'guard', killed: 3, passes: 2, failed: 0 }, { root: dir }), true);
      const entries = readSweepLog({ root: dir });
      assert.equal(entries.length, 2, 'les purges vides sont enregistrées aussi');
      assert.equal(entries[0].killed, 0);
      assert.equal(entries[1].origin, 'guard');
      assert.match(String(entries[0].at), /^\d{4}-\d{2}-\d{2}T/, 'horodatage ISO');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('crée le dossier au besoin et résiste à une écriture impossible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-sweep-log-'));
    try {
      assert.equal(recordSweep({ origin: 'exit', killed: 1 }, { root: dir }), true);
      assert.match(sweepLogPath(dir), /quality-chain-sweeps\.jsonl$/);
      assert.equal(
        recordSweep({ origin: 'exit' }, { root: dir, write: () => { throw new Error('disque plein'); } }),
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une ligne illisible est ignorée, jamais fatale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-sweep-log-'));
    try {
      recordSweep({ origin: 'exit', killed: 0 }, { root: dir });
      const file = sweepLogPath(dir);
      writeFileSync(file, readFileSync(file, 'utf8') + '{ pas du json\n');
      const entries = readSweepLog({ root: dir });
      assert.equal(entries.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('journal absent → liste vide (pas d’exception)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-sweep-log-'));
    try {
      assert.deepEqual(readSweepLog({ root: dir }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('summarizeSweepLog — le rapport compte, il ne raconte pas', () => {
  it('sépare purges et panics, et additionne les tués', () => {
    const summary = summarizeSweepLog([
      { at: '2026-09-11T10:00:00.000Z', origin: 'exit', killed: 0, passes: 1, failed: 0 },
      { at: '2026-09-11T10:30:00.000Z', origin: 'guard', killed: 3, passes: 2, failed: 0 },
      { at: '2026-09-11T10:31:00.000Z', kind: 'panic', origin: 'git-retry:panic', git: 'push', exitCode: 254 },
    ]);
    assert.equal(summary.total, 3);
    assert.deepEqual(
      [summary.purges.count, summary.purges.nonEmpty, summary.purges.killed],
      [2, 1, 3],
      'les zéros comptent : 2 purges, 1 non vide, 3 tués',
    );
    assert.equal(summary.panics.count, 1, 'la panique est comptée à part des purges');
    assert.deepEqual(summary.panics.byGitCommand, [{ key: 'push', count: 1, killed: 0 }]);
    assert.deepEqual(summary.purges.byOrigin, [
      { key: 'guard', count: 1, killed: 3 },
      { key: 'exit', count: 1, killed: 0 },
    ]);
  });

  it('compte les purges qui n’ont pas pu s’exécuter (jamais fondues dans les zéros)', () => {
    const summary = summarizeSweepLog([
      { origin: 'git-retry:sweep', killed: 0, failed: true },
      { origin: 'git-retry:sweep', killed: 0, failed: 2 },
      { origin: 'exit', killed: 1, passes: 1 },
    ]);
    assert.equal(summary.purges.failed, 2);
    assert.equal(summary.purges.killed, 1);
  });

  it('fenêtre : bornes du journal, jamais un taux sur un instant', () => {
    const summary = summarizeSweepLog([
      { at: '2026-09-11T10:00:00.000Z', origin: 'exit', killed: 0 },
      { at: '2026-09-11T10:31:00.000Z', origin: 'guard', killed: 1 },
    ]);
    assert.equal(summary.spanMs, 31 * 60_000);
    const single = summarizeSweepLog([{ at: '2026-09-11T10:00:00.000Z', origin: 'exit', killed: 0 }]);
    assert.equal(single.spanMs, 0, 'un seul événement ne fait pas une fenêtre');
  });

  it('entrées illisibles ou champs absents ne cassent ni le compte ni la lecture', () => {
    const summary = summarizeSweepLog([
      null as never,
      {},
      { at: 'pas une date', killed: '4' },
    ]);
    assert.equal(summary.total, 2, 'null est ignoré');
    assert.equal(summary.purges.killed, 4, 'un compteur textuel est normalisé');
    assert.equal(summary.purges.byOrigin.some((o) => o.key === '?'), true);
    assert.equal(summary.firstAt, null, 'une date illisible ne fabrique pas une borne');
  });

  it('journal vide → zéro partout, jamais NaN', () => {
    const summary = summarizeSweepLog([]);
    assert.deepEqual(summary.purges, { count: 0, nonEmpty: 0, failed: 0, killed: 0, byOrigin: [] });
    assert.equal(summary.panics.count, 0);
    assert.equal(summary.spanMs, 0);
  });
});

describe('câblage — la purge à la sortie ne peut pas se décâbler', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
  const chain = strip(readFileSync(join(ROOT, 'scripts/quality-chain.mjs'), 'utf8'));
  const guard = strip(readFileSync(join(ROOT, 'scripts/lib/orphan-guard.mjs'), 'utf8'));

  it('la chaîne purge ses propres descendants, racine vivante', () => {
    assert.match(chain, /sweepOwnNodeOrphans\(\{/);
    assert.match(chain, /rootPids: \[process\.pid\]/);
  });

  it('la purge tourne sur CHAQUE chemin de sortie (finally + signaux)', () => {
    assert.match(chain, /finally \{[\s\S]*?purgeOwnOrphans\('exit'\)/, 'la sortie normale passe par le finally');
    assert.match(chain, /process\.on\(signal,[\s\S]*?purgeOwnOrphans\(`signal:\$\{signal\}`\)/);
    assert.match(chain, /recordSweep\(\{ origin, \.\.\.result \}\)/);
    assert.match(chain, /process\.exitCode = 1/, 'exitCode, jamais process.exit : le finally doit tourner');
    assert.doesNotMatch(chain, /process\.exit\(1\)/, 'un process.exit court-circuiterait la purge');
  });

  it('le guard enregistre PENDANT que la chaîne vit, puis purge le relevé', () => {
    assert.match(guard, /snapshotDescendants\(\{ rootPids: \[parentPid\] \}\)/);
    assert.match(guard, /remember\(await takeSnapshot\(\)\)/);
    assert.match(guard, /sweepOwnNodeOrphans\(\{[\s\S]*?recorded,/);
    assert.match(guard, /recordSweep\(\{ origin: 'guard', \.\.\.own \}\)/);
    assert.match(guard, /const SNAPSHOT_MS = \d+/, 'la fenêtre du relevé est explicite, pas implicite');
    assert.match(chain, /spawnOrphanGuard\(\{ parentPid: process\.pid \}\)/);
  });

  it('le rapport de purge est branché en npm script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['orphans:report'], /sweep-report\.mjs/);
  });

  it('le wrapper git journalise ses purges --sweep ET la panique elle-même', () => {
    const gitRetry = strip(readFileSync(join(ROOT, 'scripts/git-retry.mjs'), 'utf8'));
    assert.match(gitRetry, /recordGitRetryEvent\(\s*\{\s*kind: 'purge'/, 'chaque --sweep écrit son compteur');
    assert.match(
      gitRetry,
      /recordGitRetryEvent\(\s*\{ kind: 'panic'/, 
      'la panique est journalisée même sans --sweep : c’est la fréquence demandée',
    );
    assert.match(gitRetry, /runSweepOnce\('start'\)/);
    assert.match(gitRetry, /runSweepOnce\('retry'\)/);
  });

  it('le rapport sépare les purges des paniques', () => {
    const report = strip(readFileSync(join(ROOT, 'scripts/sweep-report.mjs'), 'utf8'));
    assert.match(report, /summarizeSweepLog\(entries\)/);
    assert.match(report, /panics\.count/);
  });
});
