// Suite for scripts/lib/guard-immunity.mjs + its gate
// (scripts/check-guard-immunity.mjs).
//
// The rule it locks: every gate in this repository must DECLARE what it reads
// and which immunity it carries, with the proof visible in its source — or an
// exemption that says why. Silence is not a guarantee: a gate that reads prose
// as code, or that scans nothing at all, is worse than an absent gate because
// it reassures.
//
// The inventory is judged on the REAL repository (the calibration case) and on
// fabricated ones, positive and negative: a rule nobody can trigger is
// decoration, and a rule that fires on legitimate code teaches people to route
// around it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GUARD_INVENTORY,
  IMMUNITY,
  auditGuardImmunity,
  readInventoryFromDisk,
} from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** La forme attendue par l’audit — annotée pour que `{}` ne devienne pas un type vide. */
type AuditInput = Parameters<typeof auditGuardImmunity>[0];

const audit = (input: AuditInput) => auditGuardImmunity(input);
const problemsOf = (input: AuditInput) => audit(input).problems.join('\n');

describe('guard-immunity — ce que chaque contrôle lit, et ce qui l’immunise', () => {
  it('le corpus réel est propre : chaque contrôle déclaré, chaque immunité prouvée', () => {
    const disk = readInventoryFromDisk({
      root,
      readFile: (p) => readFileSync(p, 'utf8'),
      list: (dir) => {
        try {
          return readdirSync(dir) as string[];
        } catch {
          return [];
        }
      },
    });
    const { checked, problems } = auditGuardImmunity(disk);
    assert.deepEqual(problems, [], 'l’inventaire tient sur le dépôt tel qu’il est');
    assert.equal(checked, GUARD_INVENTORY.length);
    assert.ok(disk.present.length >= 15, 'les contrôles présents sont bien tous lus');
  });

  it('un contrôle non déclaré est un échec', () => {
    const problems = problemsOf({
      present: ['check-forbidden-any.mjs', 'check-nouveau.mjs'],
      sources: {},
    });
    assert.match(problems, /check-nouveau\.mjs/);
    assert.match(problems, /n’est pas déclaré/);
  });

  it('une entrée périmée est un échec — sinon l’inventaire garde des garanties sur du code mort', () => {
    const problems = problemsOf({ present: ['check-gate-sentinels.mjs'], sources: {} });
    assert.match(problems, /introuvable dans scripts\//);
  });

  it('une immunité déclarée sans preuve dans la source est un échec', () => {
    const problems = problemsOf({
      present: ['check-forbidden-any.mjs'],
      sources: { 'check-forbidden-any.mjs': 'const x = 1;\n' },
    });
    assert.match(problems, /prose-blind/);
    assert.match(problems, /non prouvée/);
    assert.match(problems, /non-vacuous/);
  });

  it('la preuve peut vivre dans le module partagé, si le contrôle le nomme', () => {
    const base = {
      present: ['check-test-integrity.mjs'],
      sources: { 'check-test-integrity.mjs': 'run();\n' },
    };
    assert.match(problemsOf(base), /immunité « prose-blind » non prouvée/);
    const delegated = problemsOf({
      ...base,
      libs: { 'test-integrity.mjs': 'export const f = (s) => maskComments(s);\n' },
    });
    assert.doesNotMatch(delegated, /prose-blind/);
  });

  it('une exemption muette est un trou, une exemption motivée est un choix', () => {
    const entry = (reason: string) => [
      { check: 'check-audit.mjs', input: 'process', needs: [], exempt: { [IMMUNITY.NON_VACUOUS]: reason } },
    ];
    const silent = audit({ present: [], sources: {}, inventory: entry('   ') });
    assert.match(silent.problems.join('\n'), /exemption « non-vacuous » sans raison/);
    assert.deepEqual(silent.exempted, []);

    const motivated = audit({
      present: [],
      sources: {},
      inventory: entry('le verdict vient d’un code de sortie, il n’y a pas de corpus à lire'),
    });
    assert.deepEqual(motivated.problems, []);
    assert.equal(motivated.exempted.length, 1);
  });

  it('le contrôle tourne sur le corpus réel et le dit', () => {
    const out = execFileSync(process.execPath, ['scripts/check-guard-immunity.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(out, /contrôle\(s\) inventorié\(s\)/);
    assert.match(out, /chaque immunité déclarée a sa preuve/);
  });

  it('le contrôle est câblé dans le script npm ET dans la chaîne qualité', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:guard-immunity'], /check-guard-immunity\.mjs/);
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-guard-immunity\.mjs/);
  });
});
