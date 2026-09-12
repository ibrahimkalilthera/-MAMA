// Suite for scripts/lib/automation-evidence.mjs — the check that a green
// automation actually ACTED — plus the publisher CLI every workflow calls.
//
// Two things are locked here, and the second one is the reason the first exists:
//
//   1. LE CANAL — une preuve est un couple de champs stockés (titre + message
//      d'annotation), publié par le producteur, relu par l'audit. Aucun journal
//      n'est lu : une marque IMPRIMÉE ne prouve donc plus rien (le défaut mesuré
//      du 2026-09-12, où une suite de tests a fait accuser le mauvais workflow).
//   2. LES VERDICTS — dont les deux pièges qui coûtent un faux rouge : un run
//      ANTÉRIEUR au contrat ne pouvait rien publier (verdict `legacy`, nommé et
//      non bloquant), tandis qu'un run qui AVAIT l'étape de preuve et n'a rien
//      publié est un faux vert (verdict `unproven`, échec).
//
// Plain-node suite: no network, no token, the run and its annotations injected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EVIDENCE_PREFIX,
  EVIDENCE_STEP_NAME,
  EVIDENCE_TITLE,
  auditAutomations,
  evidenceAnnotation,
  evidenceFromAnnotations,
  evidencePayload,
  lastRunVerdict,
  parseEvidenceArgs,
  parseWorkflowFile,
  promisedEvidence,
  workflowFileFromRef,
} from '../scripts/lib/automation-evidence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-09-12T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** Un run vert terminé il y a une heure : le cas courant. */
const GREEN = { conclusion: 'success', created_at: new Date(NOW - 60 * 60 * 1000).toISOString() };
/** Un run vert terminé à l'instant : la fenêtre où une preuve peut manquer. */
const JUST_NOW = { conclusion: 'success', created_at: new Date(NOW - 5 * 1000).toISOString() };

/** Une annotation telle que l'API la rend : deux champs, rien à découper. */
const annotationOf = (input: { workflow: string; acted: boolean; reason?: string; count?: number }) => ({
  title: EVIDENCE_TITLE,
  message: evidencePayload(input),
});

const WORKFLOW = 'perf-guard.yml';

describe('le canal — une preuve publiée, jamais un journal relu', () => {
  it('la preuve est composée à un seul endroit, et le niveau dit l’état', () => {
    const acted = evidenceAnnotation({ workflow: WORKFLOW, acted: true, reason: 'chaîne verte' });
    const inert = evidenceAnnotation({ workflow: WORKFLOW, acted: false, reason: 'secret absent' });
    assert.match(acted, new RegExp(`^::notice title=${EVIDENCE_TITLE}::`));
    assert.match(inert, new RegExp(`^::warning title=${EVIDENCE_TITLE}::`));
    assert.ok(acted.includes(EVIDENCE_PREFIX));
    assert.equal(
      evidenceFromAnnotations([{ title: EVIDENCE_TITLE, message: acted.split('::').pop() ?? '' }])[0]
        .acted,
      true,
    );
  });

  it('seules les annotations qui portent le titre sont des preuves', () => {
    const records = evidenceFromAnnotations([
      { title: 'Node.js 20 actions are deprecated', message: 'avertissement ordinaire' },
      { title: EVIDENCE_TITLE, message: evidencePayload({ workflow: WORKFLOW, acted: true, reason: 'ok' }) },
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0].workflow, WORKFLOW);
  });

  it('une preuve au bon titre mais illisible est un constat, pas un silence', () => {
    const records = evidenceFromAnnotations([{ title: EVIDENCE_TITLE, message: 'pas du JSON' }]);
    assert.equal(records.length, 1);
    assert.equal(records[0].acted, null);
    const v = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: GREEN, annotations: [{ title: EVIDENCE_TITLE, message: 'pas du JSON' }], nowMs: NOW });
    assert.equal(v.verdict, 'unreadable');
    assert.equal(v.ko, true);
  });

  it('le sujet vient du runner, pas du producteur', () => {
    assert.equal(
      workflowFileFromRef('ibrahimkalilthera/-MAMA/.github/workflows/perf-guard.yml@refs/heads/main'),
      'perf-guard.yml',
    );
    assert.equal(workflowFileFromRef(''), null);
    assert.equal(workflowFileFromRef('pas-un-chemin'), null);
  });

  it('le contrat se lit sur les ÉTAPES du run, au nom de l’étape', () => {
    assert.equal(promisedEvidence([{ name: `${EVIDENCE_STEP_NAME} — déploiement Vercel` }]), true);
    assert.equal(promisedEvidence([{ name: 'Tests' }, { name: 'Node version parity' }]), false);
    assert.equal(promisedEvidence([]), false);
    assert.equal(promisedEvidence(undefined as unknown as []), false);
  });
});

describe('les verdicts', () => {
  it('une preuve qui nomme ce workflow et déclare avoir agi : acté', () => {
    const v = lastRunVerdict({
      file: WORKFLOW,
      workflow: WORKFLOW,
      run: GREEN,
      annotations: [annotationOf({ workflow: WORKFLOW, acted: true, reason: '3 PR remises à jour', count: 3 })],
      promised: true,
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'acted');
    assert.equal(v.ko, false);
    assert.match(v.reason, /3 PR remises à jour/);
    assert.match(v.reason, /3 mesuré\(s\)/);
  });

  it('une preuve qui déclare une inaction : échec, avec le motif du producteur', () => {
    const v = lastRunVerdict({
      file: 'dependabot-rebase.yml',
      workflow: 'dependabot-rebase.yml',
      run: GREEN,
      annotations: [annotationOf({ workflow: 'dependabot-rebase.yml', acted: false, reason: 'le secret n’est pas posé' })],
      promised: true,
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'inert');
    assert.equal(v.ko, true);
    assert.match(v.reason, /le secret n’est pas posé/);
  });

  it('la moindre inaction l’emporte sur la preuve la plus flatteuse du même run', () => {
    const v = lastRunVerdict({
      file: WORKFLOW,
      workflow: WORKFLOW,
      run: GREEN,
      annotations: [
        annotationOf({ workflow: WORKFLOW, acted: true, reason: 'job allé au bout' }),
        annotationOf({ workflow: WORKFLOW, acted: false, reason: 'aucun token : rien n’a été rebasé' }),
      ],
      promised: true,
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'inert');
    assert.equal(v.ko, true);
  });

  it('la preuve d’un AUTRE workflow est ignorée, et citée', () => {
    const v = lastRunVerdict({
      file: WORKFLOW,
      workflow: WORKFLOW,
      run: GREEN,
      annotations: [annotationOf({ workflow: 'deploy.yml', acted: false, reason: 'rien' })],
      promised: true,
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'unproven');
    assert.deepEqual(v.foreign, ['deploy.yml']);
  });

  it('un run vert qui avait l’étape de preuve et n’a rien publié est un faux vert', () => {
    const v = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: GREEN, annotations: [], promised: true, nowMs: NOW });
    assert.equal(v.verdict, 'unproven');
    assert.equal(v.ko, true);
    assert.match(v.reason, /n’a publié aucune preuve/);
  });

  it('un run ANTÉRIEUR au contrat n’est pas fautif — il est nommé', () => {
    const v = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: GREEN, annotations: [], promised: false, nowMs: NOW });
    assert.equal(v.verdict, 'legacy');
    assert.equal(v.ko, false);
    assert.match(v.reason, /antérieur au contrat/);
  });

  it('le module ne lit plus de journal : le transport a changé, pas seulement l’habitude', () => {
    // Un contrat se vérifie à la source : tant qu'un lecteur de journal existe,
    // quelqu'un finira par s'en servir. La ligne imprimée ci-dessous est celle
    // qu'un canal-journal aurait comptée — elle n'est plus lue par personne.
    const printed = `2026-09-12T06:23:55Z ${evidencePayload({ workflow: WORKFLOW, acted: false, reason: 'copie imprimée' })}`;
    assert.ok(printed.includes(EVIDENCE_PREFIX), 'la ligne rappelle bien l’ancien canal');
    const source = readFileSync(join(root, 'scripts', 'lib', 'automation-evidence.mjs'), 'utf8');
    for (const gone of ['/logs', 'logsUnavailable', 'LOG_GRACE_MS', 'evidenceRecords(', 'inertMarkers(', '##[warning]']) {
      assert.equal(source.includes(gone), false, `le module ne doit plus contenir « ${gone} »`);
    }
    const audit = readFileSync(join(root, 'scripts', 'check-automations.mjs'), 'utf8');
    assert.equal(/actions\/jobs\/[^`]*\/logs/.test(audit), false, 'l’audit ne télécharge plus de journal');
    assert.match(audit, /check-runs\/\$\{id\}\/annotations/, 'il lit les annotations stockées');
  });

  it('des annotations illisibles : échec au-delà de la fenêtre, attente dedans', () => {
    const old = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: GREEN, annotations: null, annotationsUnavailable: true, nowMs: NOW });
    assert.equal(old.verdict, 'unreadable');
    assert.equal(old.ko, true, 'invérifiable n’est pas un vert');

    const fresh = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: JUST_NOW, annotations: null, annotationsUnavailable: true, nowMs: NOW });
    assert.equal(fresh.verdict, 'pending');
    assert.equal(fresh.ko, false, 'une course de plateforme n’est pas un faux vert');
  });

  it('rien de publié sur un run de quelques secondes : attente, pas accusation', () => {
    const v = lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: JUST_NOW, annotations: [], promised: true, nowMs: NOW });
    assert.equal(v.verdict, 'pending');
    assert.equal(v.ko, false);
    // …et la MÊME chose une heure plus tard est un échec : la borne existe.
    assert.equal(
      lastRunVerdict({ file: WORKFLOW, workflow: WORKFLOW, run: GREEN, annotations: [], promised: true, nowMs: NOW }).verdict,
      'unproven',
    );
  });

  it('un run rouge est signalé sans second cloche, et sans exiger de preuve', () => {
    const v = lastRunVerdict({
      file: WORKFLOW,
      workflow: WORKFLOW,
      run: { conclusion: 'failure', created_at: GREEN.created_at },
      annotations: null,
      nowMs: NOW,
    });
    assert.equal(v.verdict, 'failed');
    assert.equal(v.ko, false);
  });

  it('un cron qui ne part pas est en panne ; un workflow à événement ne l’est pas', () => {
    const stalled = lastRunVerdict({
      file: 'prod-anon-rls.yml',
      name: 'Prod anon',
      hasSchedule: true,
      run: { conclusion: 'success', created_at: new Date(NOW - 30 * DAY).toISOString() },
      annotations: [annotationOf({ workflow: 'prod-anon-rls.yml', acted: true, reason: 'sondes' })],
      promised: true,
      nowMs: NOW,
    });
    assert.equal(stalled.verdict, 'dormant');
    assert.equal(stalled.ko, true);

    const eventDriven = lastRunVerdict({ file: 'desktop-release.yml', hasSchedule: false, run: null, anyRun: null, nowMs: NOW });
    assert.equal(eventDriven.verdict, 'idle');
    assert.equal(eventDriven.ko, false);
  });

  it('un workflow absent de main n’est pas un échec — mais TOUS absents en est un', () => {
    const { ok, ko } = auditAutomations({
      workflows: [{ file: 'a.yml', absent: true }, { file: 'b.yml', absent: true }],
      nowMs: NOW,
    });
    assert.equal(ok, false);
    assert.match(ko[0].reason, /actions: read/);
  });

  it('un audit qui n’examine rien n’est pas un vert', () => {
    const { ok, ko } = auditAutomations({ workflows: [], nowMs: NOW });
    assert.equal(ok, false);
    assert.equal(ko.length, 1);
    assert.match(ko[0].reason, /n’examine rien/);
  });

  it('tout le monde a agi : vert, et chaque raison nomme son producteur', () => {
    const { ok, results } = auditAutomations({
      workflows: [
        {
          file: WORKFLOW,
          name: 'Quality',
          run: GREEN,
          annotations: [annotationOf({ workflow: WORKFLOW, acted: true, reason: 'lint, tests, audit' })],
          promised: true,
        },
        {
          file: 'shared-db-watch.yml',
          name: 'Shared DB',
          run: GREEN,
          annotations: [annotationOf({ workflow: 'shared-db-watch.yml', acted: true, reason: 'site lu' })],
          promised: true,
        },
      ],
      nowMs: NOW,
    });
    assert.equal(ok, true);
    assert.deepEqual(results.map((r) => r.verdict), ['acted', 'acted']);
  });
});

describe('le producteur — la validation, sans lancer un processus', () => {
  const RUNNING = { GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/perf-guard.yml@refs/heads/main' };
  const parse = (argv: string[], env: Record<string, string> = RUNNING) => parseEvidenceArgs({ argv, env });
  const errorOf = (argv: string[], env: Record<string, string> = RUNNING) => {
    const parsed = parse(argv, env);
    assert.equal(parsed.ok, false, `attendu refusé : ${argv.join(' ')}`);
    return parsed.ok ? '' : parsed.error;
  };

  it('accepte une preuve d’action, et garde le compte', () => {
    assert.deepEqual(parse(['--acted', '--reason', 'chaîne qualité verte', '--count', '3']), {
      ok: true,
      workflow: 'perf-guard.yml',
      acted: true,
      reason: 'chaîne qualité verte',
      count: 3,
    });
  });

  it('refuse un sujet qui n’est pas le workflow en train de tourner', () => {
    assert.match(errorOf(['--acted', '--reason', 'mensonge', '--workflow', 'deploy.yml']), /ne parle que de son sujet/);
  });

  it('refuse une raison vide, les deux états, ou aucun', () => {
    assert.match(errorOf(['--acted', '--reason', '  ']), /--reason/);
    assert.match(errorOf(['--acted', '--inert', '--reason', 'les deux']), /exactement un des deux/);
    assert.match(errorOf([]), /exactement un des deux/);
  });

  it('refuse « j’ai agi sur zéro chose » et un compte qui n’en est pas un', () => {
    assert.match(errorOf(['--acted', '--reason', 'rien de mesuré', '--count', '0']), /se contredit/);
    assert.match(errorOf(['--acted', '--reason', 'beaucoup', '--count', 'trois']), /entier positif/);
  });

  it('exige un sujet explicite hors runner, et l’accepte quand il est fourni', () => {
    assert.match(errorOf(['--acted', '--reason', 'local'], {}), /GITHUB_WORKFLOW_REF/);
    const explicit = parse(['--acted', '--reason', 'local', '--workflow', 'shared-db-watch.yml'], {});
    assert.deepEqual(explicit, {
      ok: true,
      workflow: 'shared-db-watch.yml',
      acted: true,
      reason: 'local',
      count: null,
    });
  });

  it('un ordre des arguments indifférent, et `--f=valeur` accepté', () => {
    assert.deepEqual(parse(['--reason=chaîne verte', '--acted']), {
      ok: true,
      workflow: 'perf-guard.yml',
      acted: true,
      reason: 'chaîne verte',
      count: null,
    });
  });
});

describe('le producteur — le vrai CLI, de bout en bout', () => {
  // UN seul lancement réel : ce qu'il faut prouver, c'est que la sortie du
  // processus est relisible par l'audit. Chaque fork coûte ~10 s sur ce poste,
  // donc les refus se testent plus haut, en process.
  it('ce qu’il imprime se relit comme la preuve que l’audit attend (aller-retour)', () => {
    const out = execFileSync(process.execPath, ['scripts/publish-automation-evidence.mjs', '--acted', '--reason', 'chaîne qualité verte', '--count', '3'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/perf-guard.yml@refs/heads/main' },
    });
    const command = out.trim().split('\n').pop() ?? '';
    assert.match(command, /^::notice title=/);
    const message = command.slice(command.indexOf('::', 8) + 2);
    const records = evidenceFromAnnotations([{ title: EVIDENCE_TITLE, message }]);
    assert.equal(records.length, 1, 'la sortie du producteur doit être une preuve lisible');
    assert.deepEqual(
      { workflow: records[0].workflow, acted: records[0].acted, count: records[0].count },
      { workflow: 'perf-guard.yml', acted: true, count: 3 },
    );
  });

  it('une inaction sort au niveau qui la rend visible dans l’interface', () => {
    const out = execFileSync(
      process.execPath,
      ['scripts/publish-automation-evidence.mjs', '--inert', '--reason', 'secret absent'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/dependabot-rebase.yml@refs/heads/main' },
      },
    );
    assert.match(out.trim().split('\n').pop() ?? '', /^::warning title=/);
  });
});

describe('le dépôt — chaque automatisation promet une preuve', () => {
  it('chaque workflow porte l’étape nommée, sinon il échapperait au contrat', () => {
    const files = readdirSync(join(root, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(files.length >= 10, `attendu au moins 10 workflows, lu ${files.length}`);
    for (const file of files) {
      const text = readFileSync(join(root, '.github', 'workflows', file), 'utf8');
      const steps = text.split(/\r?\n/).filter((l) => /^\s*- name:/.test(l));
      assert.ok(
        steps.some((l) => l.includes(EVIDENCE_STEP_NAME)),
        `${file} doit publier sa preuve par une étape nommée « ${EVIDENCE_STEP_NAME} »`,
      );
      assert.match(text, /publish-automation-evidence\.mjs/, `${file} doit appeler le producteur`);
    }
  });

  it('l’audit connaît le nom du workflow qu’il juge, et sa cadence', () => {
    const asRead = (file: string) =>
      parseWorkflowFile(readFileSync(join(root, '.github', 'workflows', file), 'utf8'), { file });
    assert.deepEqual(asRead('perf-guard.yml'), { file: 'perf-guard.yml', name: 'Quality & performance guard', hasSchedule: false });
    // Un cron qui ne part pas est en panne : c'est la cadence qui le rend jugable
    // sur son âge, donc elle doit être lue correctement.
    assert.equal(asRead('shared-db-watch.yml').hasSchedule, true);
  });
});
