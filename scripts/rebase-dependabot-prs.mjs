#!/usr/bin/env node
/**
 * Rebase des PR Dependabot dès que `main` avance.
 *
 * Pourquoi ce n'est pas un réglage : GitHub n'a AUCUNE option « rebaser
 * automatiquement quand la base change » (la demande upstream,
 * dependabot-core#2224, est toujours ouverte). Le seul rebasage automatique de
 * Dependabot vise les CONFLITS, pas l'obsolescence — une PR dont les checks ont
 * tourné il y a trois pushes reste « out-of-date with the base branch », avec
 * des vérifications périmées que personne ne rejoue. Et la commande
 * `@dependabot rebase` postée par un workflow qui utilise le GITHUB_TOKEN échoue
 * depuis 2023 : « Sorry, only users with push access can use that command » — un
 * bot n'a pas ce droit.
 *
 * Ce script comble le trou avec un token qui, lui, a le droit :
 *
 *   1. lister les PR ouvertes de Dependabot visant `main`, dans CE dépôt (une
 *      branche de fork n'est jamais touchée) ;
 *   2. demander l'avancement de chaque branche (`compare main...head`) ;
 *   3. si elle est en retard, mettre la branche à jour (`update-branch`) ;
 *   4. si c'est impossible (conflit), se rabattre sur `@dependabot rebase` —
 *      Dependabot sait alors régénérer le lockfile, ce que nous ne savons pas.
 *
 * Le token est OBLIGATOIREMENT un PAT (ou un token d'App GitHub), jamais le
 * GITHUB_TOKEN : une mise à jour faite avec le GITHUB_TOKEN ne déclenche AUCUN
 * workflow (« events triggered by the GITHUB_TOKEN … will not create a new
 * workflow run »), donc les checks resteraient périmés — exactement le problème
 * qu'on veut supprimer. Le PAT, lui, produit un push d'utilisateur : l'événement
 * `synchronize` part, et la chaîne qualité rejoue sur la PR. C'est le cœur du
 * mécanisme, et c'est la seule chose que ce script ne peut pas faire autrement.
 *
 * Env :
 *   REBASE_TOKEN  PAT — fine-grained : Contents (read/write) + Pull requests
 *                 (read/write) ; classic : scope `repo`. Injecté depuis le
 *                 secret `DEPENDABOT_REBASE_TOKEN` (voir le workflow).
 *                 Absent : le script sort en 0 avec un avertissement VISIBLE
 *                 (le secret n'est pas encore posé) — jamais en silence.
 *   GITHUB_REPOSITORY  `owner/repo` (fourni par Actions).
 *
 * Sortie : 0 sauf panne d'infrastructure (liste illisible, token refusé), qui
 * doit être bruyante — une automatisation morte qui reste verte ne se répare
 * jamais. Un conflit ou un refus ponctuel sur UNE PR est rapporté en
 * avertissement, sans rougir le run.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evidenceAnnotation, workflowFileFromRef } from './lib/automation-evidence.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'ibrahimkalilthera/-MAMA';
const BASE = 'main';
const BOT_LOGIN = 'dependabot[bot]';
const BRANCH_PREFIX = 'dependabot/';
/** Le workflow passe le secret ici ; jamais de repli sur GITHUB_TOKEN (voir l'en-tête). */
const TOKEN_ENV = 'REBASE_TOKEN';
/**
 * Le sujet déclaré dans la preuve : le fichier de workflow qui porte ce script.
 * L'audit ne compte une preuve que si elle nomme CE workflow — sans quoi une
 * copie imprimée ailleurs (par une suite de tests, mesuré le 2026-09-12) ferait
 * accuser un workflow qui n'a rien dit. Le runner impose le sujet quand il est là
 * (`GITHUB_WORKFLOW_REF`) ; le repli sert aux exécutions locales.
 */
const WORKFLOW_FILE = workflowFileFromRef(process.env.GITHUB_WORKFLOW_REF || '') || 'dependabot-rebase.yml';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Décision (pure : tout est testable sans réseau) ─────────────────────────

/**
 * Une PR est-elle une PR Dependabot rebasable ? Renvoie `{ ok: true }` ou
 * `{ ok: false, reason }` — la raison est TOUJOURS conservée : une PR ignorée
 * doit apparaître dans le rapport avec son motif, sinon « rien à faire » et
 * « filtre trop strict » deviennent indiscernables.
 *
 * Les quatre conditions sont nécessaires, et chacune a une raison :
 *   • branche `dependabot/*` — c'est le contrat de propriété : cette branche est
 *     à Dependabot, la réécrire est son travail normal ;
 *   • auteur `dependabot[bot]` — une branche rebaptisée à la main ne doit pas
 *     être touchée juste parce qu'elle porte le préfixe ;
 *   • dépôt source identique — le PAT ne peut pas écrire dans un fork, et une PR
 *     externe n'est pas à nous ;
 *   • cible `main` — la porte qualité CI ne surveille que cette base.
 *
 * @param {any} pr
 * @param {string} repo `owner/repo`
 * @param {string} base
 * @returns {{ ok: true, ref: string, sha: string } | { ok: false, reason: string }}
 */
export function eligibility(pr, repo, base = BASE) {
  if (!pr || pr.state !== 'open') return { ok: false, reason: `PR ${pr?.state ?? 'inconnue'}` };
  if (pr.draft) return { ok: false, reason: 'brouillon' };

  const target = pr.base?.ref;
  if (target !== base) return { ok: false, reason: `cible ${target ?? '?'} ≠ ${base}` };

  const ref = pr.head?.ref ?? '';
  if (!ref.startsWith(BRANCH_PREFIX)) return { ok: false, reason: `branche non-Dependabot (${ref || '?'})` };

  const author = (pr.user?.login ?? '').toLowerCase();
  if (author !== BOT_LOGIN) return { ok: false, reason: `auteur ${pr.user?.login ?? '?'}` };

  const source = pr.head?.repo?.full_name ?? '';
  if (source && source !== repo) return { ok: false, reason: `branche dans un fork (${source})` };

  return { ok: true, ref, sha: pr.head?.sha ?? '' };
}

/**
 * Le corps `compare/{base}...{head}` de GitHub mesure l'écart dans les deux
 * sens : `behind_by` est le nombre de commits que `main` a et que la branche
 * n'a pas. C'est la définition exacte de « vérifications périmées » — pas un
 * conflit, pas un échec : juste du travail validé sur un état qui n'existe plus.
 * @param {any} comparison
 * @returns {boolean}
 */
export function isBehind(comparison) {
  return Number(comparison?.behind_by ?? 0) > 0;
}

/**
 * Boucle de décision, providers injectés (le réseau reste dans `main`).
 *
 * @param {object} deps
 * @param {any[]} deps.pulls PR ouvertes telles que renvoyées par l'API
 * @param {string} deps.repo
 * @param {(headSha: string) => Promise<{ ok: boolean, status: number, data?: any, message?: string }>} deps.compare
 * @param {(pr: any) => Promise<{ ok: boolean, status: number, message?: string }>} deps.updateBranch
 * @param {(pr: any) => Promise<{ ok: boolean, status: number, message?: string }>} deps.askDependabot
 * @returns {Promise<Array<{ number: number, action: string, detail: string }>>}
 */
export async function rebaseOutOfDatePrs({ pulls, repo, compare, updateBranch, askDependabot }) {
  const results = [];

  for (const pr of pulls ?? []) {
    const verdict = eligibility(pr, repo);
    if (!verdict.ok) {
      results.push({ number: pr?.number ?? 0, action: 'skip', detail: verdict.reason });
      continue;
    }

    const cmp = await compare(verdict.sha);
    if (!cmp.ok) {
      results.push({
        number: pr.number,
        action: 'failed',
        detail: `compare ${cmp.status}${cmp.message ? ' — ' + cmp.message : ''}`,
      });
      continue;
    }

    if (!isBehind(cmp.data)) {
      results.push({ number: pr.number, action: 'current', detail: `à jour (${verdict.ref})` });
      continue;
    }

    const updated = await updateBranch(pr);
    if (updated.ok) {
      results.push({ number: pr.number, action: 'rebase', detail: `branche mise à jour (${verdict.ref})` });
      continue;
    }

    // 422 : la branche a divergé (conflit de contenu). C'est le seul cas où
    // Dependabot est meilleur que nous — il régénère le lockfile en résolvant.
    if (updated.status === 422) {
      const asked = await askDependabot(pr);
      results.push(
        asked.ok
          ? { number: pr.number, action: 'dependabot', detail: `conflit → @dependabot rebase (${verdict.ref})` }
          : {
              number: pr.number,
              action: 'failed',
              detail: `conflit, et la commande a été refusée (${asked.status}${asked.message ? ' — ' + asked.message : ''})`,
            },
      );
      continue;
    }

    results.push({
      number: pr.number,
      action: 'failed',
      detail: `update-branch ${updated.status}${updated.message ? ' — ' + updated.message : ''}`,
    });
  }

  return results;
}

// ── GitHub REST ─────────────────────────────────────────────────────────────

/**
 * Un appel à l'API. Ne lève jamais : renvoie `{ ok, status, data, message }`,
 * pour que la boucle de décision traite un conflit (422) comme un cas normal et
 * une panne (401/403) comme un échec.
 */
async function api(method, path, body, token, tries = 3) {
  let last = { ok: false, status: 0, message: 'aucune tentative' };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: {
          'User-Agent': 'dependabot-rebase',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.ok || res.status === 202) {
        return { ok: true, status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
      }
      const payload = await res.json().catch(() => null);
      last = { ok: false, status: res.status, message: payload?.message ?? res.statusText };
      // Un refus d'autorisation ne se répare pas en réessayant.
      if (res.status === 401 || res.status === 403 || res.status === 422) return last;
    } catch (err) {
      last = { ok: false, status: 0, message: err?.message ?? String(err) };
    }
    if (i < tries - 1) await sleep(2000);
  }
  return last;
}

function appendSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, markdown + '\n');
  } catch {
    // un résumé raté ne doit jamais faire échouer le run
  }
}

function annotate(level, message, title) {
  console.log(`::${level}${title ? ` title=${title}` : ''}::${message}`);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = (process.env[TOKEN_ENV] || '').trim();

  if (!token) {
    // La preuve d'inaction est un CONTRAT, pas un message : `npm run
    // check:automations` lit les annotations de ce workflow et échoue tant qu'elle
    // est là. C'est ainsi qu'un run vert qui n'a rien fait cesse d'être invisible
    // (voir ./lib/automation-evidence.mjs) — le texte se reformule librement, mais
    // il passe par `evidenceAnnotation`, la seule définition du canal, et il
    // reste sur STDOUT (c'est ce que le runner stocke).
    const inertReason =
      'Dependabot rebase — le secret DEPENDABOT_REBASE_TOKEN n’est pas posé, donc aucune PR n’a été ' +
      'mise à jour. Ajoutez un PAT (fine-grained : Contents + Pull requests read/write) dans ' +
      'Settings → Secrets and variables → ACTIONS (jamais « Dependabot secrets ») pour l’activer.';
    console.log(evidenceAnnotation({ workflow: WORKFLOW_FILE, acted: false, reason: inertReason }));
    appendSummary(
      [
        '## Dependabot rebase — inactif',
        '',
        "Aucun token n'est posé : les PR Dependabot ne sont donc **pas** rebasées quand `main` avance.",
        '',
        'Pour activer : ajouter un PAT dans **Settings → Secrets and variables → Actions**,',
        'nommé `DEPENDABOT_REBASE_TOKEN` — fine-grained : *Contents* (read/write) + *Pull requests* (read/write) ;',
        'classic : scope `repo`. Le GITHUB_TOKEN ne peut pas servir : son push ne déclenche aucun workflow,',
        'donc les vérifications resteraient périmées (c’est le bug que ce workflow supprime).',
        '',
        '`Voir .github/workflows/dependabot-rebase.yml` pour le contrat exact.',
      ].join('\n'),
    );
    return;
  }

  const listed = await api('GET', `/repos/${repo}/pulls?state=open&per_page=100&sort=updated`, null, token);
  if (!listed.ok || !Array.isArray(listed.data)) {
    fail(
      `liste des PR illisible (${listed.status}${listed.message ? ' — ' + listed.message : ''}). ` +
        `Si c'est 401/403, le PAT est expiré ou sans droits « Pull requests: read ».`,
    );
  }

  const results = await rebaseOutOfDatePrs({
    pulls: listed.data,
    repo,
    compare: (headSha) => api('GET', `/repos/${repo}/compare/${BASE}...${headSha}`, null, token),
    updateBranch: (pr) =>
      api('PUT', `/repos/${repo}/pulls/${pr.number}/update-branch`, { expected_head_sha: pr.head.sha }, token),
    askDependabot: (pr) =>
      api('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body: '@dependabot rebase' }, token),
  });

  const icon = { rebase: '✅', dependabot: '🔁', current: '➖', skip: '⏭️', failed: '⚠️' };
  const rebased = results.filter((r) => r.action === 'rebase' || r.action === 'dependabot');
  const failures = results.filter((r) => r.action === 'failed');

  for (const r of results) {
    console.log(`${icon[r.action] ?? '•'} #${r.number} ${r.action} — ${r.detail}`);
  }

  const headline = rebased.length
    ? `${rebased.length} PR remise(s) à jour — la chaîne qualité rejoue sur chacune.`
    : 'Aucune PR Dependabot en retard.';
  console.log(`\n${headline}`);

  appendSummary(
    [
      '## Dependabot rebase',
      '',
      `**${headline}**`,
      '',
      '| PR | action | détail |',
      '|---|---|---|',
      ...results.map((r) => `| #${r.number} | ${icon[r.action] ?? '•'} ${r.action} | ${r.detail} |`),
      '',
      '_Un `rebase` (ou `dependabot`) est un push d’utilisateur : `synchronize` part et la chaîne qualité rejoue sur la PR._',
    ].join('\n'),
  );

  // Un run qui a AGI le déclare aussi, au même format : la preuve devient un
  // canal, pas un signal d'alarme. Un audit qui ne lit que les déclarations
  // d'échec ne saurait pas distinguer « a agi » de « n'a rien dit ».
  console.log(
    evidenceAnnotation({
      workflow: WORKFLOW_FILE,
      acted: true,
      reason: `${rebased.length} PR remise(s) à jour sur ${results.length} examinée(s)`,
      count: results.length,
    }),
  );

  for (const f of failures) annotate('warning', `#${f.number} : ${f.detail}`, 'Dependabot rebase');
}

// ── Entrée ──────────────────────────────────────────────────────────────────
// `main()` n'est lancé que si CE fichier est le programme : l'importer doit être
// inerte. C'est le contrat habituel du dépôt, mais ici il est mesurable, et il a
// fallu le payer : `tests/dependabot-rebase.test.ts` importe ce module pour
// tester la boucle de décision, sans token — donc `main()` imprimait la
// déclaration d'inaction dans le journal du job de tests, que
// `npm run check:automations` relit. L'audit fabriquait ainsi lui-même la preuve
// mensongère qu'il cherchait : `Quality & performance guard` était déclaré
// « vert sans avoir agi » alors que ce n'est pas cette automatisation-ci qui
// parlait. Un test doit pouvoir parler d'une automatisation sans la dénoncer.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main().catch((err) => fail(err?.message ?? String(err)));
