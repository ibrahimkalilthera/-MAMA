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
//   an automation that cannot do its job SAYS SO, with an `[inactif]` marker in
//   its log, and the audit reads every workflow's last real run looking for it.
//
// A NOTE ON WHERE THE MARKER LIVES
// -------------------------------
// Not in the annotation title. The runner stores `##[warning]message` and drops
// the title, so a title-only contract looked correct, tested green, and would
// have missed the very run it exists for (see INERT_MARK).
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
 * The marker that actually travels in the LOG, and the reason it is not the
 * title.
 *
 * Measured, not assumed: the runner intercepts `::warning title=…::message` and
 * stores `##[warning]message` — the title never reaches the log the audit reads
 * (run 34669815903 of `dependabot-rebase.yml`, green, declared inert, and
 * invisible to a title-based check for exactly that reason). A marker that only
 * exists in the title is a marker no audit can find, which is worse than no
 * marker at all: it makes a dead automation look verified. So the marker lives
 * in the MESSAGE, where GitHub provably keeps it, and the title stays for the
 * Actions UI (which does render it).
 */
export const INERT_MARK = '[inactif]';

/**
 * Le canal de preuve STRUCTURÉ : une ligne JSON, préfixée, qui nomme le workflow
 * dont elle parle.
 *
 * Mesuré : le 2026-09-12, l'audit a déclaré `Quality & performance guard` « vert
 * sans avoir agi » avec le motif de `Dependabot rebase`. La marque textuelle
 * n'était pas émise par ce workflow : `npm test` importait le script Dependabot,
 * dont le `main()` imprimait l'annotation dans le journal du job de tests — que
 * l'audit relit. Un mot dans un journal ne dit pas QUI parle.
 *
 * Donc la preuve porte son sujet. L'audit ne compte une déclaration que si le
 * `workflow` de la ligne est celui du journal qu'il est en train de lire ; une
 * ligne étrangère est IGNORÉE et NOMMÉE. C'est la différence entre « quelqu'un a
 * écrit [inactif] ici » et « dependabot-rebase.yml déclare qu'il n'a pas pu
 * agir » — et la seconde seule est un fait.
 *
 * La ligne est volontairement un préfixe nu, pas une commande `::…::` : le
 * runner ne la réécrit pas, ce qu'elle porte reste exactement ce que le script a
 * écrit.
 */
export const EVIDENCE_PREFIX = 'AUTOMATION-EVIDENCE ';

/**
 * La ligne de preuve, composée à UN endroit (producteur et audit partagent la
 * définition, comme pour la marque).
 * @param {{ workflow: string, acted: boolean, reason?: string }} input
 * @returns {string}
 */
export const evidenceLine = ({ workflow, acted, reason = '' }) =>
  EVIDENCE_PREFIX + JSON.stringify({ workflow, acted, reason });

/**
 * The exact annotation an automation emits when it cannot act. ONE definition:
 * the producer (../rebase-dependabot-prs.mjs) and the audit both use it, so a
 * reworded message can never silently stop being detected.
 * @param {string} scope what could not run, in human words
 * @returns {string}
 */
export const inertAnnotation = (scope) =>
  `::warning title=${INERT_TITLE}::${INERT_MARK} ${scope}`;

/**
 * Ce qu'un runner écrit quand il INTERCEPTE une commande de workflow : le
 * niveau, puis le message. C'est la seule forme sous laquelle une annotation
 * émise survit dans le journal.
 */
const STORED_ANNOTATION = /##\[[a-z]+\]$/;

/**
 * Every inert marker a workflow DECLARED in its log — the scope of each one, in
 * order.
 *
 * The log GitHub stores is prefixed per line (timestamp, step name), so the
 * marker is searched anywhere in a line rather than anchored; and a multiline
 * message keeps its first line, which is the one that names what is missing.
 *
 * The mark — not the annotation title — is what is searched (see INERT_MARK),
 * AND it only counts when the runner STORED it, i.e. right after `##[warning]`.
 * That second condition was paid for by a real false positive: the marker is
 * plain text in a log, so anything that merely PRINTS the string is
 * indistinguishable from an automation declaring its own inaction. Measured on
 * this repo: `npm test` imports the Dependabot script, whose former top-level
 * `main()` printed the annotation without a token — so every job that ran the
 * suite declared `Dependabot rebase` inert, and the audit reported `Quality &
 * performance guard` as "green without having acted" on the strength of a test
 * fixture. The emitter was fixed at the source; requiring the stored form is
 * what makes the class impossible: an emitted command is REWRITTEN by the
 * runner into `##[warning]message` (that is the same measurement that moved the
 * mark out of the annotation title), while a string that only contains the
 * command stays exactly as printed.
 *
 * @param {string} [log] the job log as downloaded
 * @returns {string[]}
 */
/**
 * Les lignes de preuve structurée d'un journal, dans l'ordre.
 *
 * Trois issues, et la troisième est un ÉCHEC : une ligne au préfixe connu mais
 * au JSON illisible ne peut pas dire de qui elle parle, donc elle ne peut pas
 * être ignorée — « je n'ai pas pu lire la preuve » n'est pas « il n'y a pas de
 * preuve » (c'est la règle qui a déjà coûté un faux vert dans ce dépôt).
 *
 * @param {string} [log]
 * @returns {{ workflow: string|null, acted: boolean|null, reason: string, raw: string }[]}
 */
export function evidenceRecords(log = '') {
  const text = String(log ?? '');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(EVIDENCE_PREFIX);
    if (at === -1) continue;
    const raw = line.slice(at + EVIDENCE_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(raw);
      out.push({
        workflow: typeof parsed?.workflow === 'string' ? parsed.workflow : null,
        acted: typeof parsed?.acted === 'boolean' ? parsed.acted : null,
        reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
        raw,
      });
    } catch {
      out.push({ workflow: null, acted: null, reason: 'ligne de preuve illisible (JSON invalide)', raw });
    }
  }
  return out;
}

export function inertMarkers(log = '') {
  const text = String(log ?? '');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    for (let at = line.indexOf(INERT_MARK); at !== -1; at = line.indexOf(INERT_MARK, at + 1)) {
      if (!STORED_ANNOTATION.test(line.slice(0, at))) continue;
      out.push(line.slice(at + INERT_MARK.length).trim());
    }
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

/**
 * Combien de temps on accepte qu'un journal ne soit PAS ENCORE publié.
 *
 * Mesuré le 2026-09-12 : l'audit se déclenche sur le même push que les
 * workflows qu'il juge, et il a lu `logs 404` pour `PDF E2E` et `Deploy` —
 * quelques secondes plus tard, les mêmes journaux répondaient 200. GitHub
 * archive le journal APRÈS avoir marqué le run terminé : pendant cette fenêtre,
 * un 404 ne dit rien du contenu, il dit que la plateforme n'a pas encore
 * publié.
 *
 * Donc on distingue deux cas, et c'est la seule façon de ne pas produire de
 * faux rouge : un 404 sur un run RÉCENT est `pending` (⏳, pas un échec) ; le
 * même 404 au-delà de ce délai est `unreadable` (❌) — un journal qui manque
 * encore une demi-heure après coup est un vrai problème, pas une course.
 * Un rouge permanent pour une course de plateforme entraînerait exactement ce
 * que ce dépôt combat ailleurs : des gens qui apprennent à ignorer le rouge.
 */
export const LOG_GRACE_MS = 15 * 60 * 1000;

/** Combien de fois on retente un journal 404 avant de conclure (espacé de 3 s). */
export const LOG_FETCH_ATTEMPTS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The verdict for ONE workflow.
 *
 * Verdicts, and why each is what it is:
 *   - `acted`     — the last completed run is green and never declared itself
 *                   unable to work. This is the only passing verdict.
 *   - `inert`     — it declared it (KO: a green run that did nothing).
 *   - `unreadable`— a run exists but its log could not be read (KO: unverifiable
 *                   is not the same as fine) — au-delà de la fenêtre de
 *                   publication des journaux.
 *   - `pending`   — journal pas ENCORE publié par la plateforme (404 sur un run
 *                   récent). Ni vert ni rouge, et jamais silencieux : le
 *                   rapport le nomme. Voir LOG_GRACE_MS.
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
 *   log?: string | null, logsUnavailable?: boolean, workflow?: string,
 *   nowMs?: number, allowanceDays?: number, logGraceMs?: number }} input
 * @returns {{ file: string, name: string, verdict: string, ko: boolean, reason: string, foreign?: string[] }}
 */
export function lastRunVerdict({
  file = '',
  name = '',
  hasSchedule = false,
  run = null,
  anyRun = null,
  absent = false,
  log = null,
  logsUnavailable = false,
  workflow = '',
  nowMs = Date.now(),
  allowanceDays = DORMANT_ALLOWANCE_DAYS,
  logGraceMs = LOG_GRACE_MS,
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
    // Un journal 404 sur un run RÉCENT n'est pas une preuve de faux vert :
    // GitHub n'a pas encore publié le fichier (voir LOG_GRACE_MS). Sur un run
    // plus ancien, le même 404 devient un vrai constat.
    //
    // L'âge se compare en MILLISECONDES, pas en jours entiers : la fenêtre fait
    // 15 min, donc `Math.floor(ageMs / jour)` l'arrondissait à 0 et rendait
    // TOUT run du jour « jeune » — la borne n'existait plus, et un journal
    // disparu définitivement serait resté `pending` pour toujours.
    const young = logGraceMs > 0 && (!Number.isFinite(ageMs) || ageMs <= logGraceMs);
    if (logsUnavailable && young) {
      return {
        ...base,
        verdict: 'pending',
        ko: false,
        reason: 'run terminé récemment — journal pas encore publié par la plateforme (rien à en déduire)',
      };
    }
    return {
      ...base,
      verdict: 'unreadable',
      ko: true,
      reason: 'run vert, mais journal illisible — invérifiable n’est pas un vert',
    };
  }

  // 1. La preuve STRUCTURÉE, et seulement si elle parle de CE workflow : c'est
  //    la ligne qui porte son sujet, donc une copie imprimée ailleurs ne peut
  //    plus faire accuser le mauvais (l'incident du 2026-09-12, en entier).
  const records = evidenceRecords(log);
  const unreadable = records.filter((r) => r.acted === null);
  if (unreadable.length > 0) {
    // Un préfixe connu au contenu illisible ne peut pas dire de qui il parle :
    // il ne peut donc pas être ignoré (invérifiable n'est pas un vert).
    return {
      ...base,
      verdict: 'unreadable',
      ko: true,
      reason: `preuve structurée illisible — ${unreadable[0].reason}`,
    };
  }

  const subject = workflow || file;
  const foreign = [
    ...new Set(records.filter((r) => r.workflow !== subject).map((r) => r.workflow ?? '(sans nom)')),
  ];
  const mine = records.filter((r) => r.workflow === subject);
  if (mine.length > 0) {
    const unacted = mine.filter((r) => r.acted === false);
    return unacted.length > 0
      ? {
          ...base,
          verdict: 'inert',
          ko: true,
          reason: `vert sans avoir agi : ${unacted[0].reason}`,
          foreign,
        }
      : {
          ...base,
          verdict: 'acted',
          ko: false,
          reason: 'preuve structurée : a agi',
          foreign,
        };
  }

  // 2. Repli sur la marque textuelle, pour un automatisme pas encore migré. Elle
  //    reste un échec — l'ignorer rendrait vert, pour un run, une automatisation
  //    qui vient de déclarer son inaction.
  const markers = inertMarkers(log);
  if (markers.length > 0) {
    return {
      ...base,
      verdict: 'inert',
      ko: true,
      reason: `vert sans avoir agi (marque textuelle, à migrer vers le canal structuré) : ${markers[0]}${markers.length > 1 ? ` (+${markers.length - 1})` : ''}`,
      foreign,
    };
  }

  return {
    ...base,
    verdict: 'acted',
    ko: false,
    reason: 'vert et n’a jamais déclaré ne pas avoir pu agir',
    foreign,
  };
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
  pending: '⏳',
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
