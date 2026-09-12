// Suite for scripts/lib/evidence-publisher.mjs — la porte par laquelle un script
// d'automatisation publie ce qu'il a MESURÉ.
//
// Trois choses sont verrouillées ici, et chacune a coûté un incident réel :
//
//   1. LE MANDAT — un script ne parle que si l'étape qui l'exécute le lui a
//      accordé (`AUTOMATION_EVIDENCE=1`). C'est ce qui empêche une suite de tests
//      de déposer une preuve au nom du job qui la fait tourner (2026-09-12 : le
//      job de tests portait la déclaration d'inaction de Dependabot).
//   2. LE SUJET — imposé par le runner, et une contradiction est REFUSÉE : un
//      script partagé par deux workflows (l'audit RLS anon) prend le sujet du
//      runner, mais aucun ne peut signer au nom d'un autre.
//   3. LE REFUS EST UN ÉCHEC — une preuve mal formée ne s'imprime pas en silence :
//      elle lève. Une automatisation qui ne peut pas prouver ce qu'elle a fait
//      n'est pas une automatisation verte.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVIDENCE_TITLE,
  evidenceFromAnnotations,
  lastRunVerdict,
} from '../scripts/lib/automation-evidence.mjs';
import { EVIDENCE_MANDATE_ENV, publishEvidence } from '../scripts/lib/evidence-publisher.mjs';

const RUNNING = { GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/shared-db-watch.yml@refs/heads/main' };

/** Un `out` qui retient au lieu d'imprimer : le test juge, il ne pollue pas. */
const recorder = () => {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
};

describe('le mandat — qui a le droit de publier', () => {
  it('sans mandat : silence, et rien qui ressemble à une preuve', () => {
    const { lines, out } = recorder();
    const result = publishEvidence({ acted: true, reason: 'mesure' }, { env: RUNNING, out });
    assert.equal(result.published, false);
    assert.equal(result.workflow, null);
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(`${EVIDENCE_MANDATE_ENV}=1`));
    assert.equal(lines[0].includes('::'), false, 'aucune commande d’annotation n’est imprimée');
  });

  it('avec le mandat : la preuve sort, et l’audit la relit', () => {
    const { lines, out } = recorder();
    const result = publishEvidence(
      { acted: true, reason: 'site lu : 7 module(s)', count: 7 },
      { env: { ...RUNNING, [EVIDENCE_MANDATE_ENV]: '1' }, out },
    );
    assert.equal(result.published, true);
    assert.equal(result.workflow, 'shared-db-watch.yml');
    const command = lines[lines.length - 1];
    assert.match(command, /^::notice title=/);
    // Aller-retour complet : ce que le script imprime EST ce que l'audit lira.
    const records = evidenceFromAnnotations([
      { title: EVIDENCE_TITLE, message: command.slice(command.indexOf('::', 8) + 2) },
    ]);
    assert.deepEqual(
      { workflow: records[0].workflow, acted: records[0].acted, count: records[0].count },
      { workflow: 'shared-db-watch.yml', acted: true, count: 7 },
    );
  });

  it('un mandat d’inaction sort au niveau qui se voit dans l’interface', () => {
    const { lines, out } = recorder();
    publishEvidence(
      { acted: false, reason: 'npm audit injoignable — gate sauté' },
      { env: { ...RUNNING, [EVIDENCE_MANDATE_ENV]: '1' }, out },
    );
    assert.match(lines[lines.length - 1], /^::warning title=/);
  });
});

describe('le sujet — imposé par le runner, jamais choisi', () => {
  it('un script partagé prend le sujet du workflow qui tourne', () => {
    const { out } = recorder();
    const asProd = publishEvidence(
      { acted: true, reason: 'sondes anon distantes' },
      { env: { GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/prod-anon-rls.yml@refs/heads/main', [EVIDENCE_MANDATE_ENV]: '1' }, out },
    );
    assert.equal(asProd.workflow, 'prod-anon-rls.yml');
    const { out: out2 } = recorder();
    const asLocal = publishEvidence(
      { acted: true, reason: 'sondes anon locales' },
      { env: { GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/supabase-migrations.yml@refs/heads/main', [EVIDENCE_MANDATE_ENV]: '1' }, out: out2 },
    );
    assert.equal(asLocal.workflow, 'supabase-migrations.yml');
  });

  it('un script qui a une IDENTITÉ signe sous son nom, même lancé par un autre workflow', () => {
    // Cas réel, et il a coûté : la suite de `perf-guard.yml` exécute le script du
    // rebase Dependabot dans SON job. Prendre le sujet de l'ambiance lui faisait
    // signer `perf-guard.yml` — la déclaration d'une autre automatisation, dans
    // le journal de celle-ci (l'incident du 2026-09-12).
    const { out } = recorder();
    const result = publishEvidence(
      { workflow: 'dependabot-rebase.yml', acted: false, reason: 'secret absent' },
      { env: { ...RUNNING, [EVIDENCE_MANDATE_ENV]: '1' }, out },
    );
    assert.equal(result.workflow, 'dependabot-rebase.yml');
    const signedAs: string = result.workflow ?? '';
    assert.notEqual(signedAs, 'shared-db-watch.yml', 'l’ambiance n’a pas signé');
  });

  it('une identité qui n’est pas celle du run ne se fait pas croire : elle est ÉTRANGÈRE', () => {
    // La contrepartie, mesurée dans les verdicts : une preuve au nom d'un autre
    // workflow n'est jamais comptée, donc l'erreur d'identité rend le run du
    // script « sans preuve » (rouge) au lieu de le faire passer en silence.
    const { lines, out } = recorder();
    const result = publishEvidence(
      { workflow: 'un-workflow-inexistant.yml', acted: true, reason: 'mesure d’un autre workflow' },
      { env: { ...RUNNING, [EVIDENCE_MANDATE_ENV]: '1' }, out },
    );
    const printed = lines[lines.length - 1];
    const verdict = lastRunVerdict({
      file: 'shared-db-watch.yml',
      workflow: 'shared-db-watch.yml',
      run: { conclusion: 'success', created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      annotations: [{ title: EVIDENCE_TITLE, message: printed.slice(printed.indexOf('::', 8) + 2) }],
      promised: true,
    });
    assert.equal(result.published, true);
    assert.equal(verdict.verdict, 'unproven');
    assert.deepEqual(verdict.foreign, ['un-workflow-inexistant.yml']);
  });

  it('sans runner et sans sujet déclaré : refus, jamais une devinette', () => {
    const { out } = recorder();
    assert.throws(
      () => publishEvidence({ acted: true, reason: 'local' }, { env: { [EVIDENCE_MANDATE_ENV]: '1' }, out }),
      /GITHUB_WORKFLOW_REF/,
    );
  });
});

describe('le refus — une preuve mal formée fait rougir le producteur', () => {
  const mandated = (out: (line: string) => void) => ({ env: { ...RUNNING, [EVIDENCE_MANDATE_ENV]: '1' }, out });

  it('une raison vide ne prouve rien', () => {
    const { out } = recorder();
    assert.throws(() => publishEvidence({ acted: true, reason: '   ' }, mandated(out)), /--reason/);
  });

  it('« j’ai agi sur zéro chose » se contredit', () => {
    const { out } = recorder();
    assert.throws(() => publishEvidence({ acted: true, reason: 'rien mesuré', count: 0 }, mandated(out)), /se contredit/);
  });

  it('aucun état n’est un état refusé', () => {
    const { out } = recorder();
    assert.throws(() => publishEvidence({ reason: 'sans état' }, mandated(out)), /exactement un des deux/);
  });
});
