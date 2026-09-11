// Suite for scripts/git-retry.mjs — runGitWithRetry() + isForkPanicFailure().
//
// node:child_process is module-mocked (a controllable fake spawn) BEFORE the
// import, so no real git ever runs. The fake child emits configurable
// close/error sequences to prove the retry policy:
//   - retries ONLY on the msys fork-panic signatures (exit 254/66, stderr
//     matching fork/resource-unavailable patterns);
//   - a real git failure (e.g. hook lint error, exit 1) is never masked by
//     retries — the wrapper passes git's code straight through;
//   - bounded attempts with backoff; spawn errors (uv_spawn EUNKNOWN) retry;
//   - success on the first try → one spawn, exit 0.
// Plain-node suite (no DOM, no network).
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Mocked child_process state ───────────────────────────────────────────────
type ClosePlan = { mode: 'close'; code: number; stderr?: string; stdout?: string };
type ErrorPlan = { mode: 'error'; message: string };
type Plan = ClosePlan | ErrorPlan;
let plan: Plan[] = [];
let spawnCalls: string[][] = [];
let killed: number[] = [];

class FakeChild extends EventEmitter {
  pid = 4242;
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  kill() {
    killed.push(this.pid);
  }
}

// `namedExports` et non `exports` : sur Node 22 (le runtime de la CI) mocker un
// module BUILTIN via `exports` seul casse l'interop ESM (« The requested module
// 'node:child_process' does not provide an export named 'spawn' »), et Node 24
// refuse les deux options ensemble.
mock.module('node:child_process', {
  namedExports: {
    spawn: (_cmd: string, args: string[]) => {
      spawnCalls.push(args);
      const child = new FakeChild();
      const next = plan.shift() ?? { mode: 'close', code: 0 };
      if (next.mode === 'error') {
        queueMicrotask(() => child.emit('error', new Error(next.message)));
      } else {
        queueMicrotask(() => {
          if (next.stderr) child.stderr.emit('data', next.stderr);
          if (next.stdout) child.stdout.emit('data', next.stdout);
          child.emit('close', next.code);
        });
      }
      return child;
    },
    // `where git.exe` used by resolveGit on Windows.
    spawnSync: (_cmd: string, _args: string[]) => ({
      status: 0,
      stdout: 'C:\\Program Files\\Git\\cmd\\git.exe\n',
      stderr: '',
    }),
  },
});

const {
  runGitWithRetry,
  isForkPanicFailure,
  parseArgs,
  neutralizeAlias,
  resolveGit,
  sweepOrphanNodeProcesses,
} = await import('../scripts/git-retry.mjs');

const quiet = { log: () => {}, forwardStderr: false };

describe('isForkPanicFailure', () => {
  it('reconnaît les exit codes documentés 254 et 66', () => {
    assert.equal(isForkPanicFailure(254), true);
    assert.equal(isForkPanicFailure(66), true);
  });

  it('reconnaît les signatures stderr du fork/resource-unavailable', () => {
    assert.equal(isForkPanicFailure(1, 'fork: Resource temporarily unavailable'), true);
    assert.equal(isForkPanicFailure(1, 'sh: fork failed: Cannot allocate memory'), true);
    assert.equal(isForkPanicFailure(1, 'uv_spawn: EUNKNOWN error'), true);
  });

  it('un échec git réel n’est pas confondu avec un fork-panic', () => {
    assert.equal(isForkPanicFailure(1, ''), false);
    assert.equal(isForkPanicFailure(1, 'ESLint found errors'), false);
    assert.equal(isForkPanicFailure(0, ''), false);
  });
});

describe('sweepOrphanNodeProcesses', () => {
  it('est un no-op hors Windows', async () => {
    const n = await sweepOrphanNodeProcesses({ platform: 'linux' });
    assert.equal(n, 0);
    assert.equal(spawnCalls.length, 0);
  });

  it('n’exécute que le sweep marqué qualité, jamais tous les node.exe', async () => {
    plan = [{ mode: 'close', code: 0, stdout: '2' }];
    const n = await sweepOrphanNodeProcesses({ platform: 'win32', log: () => {} });
    assert.equal(n, 2);
    assert.equal(spawnCalls.length, 1);
    const command = spawnCalls[0].join(' ');
    assert.match(command, /quality-chain/);
    assert.match(command, /ParentProcessId/);
    assert.match(command, /CreationDate/);
    assert.match(command, /node\.exe/);
    assert.doesNotMatch(command, /Stop-Process -Name node/);
  });

  it('all: true → purge élargie, mais orphelin STRICT (parent disparu), sans filtre chaîne qualité', async () => {
    plan = [{ mode: 'close', code: 0, stdout: '3' }];
    spawnCalls = [];
    const n = await sweepOrphanNodeProcesses({ platform: 'win32', all: true, log: () => {} });
    assert.equal(n, 3);
    const command = spawnCalls[0].join(' ');
    assert.doesNotMatch(command, /quality-chain/, 'plus de filtre chaîne qualité');
    assert.match(command, /\$eligible = \$parentGone;/, 'éligible = parent disparu uniquement');
    assert.doesNotMatch(command, /\(\$parentGone -or \$old\)/, 'jamais « parent vivant mais ancien » (dev server)');
    assert.match(command, /ParentProcessId/);
    assert.match(command, /node\.exe/);
  });
});

describe('runGitWithRetry', () => {
  beforeEach(() => {
    plan = [];
    spawnCalls = [];
    killed = [];
  });

  it('succès direct → un seul spawn, exit 0, alias du sous-commande neutralisé', async () => {
    plan = [{ mode: 'close', code: 0 }];
    const code = await runGitWithRetry(['status'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 1);
    assert.deepEqual(spawnCalls[0], ['-c', 'alias.status=status', 'status']);
  });

  it('exit 254 (fork-panic) → retry puis succès au 2e spawn', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 0 },
    ];
    const code = await runGitWithRetry(['commit', '-am', 'x'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 2, 'un seul retry après la panique');
  });

  it('exit 66 (fork-panic) → retry puis succès', async () => {
    plan = [
      { mode: 'close', code: 66 },
      { mode: 'close', code: 0 },
    ];
    const code = await runGitWithRetry(['push'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 2);
  });

  it('stderr « fork: Resource temporarily unavailable » avec exit 1 → retry', async () => {
    plan = [
      { mode: 'close', code: 1, stderr: 'hint: fork: Resource temporarily unavailable\n' },
      { mode: 'close', code: 0 },
    ];
    const code = await runGitWithRetry(['commit', '-m', 'x'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 2);
  });

  it('échec git réel (exit 1, stderr propre) → AUCUN retry, code passé tel quel', async () => {
    plan = [{ mode: 'close', code: 1, stderr: 'ESLint: 3 errors\n' }];
    const code = await runGitWithRetry(['commit', '-m', 'x'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 1);
    assert.equal(spawnCalls.length, 1, 'pas de retry sur un échec réel');
  });

  it('fork-panic persistant → borné à `attempts`, dernier code retourné', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
    ];
    const code = await runGitWithRetry(['commit', '-m', 'x'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 254);
    assert.equal(spawnCalls.length, 3, 'exactement `attempts` tentatives');
  });

  it('erreur de spawn (uv_spawn EUNKNOWN) → retry puis succès', async () => {
    plan = [
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
      { mode: 'close', code: 0 },
    ];
    const code = await runGitWithRetry(['status'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 2);
  });

  it('erreur de spawn persistante → 1 sans jamais lever', async () => {
    plan = [
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
    ];
    const code = await runGitWithRetry(['status'], { ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 1);
    assert.equal(spawnCalls.length, 3);
  });

  it('attempts=1 → un seul essai, pas de retry même sur fork-panic', async () => {
    plan = [{ mode: 'close', code: 254 }];
    const code = await runGitWithRetry(['push'], { ...quiet, attempts: 1, waitMs: 1 });
    assert.equal(code, 254);
    assert.equal(spawnCalls.length, 1);
  });

  it('avec sweep → purge AVANT la première tentative aussi (succès direct)', async () => {
    plan = [{ mode: 'close', code: 0 }];
    const events: string[] = [];
    const code = await runGitWithRetry(['status'], {
      ...quiet,
      attempts: 2,
      waitMs: 1,
      sweep: true,
      sweepFn: async () => { events.push('sweep'); },
      log: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(events, ['sweep'], 'sweep avant la 1re tentative, même sans panique');
    assert.equal(spawnCalls.length, 1, 'un seul spawn git');
  });

  it('avec sweepAll → purge ÉLARGIE avant la 1re tentative (sans --sweep)', async () => {
    plan = [
      { mode: 'close', code: 0 }, // sweep élargi (powershell)
      { mode: 'close', code: 0 }, // git
    ];
    // `platform: 'win32'` : le sweep élargi réel doit spawner quelle que soit
    // la plateforme du runner (sinon no-op sur Linux/CI).
    const code = await runGitWithRetry(['status'], {
      ...quiet,
      attempts: 1,
      waitMs: 1,
      sweepAll: true,
      platform: 'win32',
    });
    assert.equal(code, 0);
    assert.equal(spawnCalls.length, 2, 'sweep puis git');
    const sweepCommand = spawnCalls[0].join(' ');
    assert.doesNotMatch(sweepCommand, /quality-chain/, 'filtre élargi à tous les node.exe');
    assert.match(sweepCommand, /\$eligible = \$parentGone;/);
    assert.deepEqual(spawnCalls[1], ['-c', 'alias.status=status', 'status']);
  });

  it('avec sweep → purge avant la 1re tentative ET entre l’échec fork et le retry', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 0 },
    ];
    const events: string[] = [];
    const code = await runGitWithRetry(['push'], {
      ...quiet,
      attempts: 2,
      waitMs: 1,
      sweep: true,
      sweepFn: async () => { events.push('sweep'); },
      log: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(events, ['sweep', 'sweep'], 'avant la 1re tentative puis avant le retry');
    assert.equal(spawnCalls.length, 2);
  });
});

describe('resolveGit', () => {
  it('GIT_RETRY_REAL_GIT a la priorité (posé par le shim git.cmd)', () => {
    assert.equal(
      resolveGit({ env: { GIT_RETRY_REAL_GIT: 'C:\\real\\git.exe' }, platform: 'win32' }),
      'C:\\real\\git.exe',
    );
  });

  it('hors Windows → « git » sans recherche', () => {
    assert.equal(resolveGit({ env: {}, platform: 'linux' }), 'git');
  });

  it('sur Windows → le premier git.exe de `where` (jamais un .cmd)', () => {
    assert.equal(resolveGit({ env: {}, platform: 'win32' }), 'C:\\Program Files\\Git\\cmd\\git.exe');
  });
});

describe('neutralizeAlias', () => {
  it('neutralise l’alias du sous-commande pour éviter la récursion wrapper → alias', () => {
    assert.deepEqual(neutralizeAlias(['commit', '-am', 'x']), ['-c', 'alias.commit=commit', 'commit', '-am', 'x']);
    assert.deepEqual(neutralizeAlias(['push', 'origin', 'main']), ['-c', 'alias.push=push', 'push', 'origin', 'main']);
  });

  it('laisse intacts les args commençant par une option (pas de sous-commande)', () => {
    assert.deepEqual(neutralizeAlias(['--version']), ['--version']);
    assert.deepEqual(neutralizeAlias(['-C', '/tmp', 'status']), ['-C', '/tmp', 'status']);
  });

  it('renvoie tel quel une liste vide', () => {
    assert.deepEqual(neutralizeAlias([]), []);
  });
});

describe('parseArgs', () => {
  it('passe les args git tels quels', () => {
    const { args } = parseArgs(['commit', '-am', 'msg']);
    assert.deepEqual(args, ['commit', '-am', 'msg']);
  });

  it('parse les options avant -- et passe le reste à git', () => {
    const { args, opts } = parseArgs(['--attempts', '5', '--wait-ms', '2000', '--', 'push', 'origin', 'main']);
    assert.deepEqual(args, ['push', 'origin', 'main']);
    assert.equal(opts.attempts, 5);
    assert.equal(opts.waitMs, 2000);
  });

  it('reconnaît --sweep sans le transmettre à git', () => {
    const { args, opts } = parseArgs(['--sweep', '--attempts=2', '--', 'push', 'origin', 'main']);
    assert.deepEqual(args, ['push', 'origin', 'main']);
    assert.equal(opts.sweep, true);
    assert.equal(opts.attempts, 2);
  });

  it('reconnaît --sweep-all sans le transmettre à git', () => {
    const { args, opts } = parseArgs(['--sweep-all', '--', 'push', 'origin', 'main']);
    assert.deepEqual(args, ['push', 'origin', 'main']);
    assert.equal(opts.sweepAll, true);
    assert.equal(opts.sweep, false, 'sweepAll est une option dédiée, pas --sweep');
  });

  it('supporte la forme --opt=valeur', () => {
    const { opts } = parseArgs(['--attempts=7', '--timeout-ms=1000', 'status']);
    assert.equal(opts.attempts, 7);
    assert.equal(opts.timeoutMs, 1000);
  });

  it('un `--` APRÈS le sous-commande reste un argument git (`git pull -- origin main`)', () => {
    // Le séparateur n'appartient au wrapper que tant qu'aucun arg git n'a été
    // vu : sinon le shim routerait `git pull -- origin main` vers
    // `git origin main`, une panne que le wrapper aurait lui-même créée.
    const { args, opts } = parseArgs(['--sweep', 'pull', '--', 'origin', 'main']);
    assert.deepEqual(args, ['pull', '--', 'origin', 'main']);
    assert.equal(opts.sweep, true);
  });
});