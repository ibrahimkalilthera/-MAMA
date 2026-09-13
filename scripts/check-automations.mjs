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
 * qui avait réellement mis trois PR à jour. Le contrat (chaque automatisation
 * PUBLIE une preuve structurée) et les règles de verdict vivent dans
 * scripts/lib/automation-evidence.mjs ; ce fichier ne fait que lire GitHub et
 * imprimer.
 *
 * Ce qu'il juge, exactement : pour CHAQUE workflow du dépôt, le dernier run
 * TERMINÉ sur `main`, les ÉTAPES de ses jobs et leurs ANNOTATIONS. Aucun journal
 * n'est téléchargé ni lu — la preuve est un couple de champs structurés
 * (`title`, `message`) que le runner stocke, pas une ligne de texte recopiée.
 * Les trois défauts du transport par journal (titre perdu à la réécriture,
 * marque imprimée par n'importe qui, archivage après coup) disparaissent avec
 * lui, et l'audit y gagne de ne plus dépendre d'une fenêtre de publication.
 *
 * Le token est OBLIGATOIRE : les runs d'un dépôt privé ne sont pas publics (et
 * sans `actions: read` la liste revient vide, ce qui ressemble à un dépôt sans
 * workflow). Sans lui, le script sort en 2 avec la raison — il ne rend jamais un
 * vert qu'il n'a pas mesuré.
 *
 * Env :
 *   GITHUB_TOKEN | GH_TOKEN | REBASE_TOKEN   lecture des runs, jobs, annotations
 *   GITHUB_REPOSITORY                        `owner/repo` (fourni par Actions)
 *   AUTOMATION_AUDIT_JOBS                    nombre de jobs dont on lit les
 *                                            annotations, par workflow (défaut 8)
 *   AUTOMATION_AUDIT_PUBLISH=0               ne publie pas la preuve de l'audit
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  EVIDENCE_STEP_NAME,
  VERDICT_ICON,
  auditAutomations,
  parseWorkflowFile,
  promisedEvidence,
} from './lib/automation-evidence.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'ibrahimkalilthera/-MAMA';
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.REBASE_TOKEN || '').trim();
const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
const maxJobs = Number(process.env.AUTOMATION_AUDIT_JOBS ?? 8);

if (!token) {
  console.error(
    '❌ Audit impossible : aucun token. Les runs ne sont pas publics, donc « je n’ai pas ' +
      'pu regarder » ne doit jamais devenir un vert. En local : GITHUB_TOKEN=… npm run check:automations.',
  );
  process.exit(2);
}

// `User-Agent` n'est pas décoratif, et c'est une mesure : l'API des annotations
// répond 200 avec une liste VIDE quand cette en-tête manque — un audit qui croit
// alors n'avoir lu aucune preuve condamne tous les runs pourvus d'une étape de
// preuve. Le nom est donc load-bearing, au même titre que le token.
const headers = {
  'User-Agent': 'automation-audit',
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
};

/** One API call that never throws: a status and a body, or the reason why not. */
async function api(path) {
  try {
    const res = await fetch(API + path, { headers, redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, message: res.statusText };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (error) {
    return { ok: false, status: 0, message: error?.message ?? String(error) };
  }
}

/** Every workflow of the repository, as the files describe them. */
function readWorkflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => parseWorkflowFile(readFileSync(join(WORKFLOW_DIR, file), 'utf8'), { file }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Les annotations des check runs d'un job.
 *
 * `check_run_url` est rendu par l'API des jobs : c'est la clé du stockage, et
 * elle évite de deviner un identifiant. Un job sans check run (annulé avant
 * démarrage) n'a rien à lire — il est traité comme lu, avec zéro annotation :
 * c'est le contrat qui tranchera, pas nous.
 * @param {{ check_run_url?: string }} job
 */
async function annotationsOf(job) {
  const url = String(job?.check_run_url ?? '');
  const id = url.split('/').filter(Boolean).pop();
  if (!id) return { ok: true, data: [] };
  const listed = await api(`/repos/${repo}/check-runs/${id}/annotations?per_page=100`);
  if (!listed.ok) return listed;
  return { ok: true, data: listed.data ?? [] };
}

/**
 * Le dernier run terminé d'un workflow, ses étapes et ses annotations.
 *
 * Un run ROUGE n'a pas besoin de ses annotations : le verdict « déjà visible »
 * tombe avant. La lecture reste donc concentrée sur ce que cet audit cherche —
 * la panne silencieuse d'un run vert.
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
      annotations: null,
      error: absent ? null : `runs ${listed.status}${listed.message ? ' — ' + listed.message : ''}`,
    };
  }
  const runs = listed.data?.workflow_runs ?? [];
  const run = runs.find((r) => r.status === 'completed') ?? null;
  const anyRun = runs[0] ?? null;
  if (!run) return { workflow, run: null, anyRun, annotations: null, error: null };

  if (run.conclusion && run.conclusion !== 'success') {
    return { workflow, run, anyRun, annotations: null, error: null };
  }

  const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
  if (!jobs.ok) {
    return { workflow, run, anyRun, annotations: null, annotationsUnavailable: true, error: `jobs ${jobs.status}` };
  }

  const all = jobs.data?.jobs ?? [];
  // Le contrat se lit sur les ÉTAPES de CE run : une étape de preuve qui existait
  // et n'a pas abouti est un manquement du run, pas une tolérance de migration.
  const promised = all.some((job) => promisedEvidence(job.steps));
  // Un job SAUTÉ, et c'est un fait de l'API : un déclencheur automatique dont le
  // gate a répondu « rien à faire » (une version déjà publiée, une PR en retard
  // qui n'existe pas) laisse le job de preuve à l'état `skipped` — ses étapes ne
  // sont donc jamais rendues. Sans ce drapeau, ce run se lirait « antérieur au
  // contrat de preuve », ce qui est faux : il est sans objet.
  const skipped = all.some((job) => job.conclusion === 'skipped');
  const annotations = [];
  for (const job of all.slice(0, maxJobs)) {
    const read = await annotationsOf(job);
    if (!read.ok) {
      return {
        workflow,
        run,
        anyRun,
        promised,
        annotations: null,
        annotationsUnavailable: true,
        error: `annotations ${read.status}`,
      };
    }
    annotations.push(...(read.data ?? []));
  }
  return { workflow, run, anyRun, promised, skipped, annotations, error: null };
}

const workflows = readWorkflows();
const evidence = [];
for (const workflow of workflows) {
  evidence.push(await evidenceFor(workflow));
}

const { results, ko, ok } = auditAutomations({
  workflows: evidence.map(({ workflow, run, anyRun, absent, annotations, annotationsUnavailable, promised, skipped }) => ({
    file: workflow.file,
    name: workflow.name,
    hasSchedule: workflow.hasSchedule,
    run,
    anyRun,
    absent,
    annotations: annotations ?? null,
    annotationsUnavailable: Boolean(annotationsUnavailable),
    // Le run promettait-il une preuve ? On le lit sur SES étapes (voir
    // EVIDENCE_STEP_NAME) : un run antérieur au contrat ne pouvait rien publier,
    // et le juger comme un manquement serait un faux rouge de plus.
    promised: Boolean(promised),
    skipped: Boolean(skipped),
    workflow: workflow.file,
  })),
});

console.log(`🔎 Audit des automatisations — ${repo}, dernier run terminé sur main (${results.length} workflow(s))`);
console.log(`   preuve lue dans les annotations stockées (« ${EVIDENCE_STEP_NAME} »), jamais dans un journal\n`);
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
// résumé ne peut pas prétendre que TOUT a été vérifié quand une preuve manque
// encore (ce dépôt a déjà payé un silence pris pour un vert).
const pending = results.filter((r) => r.verdict === 'pending');
const pendingNote = pending.length ? `, ${pending.length} preuve(s) pas encore lisibles` : '';
// Le résumé dit ce qui a été LU, pas ce qu'on espère : une preuve publiée et un
// run antérieur au contrat ne sont pas la même chose, et les confondre serait
// exactement le vert de complaisance que cet audit existe pour empêcher.
const published = results.filter((r) => r.verdict === 'acted').length;
const legacy = results.filter((r) => r.verdict === 'legacy').length;
const idle = results.filter((r) => r.verdict === 'idle' || r.verdict === 'absent').length;

console.log(
  ok
    ? `\n✅ Aucune automatisation inerte — ${published} preuve(s) publiée(s)` +
      (legacy
        ? `, ${legacy} run(s) antérieur(s) au contrat de preuve (jugés sur leur seule conclusion — le contrat s’applique au prochain)`
        : '') +
      (idle ? `, ${idle} sans run à juger` : '') +
      `${pendingNote}.`
    : `\n❌ ${ko.length} automatisation(s) n’ont pas agi — un run vert qui ne fait rien est un faux vert :`,
);
for (const r of ko) console.log(`   • ${r.name || r.file} : ${r.reason}`);
if (!ok && pending.length) console.log(`   ⏳ hors verdict : ${pending.map((r) => r.name || r.file).join(', ')}`);

// L'audit publie sa propre preuve comme tout le monde : la SUBSTANCE vient d'ici
// (combien de workflows jugés, combien de preuves publiées — les chiffres que
// lui seul a), la COMPLÉTION vient de l'étape NOMMÉE du workflow
// (`Publier la preuve d’action` → scripts/publish-automation-evidence.mjs), qui
// reste le repère lu dans les étapes du run pour savoir si une preuve était
// attendue. Un run rouge ne publie rien : le verdict `failed` dit déjà tout.
if (ok) {
  publishEvidence({
    acted: true,
    count: results.length,
    reason: `${results.length} workflow(s) jugé(s) sur leur dernier run terminé : ${published} preuve(s) d’action publiée(s)${
      legacy ? `, ${legacy} run(s) antérieur(s) au contrat` : ''
    }`,
  });
}
process.exit(ok ? 0 : 1);
