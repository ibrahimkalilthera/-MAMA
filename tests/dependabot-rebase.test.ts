// Suite for scripts/rebase-dependabot-prs.mjs + its workflow wiring.
//
// Two things are proven here, and the second is the important one:
//
//   1. the DECISION loop — a PR that is up to date is left alone, a PR behind
//      main is updated, a conflict falls back to `@dependabot rebase`, and a
//      fork/other-base/non-Dependabot PR is never touched. Providers are
//      injected, so all of it runs without network.
//   2. the TOKEN INVARIANT — the write path must use the dedicated PAT
//      (`DEPENDABOT_REBASE_TOKEN`), never the GITHUB_TOKEN. A GITHUB_TOKEN push
//      does not trigger workflows, so the branch would be up to date and the
//      checks still stale — the exact bug this automation exists to remove, and
//      a bug that would look GREEN.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evidenceFromAnnotations, EVIDENCE_TITLE } from '../scripts/lib/automation-evidence.mjs';

const { eligibility, isBehind, rebaseOutOfDatePrs } = await import('../scripts/rebase-dependabot-prs.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'ibrahimkalilthera/-MAMA';

/** A well-formed Dependabot PR, overridable field by field. */
const makePr = (over: Record<string, unknown> = {}) => ({
  number: 43,
  state: 'open',
  draft: false,
  user: { login: 'dependabot[bot]' },
  base: { ref: 'main' },
  head: {
    ref: 'dependabot/npm_and_yarn/vite-7.1.5',
    sha: 'sha-a',
    repo: { full_name: REPO },
  },
  ...over,
});

/** Recording stubs — the three providers the loop injects. */
const providers = (behind = 0, update: { ok: boolean; status: number; message?: string } = { ok: true, status: 202 }) => {
  const calls: string[] = [];
  const seen: Array<Record<string, unknown>> = [];
  return {
    calls,
    seen,
    compare: async (sha: string) => {
      calls.push(`compare:${sha}`);
      return { ok: true, status: 200, data: { behind_by: behind } };
    },
    updateBranch: async (pr: Record<string, unknown>) => {
      calls.push('update');
      seen.push(pr);
      return update;
    },
    askDependabot: async () => {
      calls.push('ask');
      return { ok: true, status: 201 };
    },
  };
};

describe('eligibility — quelle PR Dependabot on a le droit de rebaser', () => {
  it('accepte une PR Dependabot ouverte sur main, dans ce dépôt', () => {
    const verdict = eligibility(makePr(), REPO);
    assert.equal(verdict.ok, true);
    assert.equal((verdict as { ref: string }).ref, 'dependabot/npm_and_yarn/vite-7.1.5');
  });

  it('refuse tout ce qui n’est pas à nous, avec le motif (jamais un silence)', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['fermée', { state: 'closed' }, /closed/],
      ['brouillon', { draft: true }, /brouillon/],
      ['autre base', { base: { ref: 'release' } }, /cible release/],
      ['branche renommée', { head: { ref: 'feature/vite', sha: 's', repo: { full_name: REPO } } }, /non-Dependabot/],
      ['auteur humain', { user: { login: 'ibrahimkalilthera' } }, /auteur/],
      ['fork', { head: { ref: 'dependabot/npm_and_yarn/vite-7.1.5', sha: 's', repo: { full_name: 'someone/fork' } } }, /fork/],
    ];
    for (const [label, over, expected] of cases) {
      const verdict = eligibility(makePr(over), REPO);
      assert.equal(verdict.ok, false, `${label} devrait être refusée`);
      assert.match((verdict as { reason: string }).reason, expected, `motif inattendu pour « ${label} »`);
    }
  });

  it('accepte une PR dont l’objet head ne porte pas de dépôt (payload partiel)', () => {
    const verdict = eligibility(makePr({ head: { ref: 'dependabot/npm_and_yarn/x', sha: 's' } }), REPO);
    assert.equal(verdict.ok, true);
  });
});

describe('isBehind — « vérifications périmées » a une définition mesurable', () => {
  it('vrai seulement quand main porte des commits absents de la branche', () => {
    assert.equal(isBehind({ behind_by: 3, ahead_by: 1 }), true);
    assert.equal(isBehind({ behind_by: 0, ahead_by: 1 }), false);
  });

  it('ne devine pas : un corps illisible vaut « pas en retard »', () => {
    assert.equal(isBehind({}), false);
    assert.equal(isBehind(undefined), false);
    assert.equal(isBehind(null), false);
  });
});

describe('rebaseOutOfDatePrs — la boucle de décision', () => {
  it('laisse intacte une PR à jour (aucun appel d’écriture)', async () => {
    const p = providers(0);
    const results = await rebaseOutOfDatePrs({ pulls: [makePr()], repo: REPO, compare: p.compare, updateBranch: p.updateBranch, askDependabot: p.askDependabot });
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'current');
    assert.deepEqual(p.calls, ['compare:sha-a']);
  });

  it('met à jour la branche dès qu’elle est en retard, et rend compte du sha vérifié', async () => {
    const p = providers(2);
    const results = await rebaseOutOfDatePrs({ pulls: [makePr()], repo: REPO, compare: p.compare, updateBranch: p.updateBranch, askDependabot: p.askDependabot });
    assert.equal(results[0].action, 'rebase');
    assert.match(results[0].detail, /dependabot\/npm_and_yarn\/vite-7\.1\.5/);
    assert.deepEqual(p.calls, ['compare:sha-a', 'update']);
  });

  it('un conflit (422) se rabat sur @dependabot rebase — lui seul sait refaire le lockfile', async () => {
    const p = providers(1, { ok: false, status: 422, message: 'merge conflict' });
    const results = await rebaseOutOfDatePrs({ pulls: [makePr()], repo: REPO, compare: p.compare, updateBranch: p.updateBranch, askDependabot: p.askDependabot });
    assert.equal(results[0].action, 'dependabot');
    assert.deepEqual(p.calls, ['compare:sha-a', 'update', 'ask']);
  });

  it('un refus qui n’est pas un conflit reste un échec visible (jamais un faux succès)', async () => {
    const p = providers(1, { ok: false, status: 403, message: 'Resource not accessible by personal access token' });
    const results = await rebaseOutOfDatePrs({ pulls: [makePr()], repo: REPO, compare: p.compare, updateBranch: p.updateBranch, askDependabot: p.askDependabot });
    assert.equal(results[0].action, 'failed');
    assert.match(results[0].detail, /403/);
    assert.deepEqual(p.calls, ['compare:sha-a', 'update']);
  });

  it('une comparaison illisible n’entraîne aucune écriture', async () => {
    const results = await rebaseOutOfDatePrs({
      pulls: [makePr()],
      repo: REPO,
      compare: async () => ({ ok: false, status: 500, message: 'server error' }),
      updateBranch: async () => {
        throw new Error('updateBranch ne devait pas être appelé');
      },
      askDependabot: async () => {
        throw new Error('askDependabot ne devait pas être appelé');
      },
    });
    assert.equal(results[0].action, 'failed');
    assert.match(results[0].detail, /compare 500/);
  });

  it('une PR de fork est ignorée sans même interroger l’API', async () => {
    const p = providers(5);
    const fork = makePr({ head: { ref: 'dependabot/npm_and_yarn/vite-7.1.5', sha: 'sha-a', repo: { full_name: 'someone/fork' } } });
    const results = await rebaseOutOfDatePrs({ pulls: [fork], repo: REPO, compare: p.compare, updateBranch: p.updateBranch, askDependabot: p.askDependabot });
    assert.equal(results[0].action, 'skip');
    assert.deepEqual(p.calls, []);
  });

  it('traite un lot mixte en conservant chaque verdict', async () => {
    const results = await rebaseOutOfDatePrs({
      pulls: [
        makePr({ number: 43 }),
        makePr({ number: 44, user: { login: 'someone' } }),
        makePr({ number: 45, head: { ref: 'dependabot/npm_and_yarn/x', sha: 'sha-b', repo: { full_name: REPO } } }),
      ],
      repo: REPO,
      compare: async (sha: string) => ({ ok: true, status: 200, data: { behind_by: sha === 'sha-a' ? 0 : 1 } }),
      updateBranch: async () => ({ ok: true, status: 202 }),
      askDependabot: async () => ({ ok: true, status: 201 }),
    });
    assert.deepEqual(
      results.map((r) => [r.number, r.action]),
      [
        [43, 'current'],
        [44, 'skip'],
        [45, 'rebase'],
      ],
    );
  });
});

// A gate that is not executed protects nothing — and here the failure mode is
// silent: swapping the PAT for the GITHUB_TOKEN would keep the workflow green
// while leaving every PR's checks stale. Reading the workflow as text (with
// comments dropped, so this suite judges the wiring and not the prose around it)
// is what makes that substitution impossible.
describe('câblage du workflow Dependabot rebase', () => {
  const stripYamlComments = (text: string) =>
    text
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
  /** Comments + doc block removed: only executable source remains. */
  const stripJsComments = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');

  const workflow = stripYamlComments(readFileSync(join(root, '.github/workflows/dependabot-rebase.yml'), 'utf8'));
  const script = stripJsComments(readFileSync(join(root, 'scripts/rebase-dependabot-prs.mjs'), 'utf8'));

  it('se déclenche quand main avance, et une fois par jour pour les PR nées en retard', () => {
    assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches: \[main\]/, 'le déclencheur push sur main a disparu');
    assert.match(workflow, /schedule:/, 'sans cron, une PR ouverte après le dernier push main resterait en retard');
  });

  it('injecte le PAT dédié sous le nom que le script lit', () => {
    assert.match(workflow, /REBASE_TOKEN:\s*\$\{\{\s*secrets\.DEPENDABOT_REBASE_TOKEN\s*\}\}/);
    assert.match(script, /REBASE_TOKEN/);
  });

  it('n’utilise JAMAIS le GITHUB_TOKEN pour écrire — son push ne déclencherait aucun workflow', () => {
    assert.doesNotMatch(workflow, /GITHUB_TOKEN/, 'le workflow ne doit référencer aucun GITHUB_TOKEN');
    // Le script MENTIONNE le GITHUB_TOKEN dans le texte du résumé (c'est le
    // remède expliqué à l'utilisateur) : ce qu'on interdit, c'est de le LIRE.
    assert.doesNotMatch(
      script,
      /process\.env(?:\.|\[\s*['"`])GITHUB_TOKEN/,
      'le script ne doit jamais lire le GITHUB_TOKEN : son push serait invisible et les checks resteraient périmés',
    );
    assert.match(script, /TOKEN_ENV = 'REBASE_TOKEN'/, 'le seul token lu doit être celui du PAT dédié');
  });

  it('lance bien le script, et prouve le majeur Node exécuté', () => {
    assert.match(workflow, /node scripts\/rebase-dependabot-prs\.mjs/);
    assert.match(workflow, /node scripts\/check-node-version\.mjs/);
  });
});

// Le module ci-dessus est importé par cette suite même : `main()` y tournait donc
// à l'import, et sans token il IMPRIMAIT la déclaration d'inaction dans le
// journal du job de tests. Or `npm run check:automations` relit ce journal pour
// savoir si une automatisation a agi — il lisait donc la déclaration de
// Dependabot dans le log de `Quality & performance guard` et déclarait CELUI-CI
// « vert sans avoir agi ». Un audit qui fabrique lui-même sa preuve est pire
// qu'inutile. Ces deux cas tiennent les deux moitiés du contrat : importer est
// silencieux, exécuter déclare.
describe('entrée — importer est silencieux, exécuter déclare', () => {
  /** Le script tel qu'un shell le lancerait, sans token, hors de ce processus. */
  const runNode = (args: string[]) =>
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, REBASE_TOKEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  /** Les preuves que la sortie d'un processus contient, relues comme l'audit le fait. */
  const proofsIn = (out: string) =>
    evidenceFromAnnotations(
      out
        .split(/\r?\n/)
        .filter((line) => line.includes('::') && line.includes('title='))
        .map((line) => ({
          title: EVIDENCE_TITLE,
          message: line.slice(line.indexOf('::', 8) + 2),
        })),
    );

  it('importer le module n’imprime AUCUNE déclaration d’inaction', () => {
    const out = runNode(['-e', "import('./scripts/rebase-dependabot-prs.mjs').then(() => {})"]);
    assert.deepEqual(
      proofsIn(out),
      [],
      `importer doit être inerte, or une preuve a été publiée : ${out.slice(0, 200)}`,
    );
  });

  it('exécuté sans token, il publie sa propre inaction (la déclaration existe toujours)', () => {
    const out = runNode(['scripts/rebase-dependabot-prs.mjs']);
    const proofs = proofsIn(out);
    assert.equal(proofs.length, 1, `sans token, l’inaction doit être publiée : ${out.slice(0, 200)}`);
    assert.equal(proofs[0].acted, false);
    assert.equal(proofs[0].workflow, 'dependabot-rebase.yml');
    assert.match(out, /DEPENDABOT_REBASE_TOKEN/);
  });
});
