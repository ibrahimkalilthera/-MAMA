#!/usr/bin/env node
/**
 * Audit des automatisations — « ce workflow est vert : a-t-il AGI ? »
 *
 *   npm run check:automations            (dans Actions ; GITHUB_TOKEN suffit)
 *
 * Pourquoi ce script existe : un run vert ne prouve rien. `Dependabot rebase` a
 * tourné vert à chaque push sur `main` pendant 22 runs sans jamais rien rebaser,
 * parce que son secret est absent et que son script sort en 0 « visible, pas
 * rouge ». Rien dans la liste des runs ne permettait de distinguer ça d'un run
 * qui avait réellement mis trois PR à jour. La convention (une automatisation qui
 * ne peut pas agir le DIT, avec une annotation `Inactif`) et les règles de
 * verdict vivent dans scripts/lib/automation-evidence.mjs ; ce fichier ne fait
 * que lire GitHub et imprimer.
 *
 * Ce qu'il juge, exactement : pour CHAQUE workflow du dépôt, le dernier run
 * TERMINÉ sur `main`, et le journal de ses jobs. Vert + aucune annotation
 * `Inactif` = a agi. Impossible de lire le journal = échec (invérifiable n'est
 * pas un vert). Planifié sans run récent = échec (un cron qui ne part pas est en
 * panne). Rouge = signalé sans doubler l'alerte : ce que cet audit cherche est
 * la panne SILENCIEUSE.
 *
 * UNE SEULE EXCEPTION À « invérifiable = échec » : la course de publication.
 * GitHub marque un run terminé AVANT d'archiver ses journaux, donc l'audit —
 * déclenché par le même push que les workflows qu'il juge — lisait `logs 404`
 * pour des runs verts qui venaient de finir, et les comptait comme un faux vert.
 * Un 404 est donc retenté quelques fois (LOG_FETCH_ATTEMPTS), et s'il persiste
 * sur un run RÉCENT il devient `pending` (⏳, nommé, non bloquant) ; au-delà de
 * LOG_GRACE_MS le même 404 redevient l'échec qu'il est. La fenêtre est mesurée,
 * pas devinée : les mêmes journaux répondaient 200 quelques secondes plus tard.
 *
 * Le token est OBLIGATOIRE : les journaux ne sont pas publics. Sans lui, le
 * script sort en 2 avec la raison — il ne rend jamais un vert qu'il n'a pas
 * mesuré.
 *
 * Env :
 *   GITHUB_TOKEN | GH_TOKEN | REBASE_TOKEN   lecture des runs et des journaux
 *   GITHUB_REPOSITORY                        `owner/repo` (fourni par Actions)
 *   AUTOMATION_AUDIT_JOBS                    nombre de jobs dont on lit le
 *                                            journal, par workflow (défaut 4)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  LOG_FETCH_ATTEMPTS,
  VERDICT_ICON,
  auditAutomations,
  parseWorkflowFile,
} from './lib/automation-evidence.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'ibrahimkalilthera/-MAMA';
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.REBASE_TOKEN || '').trim();
const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
const maxJobs = Number(process.env.AUTOMATION_AUDIT_JOBS ?? 4);

if (!token) {
  console.error(
    '❌ Audit impossible : aucun token. Les journaux de runs ne sont pas publics, donc « je n’ai pas ' +
      'pu regarder » ne doit jamais devenir un vert. En local : GITHUB_TOKEN=… npm run check:automations.',
  );
  process.exit(2);
}

const headers = {
  'User-Agent': 'automation-audit',
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
};

/** One API call that never throws: a status and a body, or the reason why not. */
async function api(path, { raw = false } = {}) {
  try {
    const res = await fetch(API + path, { headers, redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, message: res.statusText };
    return { ok: true, status: res.status, data: raw ? await res.text() : await res.json() };
  } catch (error) {
    return { ok: false, status: 0, message: error?.message ?? String(error) };
  }
}

/** Combien de temps on laisse à la plateforme entre deux tentatives de journal. */
const LOG_RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Le journal d'un job, retenté tant que GitHub répond « pas encore là ».
 *
 * Mesuré le 2026-09-12 sur ce dépôt : un run vert terminé depuis quelques
 * secondes répond `logs 404`, puis 200. Retenter un 404 est donc légitime ;
 * retenter un 403 ou un 500 ne le serait pas (le droit et la panne ne dépendent
 * pas de notre patience), et on rend la main tout de suite dans ces cas.
 *
 * @param {number} jobId
 * @returns {Promise<{ ok: boolean, status: number, data?: string, message?: string }>}
 */
async function fetchJobLog(jobId) {
  let last = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= LOG_FETCH_ATTEMPTS; attempt += 1) {
    last = await api(`/repos/${repo}/actions/jobs/${jobId}/logs`, { raw: true });
    if (last.ok) return last;
    if (last.status !== 404) return last;
    if (attempt < LOG_FETCH_ATTEMPTS) await sleep(LOG_RETRY_DELAY_MS);
  }
  return last;
}

/** Every workflow of the repository, as the files describe them. */
function readWorkflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => parseWorkflowFile(readFileSync(join(WORKFLOW_DIR, file), 'utf8'), { file }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The last completed run of a workflow on the default branch, and the logs of
 * its first jobs. A log that cannot be read comes back as `null`, which the
 * verdict reads as `unreadable` — never as an absence of markers.
 */
async function evidenceFor(workflow) {
  // One call, five runs, no status filter: the LAST COMPLETED one is the
  // evidence, but an in-flight one has to be visible too — otherwise the audit
  // would call its own first run a broken cron (the push-triggered run of a
  // workflow is still executing while the audit reads it).
  const listed = await api(`/repos/${repo}/actions/workflows/${workflow.file}/runs?branch=main&per_page=5`);
  if (!listed.ok) {
    // 404 = GitHub does not know this workflow (its file is not on the default
    // branch yet). Anything else is a real read failure and stays a failure.
    const absent = listed.status === 404;
    return {
      workflow,
      run: null,
      anyRun: null,
      absent,
      log: null,
      error: absent ? null : `runs ${listed.status}${listed.message ? ' — ' + listed.message : ''}`,
    };
  }
  const runs = listed.data?.workflow_runs ?? [];
  const run = runs.find((r) => r.status === 'completed') ?? null;
  const anyRun = runs[0] ?? null;
  if (!run) return { workflow, run: null, anyRun, log: null, error: null };

  // Un run ROUGE n'a pas besoin de son journal : le verdict « déjà visible »
  // tombe avant, et lire le journal d'un run rouge ne servait qu'à afficher un
  // `(logs 404)` trompeur à côté d'un échec déjà annoncé.
  if (run.conclusion && run.conclusion !== 'success') {
    return { workflow, run, anyRun, log: null, logsUnavailable: false, error: null };
  }

  const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=${Math.max(1, maxJobs)}`);
  if (!jobs.ok) return { workflow, run, anyRun, log: null, logsUnavailable: false, error: `jobs ${jobs.status}` };

  const parts = [];
  for (const job of (jobs.data?.jobs ?? []).slice(0, maxJobs)) {
    const log = await fetchJobLog(job.id);
    // 404 = la plateforme n'a pas encore archivé le fichier (voir LOG_GRACE_MS) ;
    // les autres statuts sont des échecs de lecture sans excuse.
    if (!log.ok) {
      return {
        workflow,
        run,
        anyRun,
        log: null,
        logsUnavailable: log.status === 404,
        error: `logs ${log.status}`,
      };
    }
    parts.push(log.data);
  }
  return { workflow, run, anyRun, log: parts.join('\n'), logsUnavailable: false, error: null };
}

const workflows = readWorkflows();
const evidence = [];
for (const workflow of workflows) {
  evidence.push(await evidenceFor(workflow));
}

const { results, ko, ok } = auditAutomations({
  workflows: evidence.map(({ workflow, run, anyRun, absent, log, logsUnavailable }) => ({
    file: workflow.file,
    name: workflow.name,
    hasSchedule: workflow.hasSchedule,
    run,
    anyRun,
    absent,
    log,
    logsUnavailable,
    // Le sujet de la preuve : la ligne structurée n'est comptée que si elle
    // nomme ce workflow-là (voir EVIDENCE_PREFIX).
    workflow: workflow.file,
  })),
});

console.log(`🔎 Audit des automatisations — ${repo}, dernier run terminé sur main (${results.length} workflow(s))\n`);
for (const [i, r] of results.entries()) {
  const evidenceRow = evidence[i];
  const ran = evidenceRow.run ? `${evidenceRow.run.conclusion} ${String(evidenceRow.run.created_at).slice(0, 10)}` : '—';
  console.log(`${VERDICT_ICON[r.verdict] ?? '•'} ${r.name.padEnd(38)} ${ran.padEnd(21)} ${r.reason}`);
  if (evidenceRow.error) console.log(`     (${evidenceRow.error})`);
  // Une preuve qui parle d'un AUTRE workflow n'est jamais comptée, mais elle
  // n'est pas escamotée non plus : c'est le fait qui a fait accuser le mauvais
  // workflow le 2026-09-12, et le nommer rend l'audit jugeable à son tour.
  if (r.foreign?.length) {
    console.log(`     ↪ ${r.foreign.length} preuve(s) d'un autre workflow ignorée(s) ici : ${r.foreign.join(', ')}`);
  }
}

// Un `pending` n'est ni un échec ni un blanc-seing : le rapport le nomme, et le
// résumé ne peut pas prétendre que TOUT a été vérifié quand un journal manque
// encore (ce dépôt a déjà payé un silence pris pour un vert).
const pending = results.filter((r) => r.verdict === 'pending');
const pendingNote = pending.length ? ` — ${pending.length} journal(aux) pas encore publié(s), rien à en déduire` : '';

console.log(
  ok
    ? `\n✅ Les ${results.length} automatisations ont agi à leur dernier run${pendingNote}.`
    : `\n❌ ${ko.length} automatisation(s) n’ont pas agi — un run vert qui ne fait rien est un faux vert :`,
);
for (const r of ko) console.log(`   • ${r.name || r.file} : ${r.reason}`);
if (!ok && pending.length) console.log(`   ⏳ hors verdict : ${pending.map((r) => r.name || r.file).join(', ')}`);

process.exit(ok ? 0 : 1);
