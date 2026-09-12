// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/automation-evidence.mjs — prouver qu'une automatisation a AGI,
// plutôt que de croire son run vert.
//
// WHY THIS EXISTS
// ---------------
// A green run is not evidence of anything. `Dependabot rebase` ran green on every
// push to main for 22 runs while doing strictly nothing: its secret was unset,
// its script took the "no token" branch and exited 0 BY DESIGN ("visible, pas
// rouge"). Nothing in the run list could tell that apart from a run that actually
// rebased three PRs. The same class of false green has bitten this repo twice
// already (the git shim installed but never on PATH, the contrast step declared
// "non applicable" while measuring nothing) — so the rule is written once here:
//
//   an automation that cannot do its job SAYS SO, with a `Inactif` annotation,
//   and the audit reads every workflow's last real run looking for it.
//
// WHY AN ANNOTATION, AND NOT A PER-WORKFLOW TABLE
// -----------------------------------------------
// "Did it act?" is not decidable from the outside: `Aucune PR en retard` is a
// successful run, `aucun token` is an inert one, and no generic heuristic
// separates them. What the automation knows — and nobody else can guess — is
// whether it was able to work. So the evidence is DECLARED at the point of
// inaction (shared helper, so producer and checker cannot drift), and the audit
// only has to look. A table maintained beside the code would be a second
// definition of each workflow's behaviour, wrong the day one changes.
//
// The audit is deliberately narrow: it judges the LAST completed run on `main`,
// and it treats "I could not read the log" as a FAILURE, never as a pass — an
// audit that cannot read its evidence is exactly the false green it hunts.
// ─────────────────────────────────────────────────────────────────────────────

/** The annotation title that means "I ran, and I could not do my job". */
export const INERT_TITLE = 'Inactif';

/**
 * The exact annotation an automation emits when it cannot act. ONE definition:
 * the producer (../rebase-dependabot-prs.mjs) and the audit both use it, so a
 * reworded message can never silently stop being detected.
 * @param {string} scope what could not run, in human words
 * @returns {string}
 */
export const inertAnnotation = (scope) => `::warning title=${INERT_TITLE}::${scope}`;

/**
 * Every inert marker in a workflow log — the scope of each one, in order.
 *
 * The log GitHub stores is prefixed per line (timestamp, step name), so the
 * marker is searched anywhere in a line rather than anchored; and a multiline
 * message keeps its first line, which is the one that names what is missing.
 *
 * @param {string} [log] the job log as downloaded
 * @returns {string[]}
 */
export function inertMarkers(log = '') {
  const text = String(log ?? '');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(`title=${INERT_TITLE}`);
    if (at === -1) continue;
    const message = line.slice(line.indexOf('::', at + `title=${INERT_TITLE}`.length) + 2).trim();
    out.push(message);
  }
  return out;
}

/**
 * How long a SCHEDULED automation may go without a completed run before it
 * counts as dormant. Eight days covers the coarsest cadence in this repo (a
 * daily cron) with room for a weekend of skipped schedules; an event-driven
 * workflow is never judged on age, only on what its last run says.
 */
export const DORMANT_ALLOWANCE_DAYS = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The verdict for ONE workflow.
 *
 * Verdicts, and why each is what it is:
 *   - `acted`     — the last completed run is green and never declared itself
 *                   unable to work. This is the only passing verdict.
 *   - `inert`     — it declared it (KO: a green run that did nothing).
 *   - `unreadable`— a run exists but its log could not be read (KO: unverifiable
 *                   is not the same as fine).
 *   - `failed`    — the run is red. Already loud, so it is reported and does not
 *                   add a second alarm; what this audit exists for is the quiet
 *                   failure mode.
 *   - `dormant`   — no completed run within the allowance. KO only for a
 *                   workflow that asked for a schedule: a cron that never fires
 *                   is broken, while a `workflow_run`/`workflow_dispatch` job
 *                   with nothing to do is simply idle.
 *   - `running`   — runs exist but none has completed yet (the audit's own first
 *                   push, typically: its own run is still going). Not a KO — and
 *                   not a hiding place either, since the dormancy allowance
 *                   catches a workflow that never completes.
 *   - `absent`    — GitHub does not know this workflow (404): the file is not on
 *                   the default branch yet. Not a KO per workflow, but an audit
 *                   where EVERY workflow is absent is a KO of its own: that is
 *                   what a token without `actions: read` looks like.
 *
 * Pure: run, anyRun, log and clock are injected.
 *
 * @param {{ file?: string, name?: string, hasSchedule?: boolean,
 *   run?: { conclusion?: string, created_at?: string } | null,
 *   anyRun?: { status?: string, created_at?: string } | null, absent?: boolean,
 *   log?: string | null, nowMs?: number, allowanceDays?: number }} input
 * @returns {{ file: string, name: string, verdict: string, ko: boolean, reason: string }}
 */
export function lastRunVerdict({
  file = '',
  name = '',
  hasSchedule = false,
  run = null,
  anyRun = null,
  absent = false,
  log = null,
  nowMs = Date.now(),
  allowanceDays = DORMANT_ALLOWANCE_DAYS,
} = {}) {
  const label = name || file;
  const base = { file, name: label };

  if (absent) {
    return {
      ...base,
      verdict: 'absent',
      ko: false,
      reason: 'inconnu de GitHub sur main (fichier pas encore poussé ?)',
    };
  }

  if (!run) {
    // A run exists but never completed: the first push of a new workflow. Saying
    // "cron en panne" here would be wrong; saying nothing at all would let a
    // permanently-stuck workflow pass, which is why the age check above still
    // applies to a scheduled one.
    if (anyRun) {
      const ageMs = nowMs - Date.parse(String(anyRun.created_at ?? ''));
      const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / DAY_MS) : null;
      const stuck = hasSchedule && ageDays !== null && ageDays > allowanceDays;
      return {
        ...base,
        verdict: stuck ? 'dormant' : 'running',
        ko: stuck,
        reason: stuck
          ? `aucun run terminé depuis ${ageDays} j (> ${allowanceDays} j autorisés pour un cron)`
          : 'aucun run terminé pour l’instant (le premier est en cours)',
      };
    }
    return {
      ...base,
      verdict: hasSchedule ? 'dormant' : 'idle',
      ko: hasSchedule,
      reason: hasSchedule
        ? `planifié, mais aucun run terminé sur main — un cron qui ne part pas est en panne`
        : `aucun run terminé sur main (déclenchement par événement : rien à juger tant qu'il n'a pas tourné)`,
    };
  }

  const ageMs = nowMs - Date.parse(String(run.created_at ?? ''));
  const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / DAY_MS) : null;
  if (hasSchedule && ageDays !== null && ageDays > allowanceDays) {
    return {
      ...base,
      verdict: 'dormant',
      ko: true,
      reason: `dernier run il y a ${ageDays} j (> ${allowanceDays} j autorisés pour un cron)`,
    };
  }

  if (run.conclusion && run.conclusion !== 'success') {
    return { ...base, verdict: 'failed', ko: false, reason: `dernier run ${run.conclusion} — déjà visible` };
  }

  if (typeof log !== 'string' || log.trim().length === 0) {
    return {
      ...base,
      verdict: 'unreadable',
      ko: true,
      reason: 'run vert, mais journal illisible — invérifiable n’est pas un vert',
    };
  }

  const markers = inertMarkers(log);
  if (markers.length > 0) {
    return {
      ...base,
      verdict: 'inert',
      ko: true,
      reason: `vert sans avoir agi : ${markers[0]}${markers.length > 1 ? ` (+${markers.length - 1})` : ''}`,
    };
  }

  return { ...base, verdict: 'acted', ko: false, reason: 'vert et n’a jamais déclaré ne pas avoir pu agir' };
}

/**
 * The whole audit. `ok` is true only when there was something to judge AND every
 * workflow acted: a list of zero workflows is a FAILURE, because an audit that
 * examined nothing is the green it is supposed to prevent.
 * @param {{ workflows?: object[], nowMs?: number, allowanceDays?: number }} [input]
 */
export function auditAutomations({ workflows = [], nowMs = Date.now(), allowanceDays } = {}) {
  const results = workflows.map((w) => lastRunVerdict({ ...w, nowMs, allowanceDays }));
  const ko = results.filter((r) => r.ko);
  // An audit that can see NO workflow at all cannot be green: that is what a
  // token without `actions: read` produces, and it looks exactly like a clean
  // repository. One readable workflow is enough to say the read works; if none
  // is, the finding is about the audit itself.
  if (results.length > 0 && results.every((r) => r.verdict === 'absent')) {
    return {
      results,
      ko: [
        {
          file: '',
          name: '(lecture)',
          verdict: 'unreadable',
          ko: true,
          reason:
            'aucun workflow n’est connu de GitHub : le token ne voit rien. ' +
            'Ajoutez `actions: read` — un audit aveugle n’est pas un audit vert.',
        },
      ],
      ok: false,
    };
  }
  if (results.length === 0) {
    return {
      results,
      ko: [
        {
          file: '',
          name: '(aucune)',
          verdict: 'empty',
          ko: true,
          reason: 'aucun workflow lu : un audit qui n’examine rien n’est pas un vert',
        },
      ],
      ok: false,
    };
  }
  return { results, ko, ok: ko.length === 0 };
}

/** The verdict labels as printed, without the marker they came from. */
export const VERDICT_ICON = {
  acted: '✅',
  inert: '❌',
  unreadable: '❌',
  dormant: '❌',
  failed: '⚠️ ',
  running: '⏳',
  absent: '➖',
  idle: '➖',
  empty: '❌',
};

/**
 * Read a workflow file's audited facts: its name and whether it asked for a
 * schedule. Parsed from the file text (CRLF-tolerant — the repo's workflows are
 * CRLF, and a `\r` left in a captured value is exactly the bug that once made a
 * CI guard read 5 % of the workflows).
 * @param {string} text
 * @param {{ file?: string }} [meta]
 * @returns {{ file: string, name: string, hasSchedule: boolean }}
 */
export function parseWorkflowFile(text = '', { file = '' } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const nameLine = lines.find((l) => /^name:\s*\S/.test(l));
  const name = nameLine ? nameLine.replace(/^name:\s*/, '').trim() : file;
  const hasSchedule = lines.some((l) => /^\s{2}schedule:\s*$/.test(l) || /^\s{2}schedule:\s*\S/.test(l));
  return { file, name, hasSchedule };
}
