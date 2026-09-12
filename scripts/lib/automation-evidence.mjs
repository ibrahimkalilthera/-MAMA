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
//   an automation PUBLISHES a proof of what it did, and the audit reads that
//   proof — never the text of a log.
//
// POURQUOI UNE ANNOTATION, ET PLUS DES JOURNAUX
// --------------------------------------------
// La preuve a d'abord voyagé dans le JOURNAL (une ligne préfixée, ou une marque
// `[inactif]` stockée par le runner). Ce transport marchait, et il a coûté trois
// défauts mesurés, tous de la même famille — lire du texte n'est pas lire un
// fait :
//
//   • le runner RÉÉCRIT ce qui traverse son journal (le titre disparaît, il ne
//     reste qu'un niveau et le message) : un contrat posé dans le titre a été
//     vert, testé, et aveugle sur le run même qu'il visait ;
//   • n'importe quoi qui IMPRIME la marque se fait passer pour l'automatisation :
//     `npm test` importait le script Dependabot, dont le `main()` imprimait la
//     déclaration d'inaction dans le journal du job de tests, et l'audit a
//     accusé `Quality & performance guard` avec le motif de Dependabot ;
//   • GitHub n'archive un journal qu'APRÈS avoir marqué le run terminé : l'audit
//     — déclenché par le même push que ce qu'il juge — lisait `logs 404` sur des
//     runs verts qui venaient de finir, d'où une fenêtre de grâce, des
//     tentatives, un verdict `pending`… de la mécanique pour contourner un
//     support fait pour être recopié.
//
// Les ANNOTATIONS d'un run sont, elles, des champs structurés (`title`,
// `message`, `annotation_level`) que le runner STOCKE au moment où le job se
// termine : rien à recopier, rien à réécrire, disponibles tout de suite, et le
// sujet est forcé à la source (le producteur ne peut déclarer que le workflow
// qui tourne — voir publish-automation-evidence.mjs). L'audit ne lit donc plus
// un seul octet de journal.
//
// ET LE CONTRAT SE VOIT DANS LE RUN LUI-MÊME
// ------------------------------------------
// Une preuve absente n'a pas le même sens selon que le run l'avait promise ou
// non : les runs antérieurs à ce canal ne pouvaient rien publier. Plutôt qu'une
// fenêtre de tolérance devinée, l'audit lit les ÉTAPES du job (l'API les rend) :
// si l'étape de preuve existait dans la révision du run et n'a pas abouti, c'est
// un échec ; si elle n'existait pas, le run est jugé `legacy` — nommé, non
// bloquant, et le contrat s'applique de lui-même au run suivant.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le titre de l'annotation qui porte la preuve. Sélecteur stable : l'audit ne
 * compte que les annotations qui portent ce titre, donc un avertissement
 * ordinaire d'un job (lint, Node déprécié…) ne devient jamais une preuve.
 */
export const EVIDENCE_TITLE = 'Automation evidence';

// LA MARQUE TEXTUELLE A ÉTÉ RETIRÉE (2026-09-12) — et c'est la fin d'une
// migration, pas un nettoyage cosmétique. `AUTOMATION-EVIDENCE ` restait dans le
// MESSAGE parce que le canal précédent était un JOURNAL : il fallait y
// reconnaître sa ligne. Le canal est désormais STRUCTURÉ — le titre sélectionne,
// le message EST le payload — donc la marque n'avait plus qu'un effet : rendre
// croyable une ligne IMPRIMÉE. C'est précisément le défaut qui a fait accuser le
// mauvais workflow (une suite de tests imprimait la déclaration de Dependabot,
// qui se lisait comme une déclaration). Plus de marque, plus rien à imiter :
// une preuve se lit dans le champ STOCKÉ, jamais dans ce qui y ressemble.

/**
 * Le nom de l'étape qui publie la preuve, dans chaque workflow.
 *
 * C'est un CONTRAT, pas une décoration : l'audit reconnaît à ce nom si le run
 * avait promis une preuve (les étapes d'un job sont rendues par l'API). Un
 * workflow qui la publie sans employer ce nom serait jugé « antérieur au
 * contrat » — donc jamais exigé, ce qui est exactement le trou que ce module
 * ferme.
 */
export const EVIDENCE_STEP_NAME = 'Publier la preuve d’action';

/**
 * Le payload d'une preuve, composé à UN endroit (producteur et audit partagent
 * la définition : un message reformulé ne peut pas cesser silencieusement d'être
 * reconnu).
 * @param {{ workflow: string, acted: boolean, reason?: string, count?: number|null }} input
 * @returns {string}
 */
export function evidencePayload({ workflow, acted, reason = '', count = null }) {
  const payload = { workflow, acted, reason };
  if (Number.isInteger(count)) payload.count = count;
  return JSON.stringify(payload);
}

/**
 * La commande d'annotation qu'un job imprime — c'est ELLE que le runner stocke
 * en champs structurés.
 *
 * `notice` quand l'automatisation a agi, `warning` quand elle déclare ne pas
 * avoir pu : le niveau est pour l'humain qui survole l'onglet Actions (une
 * inaction doit se voir), le verdict de l'audit vient du payload, jamais de la
 * couleur.
 * @param {{ workflow: string, acted: boolean, reason?: string, count?: number|null }} input
 * @returns {string}
 */
export function evidenceAnnotation(input) {
  const level = input?.acted ? 'notice' : 'warning';
  return `::${level} title=${EVIDENCE_TITLE}::${evidencePayload(input)}`;
}

/**
 * Les preuves publiées par un run, lues dans ses ANNOTATIONS.
 *
 * Trois issues, et la troisième est un ÉCHEC : une annotation au bon titre mais
 * au message illisible ne peut pas dire de qui elle parle, donc elle ne peut pas
 * être ignorée — « je n'ai pas pu lire la preuve » n'est pas « il n'y a pas de
 * preuve » (règle déjà payée une fois dans ce dépôt).
 *
 * @param {{ title?: string, message?: string }[]} [annotations]
 * @returns {{ workflow: string|null, acted: boolean|null, reason: string, count: number|null, raw: string }[]}
 */
export function evidenceFromAnnotations(annotations = []) {
  const out = [];
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (annotation?.title !== EVIDENCE_TITLE) continue;
    const message = String(annotation.message ?? '');
    // Le message EST le JSON. La découpe aux accolades est une TOLÉRANCE envers
    // la mise en forme du runner (qui stocke le message tel quel), pas une marque
    // à écrire : il n'y a plus un seul caractère à imiter pour se faire passer
    // pour une preuve — il faut un vrai payload, avec un vrai sujet.
    const at = message.indexOf('{');
    const end = message.lastIndexOf('}');
    const raw = at === -1 || end <= at ? message.trim() : message.slice(at, end + 1);
    try {
      const parsed = JSON.parse(raw);
      out.push({
        workflow: typeof parsed?.workflow === 'string' ? parsed.workflow : null,
        acted: typeof parsed?.acted === 'boolean' ? parsed.acted : null,
        reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
        count: Number.isInteger(parsed?.count) ? parsed.count : null,
        raw,
      });
    } catch {
      out.push({ workflow: null, acted: null, reason: 'preuve illisible (JSON invalide)', count: null, raw });
    }
  }
  return out;
}

/**
 * Le sujet d'une preuve, tel qu'un producteur doit le déclarer : le fichier de
 * workflow qui tourne.
 *
 * Mesuré à la source plutôt que deviné : `GITHUB_WORKFLOW_REF` a la forme
 * `owner/repo/.github/workflows/x.yml@refs/heads/main`. Le suffixe de révision
 * est retiré, donc la preuve nomme un FICHIER — la même clé que celle sous
 * laquelle l'audit range le workflow.
 * @param {string} [ref]
 * @returns {string|null}
 */
export function workflowFileFromRef(ref = '') {
  const text = String(ref ?? '').trim();
  if (!text) return null;
  const withoutRevision = text.split('@')[0];
  const file = withoutRevision.split('/').filter(Boolean).pop();
  return file && /\.ya?ml$/.test(file) ? file : null;
}

/**
 * How long a SCHEDULED automation may go without a completed run before it
 * counts as dormant. Eight days covers the coarsest cadence in this repo (a
 * daily cron) with room for a weekend of skipped schedules; an event-driven
 * workflow is never judged on age, only on what its last run says.
 */
export const DORMANT_ALLOWANCE_DAYS = 8;

/**
 * La fenêtre pendant laquelle « aucune preuve » ne dit encore rien.
 *
 * Beaucoup plus courte que celle des journaux, et pour une raison mécanique :
 * une annotation est stockée avec la conclusion du job, pas archivée après coup
 * (c'est le transport précédent qui avait besoin de 15 min). Il reste une
 * course possible — l'audit se déclenche sur le même push que les workflows
 * qu'il juge, et un run peut être marqué terminé juste avant que ses
 * annotations soient lisibles. Un run younger que ça est `pending` (⏳, nommé,
 * non bloquant) ; au-delà, l'absence de preuve est un constat.
 */
export const EVIDENCE_GRACE_MS = 3 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The verdict for ONE workflow.
 *
 * Verdicts, and why each is what it is:
 *   - `acted`     — le dernier run terminé est vert et a PUBLIÉ une preuve
 *                   disant qu'il a agi. C'est le seul verdict passant.
 *   - `inert`     — il a publié une preuve disant qu'il n'a pas pu agir (KO).
 *   - `unproven`  — vert, l'étape de preuve existait dans ce run, et rien n'a
 *                   été publié (KO : un run qui ne prouve rien est le faux vert
 *                   que cet audit pourchasse).
 *   - `legacy`    — vert, et ce run n'avait AUCUNE étape de preuve : antérieur au
 *                   contrat. Non bloquant, nommé — le contrat s'applique au run
 *                   suivant.
 *   - `unreadable`— un run existe mais ses jobs/annotations n'ont pas pu être
 *                   lus (KO : invérifiable n'est pas un vert).
 *   - `pending`   — run terminé il y a quelques secondes, preuve pas encore
 *                   lisible (voir EVIDENCE_GRACE_MS). Ni vert ni rouge.
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
 * Pure: run, anyRun, annotations and clock are injected.
 *
 * @param {{ file?: string, name?: string, hasSchedule?: boolean,
 *   run?: { conclusion?: string, created_at?: string } | null,
 *   anyRun?: { status?: string, created_at?: string } | null, absent?: boolean,
 *   annotations?: object[] | null, annotationsUnavailable?: boolean,
 *   promised?: boolean, workflow?: string,
 *   nowMs?: number, allowanceDays?: number, evidenceGraceMs?: number }} input
 * @returns {{ file: string, name: string, verdict: string, ko: boolean, reason: string, foreign?: string[] }}
 */
export function lastRunVerdict({
  file = '',
  name = '',
  hasSchedule = false,
  run = null,
  anyRun = null,
  absent = false,
  annotations = null,
  annotationsUnavailable = false,
  promised = false,
  workflow = '',
  nowMs = Date.now(),
  allowanceDays = DORMANT_ALLOWANCE_DAYS,
  evidenceGraceMs = EVIDENCE_GRACE_MS,
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
  const young = evidenceGraceMs > 0 && (!Number.isFinite(ageMs) || ageMs <= evidenceGraceMs);

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

  if (annotationsUnavailable || !Array.isArray(annotations)) {
    return young
      ? {
          ...base,
          verdict: 'pending',
          ko: false,
          reason: 'run terminé à l’instant — preuve pas encore lisible (rien à en déduire)',
        }
      : {
          ...base,
          verdict: 'unreadable',
          ko: true,
          reason: 'run vert, mais ses annotations sont illisibles — invérifiable n’est pas un vert',
        };
  }

  // 1. La preuve, et seulement si elle parle de CE workflow : elle porte son
  //    sujet, donc une preuve déposée au nom d'un autre ne peut plus faire
  //    accuser le mauvais (l'incident du 2026-09-12, en entier).
  const records = evidenceFromAnnotations(annotations);
  const unreadable = records.filter((r) => r.acted === null);
  if (unreadable.length > 0) {
    return {
      ...base,
      verdict: 'unreadable',
      ko: true,
      reason: `preuve illisible — ${unreadable[0].reason}`,
    };
  }

  const subject = workflow || file;
  const foreign = [
    ...new Set(records.filter((r) => r.workflow !== subject).map((r) => r.workflow ?? '(sans nom)')),
  ];
  const mine = records.filter((r) => r.workflow === subject);
  if (mine.length > 0) {
    const unacted = mine.filter((r) => r.acted === false);
    if (unacted.length > 0) {
      return {
        ...base,
        verdict: 'inert',
        ko: true,
        reason: `vert sans avoir agi : ${unacted[0].reason}`,
        foreign,
      };
    }
    const first = mine[0];
    const extra = mine.length > 1 ? ` (+${mine.length - 1} preuve(s))` : '';
    const counted = Number.isInteger(first.count) ? ` — ${first.count} mesuré(s)` : '';
    return {
      ...base,
      verdict: 'acted',
      ko: false,
      reason: `a agi : ${first.reason || 'preuve publiée'}${counted}${extra}`,
      foreign,
    };
  }

  // 2. Aucune preuve, et le RUN dit s'il en attendait une : ses étapes sont
  //    rendues par l'API, donc « ce run avait l'étape et elle n'a rien publié »
  //    se lit sans rien deviner. Pas d'étape ⇒ run antérieur au contrat.
  if (!promised) {
    return {
      ...base,
      verdict: 'legacy',
      ko: false,
      reason: 'run antérieur au contrat de preuve (aucune étape de preuve dans ce run) — jugé sur sa seule conclusion',
      foreign,
    };
  }

  if (young) {
    return {
      ...base,
      verdict: 'pending',
      ko: false,
      reason: 'run terminé à l’instant — preuve pas encore lisible (rien à en déduire)',
      foreign,
    };
  }

  return {
    ...base,
    verdict: 'unproven',
    ko: true,
    reason: 'run vert qui n’a publié aucune preuve — un run qui ne prouve rien est un faux vert',
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
  unproven: '❌',
  unreadable: '❌',
  dormant: '❌',
  failed: '⚠️ ',
  pending: '⏳',
  running: '⏳',
  absent: '➖',
  legacy: '➖',
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

/**
 * Ce run avait-il promis une preuve ? Lu sur ses ÉTAPES (l'API les rend), pas
 * sur la révision : c'est la même requête que celle des annotations, et ça ne
 * peut pas mentir sur ce que ce run-là devait faire.
 * @param {{ name?: string }[]} [steps]
 * @returns {boolean}
 */
export function promisedEvidence(steps = []) {
  return (Array.isArray(steps) ? steps : []).some((s) =>
    String(s?.name ?? '').startsWith(EVIDENCE_STEP_NAME),
  );
}

/**
 * Les arguments du producteur, validés — PUR, donc testable sans lancer un
 * processus (et sans payer 10 s de fork par cas, ce que la version subprocess de
 * cette suite coûtait réellement sur Windows).
 *
 * Ce que chaque refus existe pour empêcher :
 *   • un SUJET qui n'est pas le workflow en train de tourner (`--workflow`
 *     contredit `GITHUB_WORKFLOW_REF`) — une preuve ne parle que de son sujet ;
 *   • une raison VIDE — « j'ai agi » sans dire quoi n'est pas une preuve ;
 *   • `--acted --count 0` — une preuve d'action sur zéro chose se contredit ;
 *   • les deux états à la fois, ou aucun.
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined> }} [input]
 * @returns {{ ok: true, workflow: string, acted: boolean, reason: string, count: number|null }
 *   | { ok: false, error: string }}
 */
export function parseEvidenceArgs({ argv = [], env = {} } = {}) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (name) => {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === name) return argv[i + 1] ?? '';
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
    return null;
  };

  const acted = has('--acted');
  const inert = has('--inert');
  if (acted === inert) return { ok: false, error: 'il faut exactement un des deux états : `--acted` ou `--inert`.' };

  const reason = String(valueOf('--reason') ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 3) {
    return {
      ok: false,
      error:
        '`--reason` est obligatoire : une preuve qui ne dit pas ce qui a été fait (ou ce qui a manqué) ne prouve rien.',
    };
  }

  const running = workflowFileFromRef(env.GITHUB_WORKFLOW_REF || '');
  const declared = String(valueOf('--workflow') ?? '').trim();
  if (running && declared && running !== declared) {
    return { ok: false, error: `le workflow qui tourne est ${running}, pas ${declared} — une preuve ne parle que de son sujet.` };
  }
  const workflow = running || declared;
  if (!workflow) {
    return {
      ok: false,
      error:
        'sujet introuvable : `GITHUB_WORKFLOW_REF` est absent (exécution hors runner) et `--workflow` n’a pas été fourni.',
    };
  }

  const rawCount = valueOf('--count');
  let count = null;
  if (rawCount !== null) {
    count = Number(rawCount);
    if (!Number.isInteger(count) || count < 0) {
      return { ok: false, error: `\`--count\` doit être un entier positif ou nul (reçu « ${rawCount} »).` };
    }
    if (acted && count === 0) {
      return { ok: false, error: '`--acted --count 0` se contredit : sans objet à compter, n’imprimez pas `--count`.' };
    }
  }

  return { ok: true, workflow, acted, reason, count };
}
