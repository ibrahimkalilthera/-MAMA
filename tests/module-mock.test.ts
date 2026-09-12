// Suite for tests/module-mock.ts — the helper that picks the option name
// `mock.module()` reads on the running Node.
//
// Two properties carry the weight, and neither could be assumed:
//   1. the SAME helper answers "which shape" on Node 22 (namedExports) and on a
//      consolidated runtime (exports, ≥24.20/25.9) — so the "older API" branch is
//      asserted against a fake tracker, and the "consolidated" branch against the
//      validation error that API raises;
//   2. the shape it picks actually MOCKS: the live case registers a real builtin
//      mock through the helper and checks the fake is what an import sees. An
//      inert mock is the failure this repo already paid for — on Node 22 the
//      wrong option name registers, reports nothing, and the suite dies at the
//      import with "spawn is not a function".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PROBE_SPECIFIER,
  mockExportsSupported,
  mockModule,
  moduleMockOptions,
  supportsMockExports,
} from './module-mock';
import { maskTemplateLiterals, stripComments } from '../scripts/lib/test-integrity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A tracker whose `module()` behaves like one of the three runtimes we met:
 * a consolidated one (it validates `options.exports`), an older one (it accepts
 * the call and registers), or one without module mocking at all.
 */
function trackerLike(behaviour: 'consolidated' | 'older' | 'absent') {
  const calls: { specifier: string; options: Record<string, unknown> }[] = [];
  let restores = 0;
  const mockApi = {
    module(specifier: string, options: object) {
      calls.push({ specifier, options: options as Record<string, unknown> });
      if (behaviour === 'consolidated') {
        const error = Object.assign(new Error("The property 'options.exports' ..."), {
          code: 'ERR_INVALID_ARG_TYPE',
        });
        throw error;
      }
      if (behaviour === 'absent') throw new TypeError('mock.module is not a function');
      return {
        restore: () => {
          restores += 1;
        },
      };
    },
  };
  return { mockApi, calls, restores: () => restores };
}

describe('module-mock — quel nom d’option ce runtime lit-il ?', () => {
  it('une API consolidée est reconnue à l’erreur de validation de `options.exports`', () => {
    const { mockApi, calls } = trackerLike('consolidated');
    assert.equal(supportsMockExports(mockApi), true);
    assert.deepEqual(calls[0].options, { exports: null }, 'la sonde n’offre que `exports`');
  });

  it('une API plus ancienne est reconnue à ce qu’elle ACCEPTE cette option', () => {
    const { mockApi, calls, restores } = trackerLike('older');
    assert.equal(supportsMockExports(mockApi), false);
    assert.equal(calls[0].specifier, PROBE_SPECIFIER, 'la sonde emprunte un builtin, sans l’importer');
    assert.equal(restores(), 1, 'le mock vide de la sonde est retiré dans le même tick');
  });

  it('sans `mock.module` (flag absent) ou sur une erreur sans code, la réponse est « non »', () => {
    assert.equal(supportsMockExports(trackerLike('absent').mockApi), false);
    assert.equal(
      supportsMockExports({
        module() {
          throw new Error('boom');
        },
      }),
      false,
    );
  });

  it('le choix de forme est assertable des deux côtés (le seam)', () => {
    const named = { spawn: () => null };
    assert.deepEqual(moduleMockOptions(named, true), { exports: named });
    assert.deepEqual(moduleMockOptions(named, false), { namedExports: named });
  });

  it('et c’est le choix du runtime qui s’applique par défaut', () => {
    const shape = Object.keys(moduleMockOptions({}))[0];
    assert.equal(
      shape,
      mockExportsSupported() ? 'exports' : 'namedExports',
      'la forme par défaut est celle que la sonde a décidée',
    );
  });
});

describe('module-mock — la forme choisie mocke POUR DE VRAI', () => {
  it('un builtin mocké par le helper rend le faux à l’import', async () => {
    // `node:querystring` : un builtin que rien d'autre dans ce fichier ne charge,
    // donc le mock ne fuit sur aucun autre contrat. Le seul fait mesuré ici est
    // celui qui compte : l'import voit le FAUX (donc l'option nommée a été lue).
    mockModule('node:querystring', {
      parse: () => 'FAKE',
    });
    const { parse } = await import('node:querystring');
    assert.equal(parse('a=1'), 'FAKE');
  });
});

describe('module-mock — une seule définition', () => {
  it('aucune suite ne nomme plus l’option elle-même', () => {
    // Le nom dépend du runtime : recopié dans une suite, il redevient faux sur
    // l'autre moitié des machines. Les fixtures du gate d'intégrité construisent
    // leur texte dans des template literals — du code comme DONNÉE, masqué par
    // le MÊME lecteur que le gate (`maskTemplateLiterals`, qui sait qu'un
    // backtick échappé n'en ferme pas un : ma première version naîve accusait le
    // fichier qui teste ce gate).
    const offenders = readdirSync(join(root, 'tests'))
      .filter((name) => /\.test\.(ts|tsx)$/.test(name))
      .filter((name) => {
        const source = maskTemplateLiterals(stripComments(readFileSync(join(root, 'tests', name), 'utf8')));
        return /\bmock\.module\(/.test(source);
      });
    assert.deepEqual(offenders, [], 'passez par `mockModule` de tests/module-mock.ts');
  });
});
