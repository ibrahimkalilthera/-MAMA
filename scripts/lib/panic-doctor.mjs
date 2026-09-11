// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/panic-doctor.mjs — the MACHINE state around the msys fork panic,
// in one command: which node.exe exist, how old they are, whose parent is gone,
// which guards are still running, and what the journal measured.
//
// WHY A DOCTOR AND NOT A PURGE
// ----------------------------
// The purge (./orphan-node.mjs, ./orphan-guard.mjs, the `--sweep` of
// ../git-retry.mjs) decides and kills. This module only LOOKS. That separation
// is the point: the panic has been diagnosed by feel for months ("an orphaned
// node.exe left by a hard timeout"), and the measurements that corrected that
// story (a non-detached child dies with its parent; the reachable orphan is the
// detached one or a wrapper whose sh.exe died) came from looking at a real
// machine, not from reasoning. So the doctor prints the raw facts — pid, parent,
// age, memory, command — and says SEPARATELY what it concludes, each conclusion
// naming the command that would act on it.
//
// Read-only, always: there is no kill in this file, and a test asserts it.
//
// Two labels carry the whole diagnosis:
//   - ELIGIBLE (the selective sweep's own definition, shared with
//     ../git-retry.mjs through KNOWN_CHAIN_WRAPPER_PATTERN — one definition, so
//     the doctor can never describe a rule the sweep does not apply);
//   - PARENT GONE (the parent pid is not in the process list any more).
// An eligible wrapper whose parent is gone is a real leftover. Anything else is
// printed and left alone: a dev server, another agent's chain, an editor's
// language server. The purge is anchored on lineage and creation stamps, so
// those can never be touched — the doctor says so instead of implying it.
// ─────────────────────────────────────────────────────────────────────────────
import { matchesKnownChainWrapper, summarizeSweepLog } from './orphan-node.mjs';

/** Chrome/Electron leftovers: swept before every chain step, counted here. */
export const CHROME_LIKE_NAMES = ['chrome.exe', 'electron.exe', 'msedge.exe'];

/** The detached cleaner: alive guards are expected, not a leak. */
export const GUARD_SCRIPT = 'orphan-guard.mjs';

/** NODE_PRESSURE: above this, the fork table is a plausible suspect. */
export const NODE_PRESSURE_THRESHOLD = 40;

/**
 * PowerShell that prints every process (pid, parent, name, creation stamp,
 * working set, command line) then one memory line. `Get-CimInstance` rather
 * than `tasklist`: the command line and the creation stamp are what make the
 * analysis possible, and neither is available otherwise.
 * Pure: asserted without spawning.
 * @returns {string}
 */
export function buildMachineSnapshotScript() {
  return [
    `foreach ($p in @(Get-CimInstance Win32_Process)) {`,
    `Write-Output ('PID=' + $p.ProcessId + ';PPID=' + $p.ParentProcessId + ';NAME=' + $p.Name` +
      ` + ';BORN=' + $(if ($null -ne $p.CreationDate) { $p.CreationDate.ToString('o') } else { '' })` +
      ` + ';MEM=' + [long]$p.WorkingSetSize + ';CMD=' + ([string]$p.CommandLine -replace '[\r\n]+', ' '))`,
    `}`,
    `$os = Get-CimInstance Win32_OperatingSystem;`,
    `Write-Output ('MEMFREE=' + ([long]$os.FreePhysicalMemory * 1024) + ';MEMTOTAL=' + ([long]$os.TotalVisibleMemorySize * 1024))`,
  ].join(' ');
}

/**
 * Parse the snapshot. Unparsable lines are dropped — a diagnostic never gates
 * on a process disappearing between two queries (that is normal, not an error).
 * @param {string} [stdout]
 * @returns {{ processes: { pid: number, ppid: number, name: string, born: string, memMb: number, cmd: string }[],
 *   memory: { freeBytes: number|null, totalBytes: number|null } }}
 */
export function parseMachineSnapshot(stdout = '') {
  const processes = [];
  let memory = { freeBytes: null, totalBytes: null };
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const mem = line.match(/MEMFREE=(\d+);MEMTOTAL=(\d+)/);
    if (mem) {
      memory = { freeBytes: Number(mem[1]), totalBytes: Number(mem[2]) };
      continue;
    }
    const m = line.match(
      /PID=(\d+);PPID=(\d+);NAME=([^;]*);BORN=([^;]*);MEM=(\d+);CMD=(.*)$/,
    );
    if (!m) continue;
    processes.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: m[3],
      born: m[4],
      memMb: Math.round(Number(m[5]) / 1024 ** 2),
      cmd: m[6].trim(),
    });
  }
  return { processes, memory };
}

/**
 * Human age, coarse on purpose: a diagnosis that says "3 min" and not
 * "3 min 14 s" is easier to trust at a glance.
 * @param {string} born ISO stamp from the snapshot ('' when unknown)
 * @param {number} nowMs
 * @returns {string}
 */
export function describeAge(born, nowMs) {
  const t = Date.parse(String(born ?? ''));
  if (!Number.isFinite(t)) return 'âge inconnu';
  const seconds = Math.max(0, Math.round((nowMs - t) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

/**
 * The command line, reduced to the one token that identifies the process.
 *
 * The SCRIPT beats the interpreter on purpose: `"C:\Program Files\nodejs\
 * \node.exe" C:\repo\scripts\sweep-report.mjs` says nothing as `node.exe` and
 * everything as `sweep-report.mjs` — and the interpreter is the same for every
 * process on the machine.
 */
export function shortCommand(cmd, { max = 70 } = {}) {
  const text = String(cmd ?? '').trim();
  if (!text) return '(ligne de commande illisible)';
  const paths = [
    ...text.matchAll(/(?:[^\s"']*[\\/])?([^\\/\s"']+\.(?:[cm]?[jt]sx?|cmd|exe|ps1))/g),
  ].map((m) => m[1]);
  const script = paths.find((name) => /\.(?:[cm]?[jt]sx?)$/.test(name));
  const label = script ?? paths[0] ?? text.split(/\s+/)[0];
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * The whole analysis, pure: facts in, findings out. No I/O, no clock of its
 * own (the caller passes `nowMs`), so every branch below is asserted in tests.
 *
 * @param {{ processes?: object[], memory?: object, journal?: object[], nowMs?: number }} [input]
 */
export function diagnose({ processes = [], memory = {}, journal = [], nowMs = Date.now() } = {}) {
  const list = processes.filter((p) => p && Number.isInteger(p.pid) && p.pid > 0);
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const alivePid = (pid) => Number.isInteger(pid) && pid > 0 && byPid.has(pid);

  const nodes = list.filter((p) => String(p.name).toLowerCase() === 'node.exe');
  const withAge = (p) => ({ ...p, age: describeAge(p.born, nowMs), parentGone: !alivePid(p.ppid) });

  const guards = nodes
    .filter((p) => String(p.cmd).includes(GUARD_SCRIPT))
    .map((p) => {
      // `node orphan-guard.mjs <watchedPid>` (or `--relay <pid>`): the pid it is
      // watching is the whole reason it is alive.
      const watched = Number(String(p.cmd).match(new RegExp(`${GUARD_SCRIPT.replace('.', '\\.')}\\s+(?:--relay\\s+)?(\\d+)`))?.[1]);
      return {
        ...withAge(p),
        watchedPid: Number.isInteger(watched) ? watched : null,
        watchedAlive: Number.isInteger(watched) ? alivePid(watched) : null,
      };
    });

  const chainProcesses = nodes
    .filter((p) => !String(p.cmd).includes(GUARD_SCRIPT))
    .filter((p) => matchesKnownChainWrapper(p.cmd))
    .map((p) => ({ ...withAge(p), eligible: true, kind: 'chain' }));

  const otherNode = nodes
    .filter((p) => !String(p.cmd).includes(GUARD_SCRIPT))
    .filter((p) => !matchesKnownChainWrapper(p.cmd))
    .map((p) => ({ ...withAge(p), eligible: false, kind: 'other' }));

  const chromeLike = list.filter((p) =>
    CHROME_LIKE_NAMES.includes(String(p.name).toLowerCase()),
  );

  // What the selective sweep would actually kill: eligible AND its parent is
  // gone. A chain process that is still attached to a living parent is WORKING,
  // not an orphan (the sweep checks the same two things).
  const chainOrphans = chainProcesses.filter((p) => p.parentGone);
  const chainAttached = chainProcesses.filter((p) => !p.parentGone);

  const purgeableOrphans = nodes.filter((p) => {
    const isGuard = String(p.cmd).includes(GUARD_SCRIPT);
    return !isGuard && !alivePid(p.ppid) && matchesKnownChainWrapper(p.cmd);
  });

  const stats = summarizeSweepLog(journal);
  const recentPanics = journal.filter(
    (e) => e && e.kind === 'panic' && Number.isFinite(Date.parse(String(e.at)))
      && nowMs - Date.parse(String(e.at)) <= 24 * 60 * 60 * 1000,
  );

  const verdicts = [];
  if (chainOrphans.length > 0) {
    verdicts.push({
      level: 'alarm',
      text:
        `${chainOrphans.length} orphelin(s) de chaîne qualité (parent disparu) — c'est exactement ce que le sweep ` +
        `sélectif prend : \`npm run git:retry -- --sweep -- status\` (ou --sweep-all pour élargir).`,
    });
  }
  const stuckGuards = guards.filter((g) => g.watchedAlive === false);
  if (guards.length > 0) {
    verdicts.push({
      level: stuckGuards.length > 0 ? 'warn' : 'info',
      text:
        `${guards.length} garde(s) détaché(s) actif(s) : normal pendant une chaîne, suspect sinon` +
        (stuckGuards.length > 0
          ? ` — ${stuckGuards.length} surveillent un pid déjà mort et devraient sortir d'eux-mêmes.`
          : '.'),
    });
  }
  if (purgeableOrphans.length === 0 && chainOrphans.length === 0) {
    verdicts.push({ level: 'ok', text: 'Aucun orphelin de chaîne qualité : rien à purger.' });
  }
  if (nodes.length > NODE_PRESSURE_THRESHOLD) {
    verdicts.push({
      level: 'warn',
      text:
        `${nodes.length} node.exe vivants (> ${NODE_PRESSURE_THRESHOLD}) : la table de fork msys est chargée — ` +
        `c'est le terrain de la panique, pas nécessairement sa cause.`,
    });
  }
  if (recentPanics.length > 0) {
    verdicts.push({
      level: 'warn',
      text:
        `${recentPanics.length} fork-panic(s) journalisée(s) sur les dernières 24 h` +
        (recentPanics[recentPanics.length - 1]?.git ? ` (dernière : git ${recentPanics[recentPanics.length - 1].git}).` : '.'),
    });
  } else if (stats.purges.count > 0) {
    verdicts.push({
      level: 'ok',
      text: `Aucune panique journalisée sur 24 h (${stats.purges.count} purge(s) enregistrée(s), ${stats.purges.killed} tué(s)).`,
    });
  }
  if (chromeLike.length > 0) {
    verdicts.push({
      level: 'warn',
      text:
        `${chromeLike.length} processus chrome/electron restants : ils saturent la table de fork autant que les ` +
        `node.exe, et la chaîne les purge avant sa première étape (\`npm run quality\`).`,
    });
  }
  if (otherNode.some((p) => p.parentGone)) {
    verdicts.push({
      level: 'info',
      text:
        'Des node.exe étrangers ont un parent disparu : ils sont laissés tels quels — la purge ne tue que ce ' +
        'qu\'une exécution a créé (pid + horodatage de création).',
    });
  }

  return {
    counts: {
      processes: list.length,
      node: nodes.length,
      chainAttached: chainAttached.length,
      chainOrphans: chainOrphans.length,
      guards: guards.length,
      chromeLike: chromeLike.length,
    },
    memory,
    chainOrphans,
    chainAttached,
    otherNode,
    guards,
    chromeLike: chromeLike.map(withAge),
    biggestNode: [...nodes]
      .sort((a, b) => (b.memMb ?? 0) - (a.memMb ?? 0))
      .slice(0, 5)
      .map(withAge),
    journal: stats,
    verdicts,
  };
}

/** Render the diagnosis as printable lines (the CLI only joins and prints). */
export function formatDiagnosis(diagnosis, { nowMs = Date.now() } = {}) {
  const { counts, memory } = diagnosis;
  const lines = [];
  const gb = (bytes) => (Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} Go` : '?');
  lines.push(
    `🩺 État machine — ${counts.processes} processus, ${counts.node} node.exe` +
      (memory.freeBytes != null ? `, mémoire libre ${gb(memory.freeBytes)}/${gb(memory.totalBytes)}` : ''),
  );
  lines.push(
    `   chaîne qualité : ${counts.chainAttached} en cours, ${counts.chainOrphans} orphelin(s) · ` +
      `gardes : ${counts.guards} · chrome/electron restants : ${counts.chromeLike}`,
  );

  if (diagnosis.chainOrphans.length > 0) {
    lines.push('   orphelins de chaîne qualité (le sweep sélectif les prend) :');
    for (const p of diagnosis.chainOrphans) {
      lines.push(`     pid ${p.pid} · ${p.age} · ${p.memMb} Mo · parent ${p.ppid} disparu · ${shortCommand(p.cmd)}`);
    }
  }
  if (diagnosis.guards.length > 0) {
    lines.push('   gardes détachés :');
    for (const g of diagnosis.guards) {
      const watched =
        g.watchedPid == null ? 'pid surveillé illisible' : `${g.watchedPid} ${g.watchedAlive ? 'vivant' : 'MORT (le garde devrait sortir)'}`;
      lines.push(`     pid ${g.pid} · ${g.age} · surveille ${watched}`);
    }
  }
  const strangers = diagnosis.otherNode.filter((p) => p.parentGone);
  if (strangers.length > 0) {
    lines.push('   node.exe étrangers à parent disparu (jamais touchés) :');
    for (const p of strangers.slice(0, 8)) {
      lines.push(`     pid ${p.pid} · ${p.age} · ${shortCommand(p.cmd)}`);
    }
    if (strangers.length > 8) lines.push(`     … +${strangers.length - 8}`);
  }
  if (diagnosis.biggestNode.length > 0) {
    lines.push('   plus gros node.exe :');
    for (const p of diagnosis.biggestNode) {
      lines.push(`     pid ${p.pid} · ${p.memMb} Mo · ${p.age} · ${shortCommand(p.cmd)}`);
    }
  }

  const { journal } = diagnosis;
  lines.push(
    `   journal : ${journal.purges.count} purge(s), dont ${journal.purges.nonEmpty} avec des orphelins ` +
      `(${journal.purges.killed} tués${journal.purges.failed > 0 ? `, ${journal.purges.failed} échec(s)` : ''}) · ` +
      `${journal.panics.count} fork-panic(s)`,
  );

  for (const v of diagnosis.verdicts) {
    const icon = v.level === 'alarm' ? '❌' : v.level === 'warn' ? '⚠️ ' : v.level === 'info' ? 'ℹ️ ' : '✅';
    lines.push(`${icon} ${v.text}`);
  }
  lines.push('   (diagnostic en lecture seule — rien n’a été tué ; `npm run orphans:report` pour l’historique)');
  return lines;
}
