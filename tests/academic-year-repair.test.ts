// Suite for scripts/lib/year-refile.mjs — le jugement d'un reclassement d'année.
//
// C'est la partie du remède que le réseau n'occupe pas : elle décide quand un
// reclassement est permis, et si ce qui a été écrit est réellement passé d'une
// année à l'autre. Le script, lui, ne peut être prouvé que contre une base
// réelle ; c'est précisément pourquoi cette décision vit ici.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { knownYears, refileRefusals, refileVerdict } from '../scripts/lib/year-refile.mjs';

const ROSTER = [
  { year_name: '2024-2025', is_current: false },
  { year_name: '2025-2026', is_current: true },
  { year_name: '2026-2027', is_current: false },
];

describe('ce qu’un reclassement d’année refuse', () => {
  it('exige les DEUX années : aucune cible ne se devine', () => {
    assert.equal(refileRefusals({ years: ROSTER }).length, 2);
    assert.match(refileRefusals({ from: '2024-2025', years: ROSTER }).join(' '), /--to/);
    assert.match(refileRefusals({ to: '2026-2027', years: ROSTER }).join(' '), /--from/);
  });

  it('refuse une année cible que la base ne connaît pas', () => {
    const problems = refileRefusals({ from: '2024-2025', to: '2030-2031', years: ROSTER });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /n’existe pas dans academic_years/);
  });

  it('refuse de « reclasser » une année vers elle-même', () => {
    const problems = refileRefusals({ from: '2024-2025', to: '2024-2025', years: ROSTER });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /rien à reclasser/);
  });

  it('accepte une cible réelle, différente de la source', () => {
    assert.deepEqual(refileRefusals({ from: '2024-2025', to: '2026-2027', years: ROSTER }), []);
  });

  it('lit un roster de chaînes comme un roster de lignes', () => {
    assert.deepEqual(knownYears(['2024-2025', { year_name: ' 2026-2027 ' }, null]), ['2024-2025', '2026-2027']);
    assert.deepEqual(refileRefusals({ from: '2024-2025', to: '2026-2027', years: ['2026-2027'] }), []);
  });
});

describe('le verdict d’un reclassement', () => {
  it('est vert quand l’ancienne année est vide et que la nouvelle porte les lignes', () => {
    assert.deepEqual(refileVerdict({ from: '2024-2025', to: '2026-2027', moved: 3, afterFrom: 0, afterTo: 5 }), []);
  });

  it('refuse une mutation qui n’a rien déplacé', () => {
    const problems = refileVerdict({ from: '2024-2025', to: '2026-2027', moved: 0, afterFrom: 3, afterTo: 2 });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /rien à reclasser/);
  });

  it('refuse des lignes restées sur l’ancienne année', () => {
    const problems = refileVerdict({ from: '2024-2025', to: '2026-2027', moved: 3, afterFrom: 1, afterTo: 4 });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /il reste 1 ligne\(s\)/);
  });

  it('refuse un compte d’arrivée qui ne se referme pas', () => {
    const problems = refileVerdict({ from: '2024-2025', to: '2026-2027', moved: 3, afterFrom: 0, afterTo: 2 });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /ne porte que 2 ligne\(s\)/);
  });

  it('refuse un compte illisible plutôt que de le lire comme zéro', () => {
    const problems = refileVerdict({ from: '2024-2025', to: '2026-2027', moved: 3, afterFrom: null, afterTo: null });
    assert.equal(problems.length, 2);
    assert.match(problems.join(' '), /\?/);
  });
});
