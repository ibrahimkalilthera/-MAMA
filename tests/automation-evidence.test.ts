// Suite for scripts/lib/automation-evidence.mjs — the check that a green
// automation actually ACTED.
//
// The subject is a false green that survived 22 runs in this repository:
// `Dependabot rebase` went green on every push to main while doing nothing,
// because the no-secret branch exits 0 by design. This suite locks the three
// things that make such a state impossible to hide again:
//   1. the CONVENTION — an automation that cannot act emits the `Inactif`
//      annotation, from ONE shared helper, so a reworded message cannot quietly
//      stop being detected (asserted on the real producer's source);
//   2. the VERDICTS — including the two traps: an unreadable log is a failure,
//      and an empty audit is a failure (an audit that examined nothing is
//      exactly the green it hunts);
//   3. the WIRING — the workflow reads the last run of every workflow of the
//      repository, with a token, and refuses to run without one.
// Plain-node suite: no network, no token, the run and its log are injected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DORMANT_ALLOWANCE_DAYS,
  INERT_TITLE,
  auditAutomations,
  inertAnnotation,
  inertMarkers,
  lastRunVerdict,
  parseWorkflowFile,
} from '../scripts/lib/automation-evidence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

/** A realistic log line: GitHub prefixes every line with a timestamp. */
const logWith = (annotation: string) =>
  [
    `2026-09-12T02:01:25.0000000Z ⏳ node scripts/rebase-dependabot-prs.mjs — tentative 1/3`,
    `2026-09-12T02:01:26.0000000Z ${annotation}`,
  ].join('\n');

describe('la convention : une automatisation qui ne peut pas agir le DIT', () => {
  it('l’annotation porte un titre stable, et son message nomme ce qui manque', () => {
    const marker = inertAnnotation('Dependabot rebase — le secret est absent');
    assert.match(marker, /^::warning title=Inactif::/);
    assert.match(marker, /le secret est absent/);
  });

  it('le marqueur est retrouvé même préfixé par l’horodatage du log', () => {
    const found = inertMarkers(logWith(inertAnnotation('pas de token')));
    assert.deepEqual(found, ['pas de token']);
  });

  it('deux marqueurs sont tous les deux relevés (le premier est nommé)', () => {
    const log = logWith(inertAnnotation('premier')) + '\n' + logWith(inertAnnotation('second'));
    assert.deepEqual(inertMarkers(log), ['premier', 'second']);
  });

  it('un log sans marqueur n’en invente aucun — y compris s’il parle d’« inactif » en prose', () => {
    assert.deepEqual(inertMarkers(''), []);
    assert.deepEqual(inertMarkers('le job est inactif depuis 22 runs (mais sans annotation)'), []);
    assert.deepEqual(inertMarkers('::warning title=Autre::ceci est un autre avertissement'), []);
  });
});

describe('les verdicts — le seul qui passe est « a agi »', () => {
  const green = { conclusion: 'success', created_at: daysAgo(0) };

  it('vert sans marqueur → a agi', () => {
    const v = lastRunVerdict({ name: 'Quality', run: green, log: logWith('rien à signaler'), nowMs: NOW });
    assert.equal(v.verdict, 'acted');
    assert.equal(v.ko, false);
  });

  it('vert AVEC marqueur → inerte, et le motif est celui du marqueur', () => {
    const v = lastRunVerdict({
      name: 'Dependabot rebase',
      run: green,
      log: logWith(inertAnnotation('le secret DEPENDABOT_REBASE_TOKEN n’est pas posé')),
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'inert');
    assert.equal(v.ko, true);
    assert.match(v.reason, /vert sans avoir agi/);
    assert.match(v.reason, /DEPENDABOT_REBASE_TOKEN/);
  });

  it('journal illisible → ÉCHEC : invérifiable n’est pas un vert', () => {
    for (const log of [null, '', '   \n  ']) {
      const v = lastRunVerdict({ name: 'X', run: green, log, nowMs: NOW });
      assert.equal(v.verdict, 'unreadable');
      assert.equal(v.ko, true, `un log ${JSON.stringify(log)} ne doit pas passer`);
    }
  });

  it('rouge → signalé sans doubler l’alarme (ce n’est pas ce que cet audit cherche)', () => {
    const v = lastRunVerdict({
      name: 'Deploy',
      run: { conclusion: 'failure', created_at: daysAgo(0) },
      log: logWith('boom'),
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'failed');
    assert.equal(v.ko, false);
    assert.match(v.reason, /déjà visible/);
  });

  it('planifié sans run récent → panne ; non planifié → simple inactivité', () => {
    const planned = lastRunVerdict({ name: 'Cron', hasSchedule: true, run: null, nowMs: NOW });
    assert.equal(planned.verdict, 'dormant');
    assert.equal(planned.ko, true, 'un cron qui ne part pas est en panne');

    const eventDriven = lastRunVerdict({ name: 'Release', hasSchedule: false, run: null, nowMs: NOW });
    assert.equal(eventDriven.verdict, 'idle');
    assert.equal(eventDriven.ko, false, 'un workflow déclenché à la demande n’a rien à prouver tant qu’il n’a pas tourné');
  });

  it('des runs mais AUCUN terminé → en cours, pas un cron en panne', () => {
    // Le premier run d'un nouveau workflow est EN COURS quand l'audit le lit :
    // dire « cron en panne » à ce moment-là serait faux.
    const fresh = lastRunVerdict({
      name: 'Automation audit',
      hasSchedule: true,
      run: null,
      anyRun: { status: 'in_progress', created_at: daysAgo(0) },
      nowMs: NOW,
    });
    assert.equal(fresh.verdict, 'running');
    assert.equal(fresh.ko, false);
    assert.match(fresh.reason, /premier est en cours/);
  });

  it('mais un cron qui ne TERMINE jamais retombe en panne au-delà de la tolérance', () => {
    const stuck = lastRunVerdict({
      name: 'Cron',
      hasSchedule: true,
      run: null,
      anyRun: { status: 'in_progress', created_at: daysAgo(DORMANT_ALLOWANCE_DAYS + 2) },
      nowMs: NOW,
    });
    assert.equal(stuck.verdict, 'dormant');
    assert.equal(stuck.ko, true, '« en cours » ne doit pas devenir un abri permanent');
  });

  it('workflow inconnu de GitHub → absent, pas un cron en panne', () => {
    const v = lastRunVerdict({ name: 'Tout neuf', hasSchedule: true, absent: true, nowMs: NOW });
    assert.equal(v.verdict, 'absent');
    assert.equal(v.ko, false);
    assert.match(v.reason, /pas encore poussé/);
  });

  it('un cron en retard au-delà de la tolérance est dormant, même vert', () => {
    const v = lastRunVerdict({
      name: 'Cron',
      hasSchedule: true,
      run: { conclusion: 'success', created_at: daysAgo(DORMANT_ALLOWANCE_DAYS + 1) },
      log: logWith('ok'),
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'dormant');
    assert.match(v.reason, new RegExp(`> ${DORMANT_ALLOWANCE_DAYS} j`));
  });
});

describe('auditAutomations — un audit qui n’examine rien n’est pas un vert', () => {
  it('aucun workflow → échec explicite', () => {
    const { ok, ko, results } = auditAutomations({ workflows: [], nowMs: NOW });
    assert.equal(results.length, 0);
    assert.equal(ok, false);
    assert.match(ko[0].reason, /aucun workflow lu/);
  });

  it('tous ont agi → vert, et le compte est celui des workflows jugés', () => {
    const green = { conclusion: 'success', created_at: daysAgo(0) };
    const { ok, results } = auditAutomations({
      workflows: [
        { file: 'a.yml', name: 'A', run: green, log: 'travail' },
        { file: 'b.yml', name: 'B', run: green, log: 'travail' },
      ],
      nowMs: NOW,
    });
    assert.equal(ok, true);
    assert.equal(results.length, 2);
  });

  it('TOUS absents → échec : c’est ce que produit un token sans `actions: read`', () => {
    const green = { conclusion: 'success', created_at: daysAgo(0) };
    const { ok, ko, results } = auditAutomations({
      workflows: [
        { file: 'a.yml', name: 'A', absent: true },
        { file: 'b.yml', name: 'B', absent: true },
        { file: 'c.yml', name: 'C', absent: true },
      ],
      nowMs: NOW,
    });
    assert.equal(results.length, 3, 'les trois sont rapportés, pas escamotés');
    assert.equal(ok, false);
    assert.match(ko[0].reason, /token ne voit rien/);
    // Un workflow ABSENT au milieu d'autres lus n'est pas un échec, lui :
    const mixed = auditAutomations({
      workflows: [{ file: 'a.yml', name: 'A', run: green, log: 'travail' }, { file: 'b.yml', name: 'B', absent: true }],
      nowMs: NOW,
    });
    assert.equal(mixed.ok, true);
  });

  it('un seul inerte suffit à rougir l’audit, et il est NOMMÉ', () => {
    const green = { conclusion: 'success', created_at: daysAgo(0) };
    const { ok, ko } = auditAutomations({
      workflows: [
        { file: 'a.yml', name: 'A', run: green, log: 'travail' },
        {
          file: 'dependabot-rebase.yml',
          name: 'Dependabot rebase',
          run: green,
          log: logWith(inertAnnotation('secret absent')),
        },
      ],
      nowMs: NOW,
    });
    assert.equal(ok, false);
    assert.deepEqual(ko.map((r) => r.name), ['Dependabot rebase']);
  });
});

describe('parseWorkflowFile — lire les fichiers, CRLF compris', () => {
  it('lit le nom et repère un déclencheur planifié', () => {
    const crlf = ['name: Automation audit\r', 'on:\r', '  push:\r', '  schedule:\r', "    - cron: '41 6 * * *'\r"].join('\n');
    const parsed = parseWorkflowFile(crlf, { file: 'automation-audit.yml' });
    assert.equal(parsed.name, 'Automation audit', 'un \\r capturé dans le nom est le bug d’aujourd’hui');
    assert.equal(parsed.hasSchedule, true);
  });

  it('un workflow sans cron n’est pas planifié, et sans nom il prend son fichier', () => {
    const parsed = parseWorkflowFile('on:\n  push:\n    branches: [main]\n', { file: 'perf-guard.yml' });
    assert.equal(parsed.hasSchedule, false);
    assert.equal(parsed.name, 'perf-guard.yml');
  });
});

describe('câblage — la convention est partagée, et l’audit lit le dépôt réel', () => {
  it('le producteur passe par le helper partagé (sinon la détection peut dériver en silence)', () => {
    const producer = readFileSync(join(root, 'scripts', 'rebase-dependabot-prs.mjs'), 'utf8');
    assert.match(producer, /import \{ inertAnnotation \} from '\.\/lib\/automation-evidence\.mjs'/);
    assert.match(producer, /console\.log\(\s*inertAnnotation\(/, 'l’annotation est ÉMISE sur stdout, là où le log la garde');
    assert.doesNotMatch(producer, /title=Dependabot rebase inactif/, 'plus aucun titre maison : un seul vocabulaire');
  });

  it('le titre du marqueur n’existe qu’à UN endroit du dépôt', () => {
    // Le marqueur est COMPOSÉ à partir de la constante (aucun fichier ne contient
    // `title=Inactif::` en clair, et c'est mieux ainsi) : la propriété à tenir est
    // donc « un seul fichier nomme la constante » — un second serait une seconde
    // définition, et un renommage à moitié ferait disparaître la détection sans
    // qu'aucun test ne rougisse.
    const files = [
      ...readdirSync(join(root, 'scripts')).filter((f) => /\.mjs$/.test(f)).map((f) => join(root, 'scripts', f)),
      ...readdirSync(join(root, 'scripts', 'lib')).filter((f) => /\.mjs$/.test(f)).map((f) => join(root, 'scripts', 'lib', f)),
    ];
    const naming = files.filter((f) => readFileSync(f, 'utf8').includes('INERT_TITLE'));
    assert.deepEqual(naming.map((f) => f.split(/[\\/]/).pop()), ['automation-evidence.mjs']);
    assert.equal(INERT_TITLE, 'Inactif');
  });

  it('l’audit tourne sur le dépôt RÉEL : chaque workflow est lu et au moins un est planifié', () => {
    const dir = join(root, '.github', 'workflows');
    const parsed = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => parseWorkflowFile(readFileSync(join(dir, f), 'utf8'), { file: f }));
    assert.ok(parsed.length >= 5, `attendu >= 5 workflows, lu ${parsed.length}`);
    assert.ok(parsed.some((w) => w.hasSchedule), 'au moins un cron : sinon la règle de dormance ne juge rien');
    assert.ok(
      parsed.every((w) => w.name && w.name !== w.file),
      'chaque workflow doit porter un nom : c’est lui qui apparaît dans le rapport',
    );
  });

  it('le token est obligatoire, et déclaré en CI', () => {
    const cli = readFileSync(join(root, 'scripts', 'check-automations.mjs'), 'utf8');
    assert.match(cli, /aucun token/, 'sans token : sortie en erreur, jamais un vert');
    // On juge le dernier run TERMINÉ — mais la liste n'est PAS filtrée par statut :
    // un run en cours doit rester visible, sinon l'audit prendrait son propre
    // premier run (encore en train de tourner) pour un cron en panne. Le tri se
    // fait donc sur `status` dans le code, là où l'audit le juge.
    assert.match(cli, /runs\.find\(\(r\) => r\.status === 'completed'\)/, 'le dernier run TERMINÉ est choisi par la lecture, pas par la requête');
    assert.match(cli, /runs\[0\] \?\? null/, 'un run en cours reste visible : c’est ce qui distingue « en cours » de « dormant »');
    assert.match(cli, /branch=main/, 'l’automatisation telle qu’elle est déployée');
    assert.match(cli, /\/jobs\/\$\{job\.id\}\/logs/, 'la preuve vient du journal, pas du statut');

    const workflow = readFileSync(join(root, '.github', 'workflows', 'automation-audit.yml'), 'utf8');
    assert.match(workflow, /actions: read/);
    assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(
      workflow,
      /run: npm run check:automations/,
      'la CI appelle le script par son nom (gate de recopie)',
    );
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:automations'], /check-automations\.mjs/);
  });
});
