// Suite for the content-addressed quality-chain skip (scripts/lib/chain-cache.mjs)
// and the hook wiring that uses it (scripts/hook-quality-chain.mjs).
//
// WHY THIS EXISTS
// ---------------
// Measured from node_modules/.cache/chain-timings.json (20 runs): the chain costs
// 75–87 s — lint ≈ 43 s, tests ≈ 32 s, audit ≈ 0,1 s cached. It ran TWICE per
// change (pre-commit, then pre-push) on the very same content, the one the commit
// had just frozen: ~2 min 40 of waiting per push without re-verifying a byte.
//
// The second defect these cases lock: `parseArgs` returns an `opts` object whose
// `timeoutMs` default (300 s) the hook passed unconditionally, silently replacing
// its own 25-minute watchdog. A legitimate run on a loaded machine was therefore
// killed mid-flight and retried, which is how a healthy commit ended in husky's
// confusing `command not found (127)`.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseArgs } from '../scripts/git-retry.mjs';
import { runHookQualityChain } from '../scripts/hook-quality-chain.mjs';
import {
  CHAIN_CACHE_TTL_MS,
  chainCacheVerdict,
  chainGreenRecord,
  nodeMajorOf,
} from '../scripts/lib/chain-cache.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const TREE = 'a'.repeat(40);
const green = (over: Record<string, unknown> = {}) => ({
  treeOid: TREE,
  at: NOW - 60_000,
  nodeMajor: '22',
  steps: ['audit', 'lint', 'test'],
  ...over,
});

/** The base call: everything lines up, so the verdict is the thing under test. */
const verdict = (over: Record<string, unknown> = {}) =>
  chainCacheVerdict({
    cache: green(),
    treeOid: TREE,
    steps: ['lint', 'test', 'audit'],
    nodeMajor: '22',
    dirty: false,
    nowMs: NOW,
    ...over,
  } as Parameters<typeof chainCacheVerdict>[0]);

describe('sauter la chaîne : seulement quand rien n’a changé', () => {
  it('même arbre, même runtime, arbre propre → sautée', () => {
    const v = verdict();
    assert.equal(v.skip, true);
    assert.match(v.reason, /déjà vérifié/);
  });

  it('un contenu différent rejoue — c’est la seule condition qui compte vraiment', () => {
    const v = verdict({ treeOid: 'b'.repeat(40) });
    assert.equal(v.skip, false);
    assert.match(v.reason, /contenu différent/);
  });

  it('la copie de travail modifiée rejoue (la chaîne lit le disque, pas l’index)', () => {
    const v = verdict({ dirty: true });
    assert.equal(v.skip, false);
    assert.match(v.reason, /non indexées/);
  });

  it('un maillon jamais vérifié rejoue ; une couverture plus large suffit', () => {
    const missing = verdict({ steps: ['lint', 'test', 'audit', 'build'] });
    assert.equal(missing.skip, false);
    assert.match(missing.reason, /build/);
    // pre-commit vert sur lint+test+audit vaut pour un pre-push qui demande
    // moins : la couverture enregistrée est un SUR-ensemble.
    assert.equal(verdict({ steps: ['lint'] }).skip, true);
  });

  it('un autre majeur Node rejoue (un vert sous 22 ne dit rien de 24)', () => {
    const v = verdict({ nodeMajor: '24' });
    assert.equal(v.skip, false);
    assert.match(v.reason, /majeur Node/);
    // Un majeur illisible d'un côté ne fait pas sauter la vérification à tort :
    // on exige l'égalité seulement quand les DEUX côtés la connaissent.
    assert.equal(verdict({ nodeMajor: null }).skip, true);
  });

  it('un vert périmé rejoue (24 h), et QUALITY_FORCE toujours', () => {
    const old = verdict({ cache: green({ at: NOW - CHAIN_CACHE_TTL_MS - 1 }) });
    assert.equal(old.skip, false);
    assert.match(old.reason, /trop ancien/);
    const forced = verdict({ force: true });
    assert.equal(forced.skip, false);
    assert.match(forced.reason, /QUALITY_FORCE/);
  });

  it('l’absence de preuve fait rejouer, jamais sauter', () => {
    for (const over of [{ cache: null }, { treeOid: null }]) {
      const v = verdict(over);
      assert.equal(v.skip, false, JSON.stringify(over));
    }
  });

  it('le majeur épinglé se lit dans .nvmrc, avec ou sans version complète', () => {
    assert.equal(nodeMajorOf('22'), '22');
    assert.equal(nodeMajorOf('22.23.2\n'), '22');
    assert.equal(nodeMajorOf('v24.20.0'), '24');
    assert.equal(nodeMajorOf(''), null);
    assert.equal(nodeMajorOf(undefined as unknown as string), null);
  });

  it('l’enregistrement est complet et normalisé (jamais un incrément partiel)', () => {
    const record = chainGreenRecord({ treeOid: TREE, steps: ['test', 'lint', 'test'], nodeMajor: '22', nowMs: NOW });
    assert.deepEqual(record, { treeOid: TREE, at: NOW, nodeMajor: '22', steps: ['lint', 'test'] });
  });
});

describe('le hook s’en sert, et n’enregistre que sur un vrai vert', () => {
  const fakeGit = { gitStateFn: () => ({ treeOid: TREE, dirty: false }) };

  it('un arbre déjà vert → sortie 0 immédiate, sans lancer la chaîne', async () => {
    const lines: string[] = [];
    const code = await runHookQualityChain({
      ...fakeGit,
      readCacheFn: () => green(),
      writeCacheFn: () => {
        throw new Error('écrire un cache sur un saut serait un abus');
      },
      env: {},
      log: (m: string) => lines.push(m),
    });
    assert.equal(code, 0);
    assert.match(lines.join('\n'), /chaîne qualité sautée/);
  });

  it('un contenu neuf lance la chaîne et n’enregistre le vert qu’en cas de succès', async () => {
    const written: unknown[] = [];
    // La chaîne n'est PAS lancée pour de vrai : l'enfant tué laisserait des
    // orphelins node.exe, précisément le carburant de la panique de fork.
    const code = await runHookQualityChain({
      ...fakeGit,
      steps: ['lint', 'test', 'audit'],
      readCacheFn: () => ({ ...green(), treeOid: 'b'.repeat(40) }),
      writeCacheFn: (record: unknown) => written.push(record),
      env: {},
      log: () => {},
      runWithRetry: async () => 3,
    });
    assert.equal(code, 3, 'le code de la chaîne est rendu tel quel');
    assert.equal(written.length, 0, 'un échec ne doit JAMAIS enregistrer un vert');
  });

  it('un vert enregistre l’arbre exact et les maillons vérifiés', async () => {
    const written: Array<Record<string, unknown>> = [];
    const code = await runHookQualityChain({
      ...fakeGit,
      steps: ['lint', 'audit'],
      readCacheFn: () => null,
      writeCacheFn: (record: unknown) => written.push(record as Record<string, unknown>),
      env: {},
      log: () => {},
      runWithRetry: async () => 0,
    });
    assert.equal(code, 0);
    assert.equal(written.length, 1, 'un vert complet s’enregistre une fois');
    assert.equal(written[0].treeOid, TREE);
    assert.deepEqual(written[0].steps, ['audit', 'lint']);
  });

  it('QUALITY_FORCE=1 rejoue même sur un arbre déjà vert', async () => {
    const lines: string[] = [];
    let launched = false;
    await runHookQualityChain({
      ...fakeGit,
      readCacheFn: () => green(),
      env: { QUALITY_FORCE: '1' },
      log: (m: string) => lines.push(m),
      runWithRetry: async () => {
        launched = true;
        return 0;
      },
    });
    assert.equal(launched, true, 'QUALITY_FORCE doit relancer la chaîne');
    assert.doesNotMatch(lines.join('\n'), /sautée/);
  });
});

describe('la panne qui a fait échouer le commit ne peut plus se reproduire', () => {
  it('--timeout-ms ne vaut comme override que s’il est DEMANDÉ', () => {
    const asked = parseArgs(['--timeout-ms=1000', 'status']).opts as { timeoutMsExplicit?: boolean };
    assert.equal(asked.timeoutMsExplicit, true);
    const notAsked = parseArgs(['--sweep', 'status']).opts as { timeoutMsExplicit?: boolean };
    assert.notEqual(notAsked.timeoutMsExplicit, true);
  });

  it('le hook ne transmet le timeout que s’il a été demandé', () => {
    const hook = readFileSync(join(root, 'scripts', 'hook-quality-chain.mjs'), 'utf8');
    assert.match(hook, /\.\.\.\(opts\.timeoutMsExplicit \? \{ timeoutMs: opts\.timeoutMs \} : \{\}\)/);
    // Le watchdog large doit rester la valeur par défaut de la fonction.
    assert.match(hook, /timeoutMs = 1500000/);
  });
});
