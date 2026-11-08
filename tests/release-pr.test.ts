/**
 * La release par PR — la décision, avant que rien ne soit écrit.
 *
 * Ce qui est jugé ici : le numéro (jamais un numéro déjà servi, jamais une
 * régression), la branche, le message, le corps de la PR — et la réécriture des
 * DEUX lignes de version, qui doit rester chirurgicale. Les deux fichiers sont
 * suivis en CRLF ; un remplacement qui réécrirait le fichier entier donnerait
 * une PR de 10 000 lignes pour un numéro, c'est-à-dire une PR que personne ne
 * relit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUIRED_CHECK,
  bumpPackageJsonVersion,
  bumpPackageLockVersions,
  compareTriples,
  nextPatchVersion,
  normalizeVersion,
  releasePlan,
} from '../scripts/lib/release-pr.mjs';

const root = join(import.meta.dirname, '..');

const PACKAGE_JSON = [
  '{',
  '  "name": "mama-thera-finance",',
  '  "private": true,',
  '  "version": "1.0.43",',
  '  "dependencies": {',
  '    "jspdf": "1.0.43"',
  '  }',
  '}',
  '',
].join('\r\n');

const PACKAGE_LOCK = [
  '{',
  '  "name": "mama-thera-finance",',
  '  "version": "1.0.43",',
  '  "lockfileVersion": 3,',
  '  "packages": {',
  '    "": {',
  '      "name": "mama-thera-finance",',
  '      "version": "1.0.43",',
  '      "dependencies": {',
  '        "jspdf": "1.0.43"',
  '      }',
  '    },',
  '    "node_modules/jspdf": {',
  '      "version": "1.0.43"',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');

describe('les numéros', () => {
  it('normalise un numéro, refuse le reste', () => {
    assert.equal(normalizeVersion('v1.0.44'), '1.0.44');
    assert.equal(normalizeVersion(' 1.2.3 '), '1.2.3');
    assert.equal(normalizeVersion('1.0'), null);
    assert.equal(normalizeVersion('dernière'), null);
    assert.equal(normalizeVersion(undefined), null);
  });

  it('le correctif suivant, et rien de plus', () => {
    assert.equal(nextPatchVersion('1.0.43'), '1.0.44');
    assert.equal(nextPatchVersion('1.9.9'), '1.9.10');
    assert.equal(nextPatchVersion('n’importe quoi'), null);
  });

  it('compare des triples, pas des chaînes', () => {
    assert.equal(compareTriples('1.0.10', '1.0.9'), 1);
    assert.equal(compareTriples('1.0.43', '1.0.43'), 0);
    assert.equal(compareTriples('1.0.9', '1.0.10'), -1);
    assert.equal(compareTriples('x', '1.0.0'), null);
  });
});

describe('releasePlan — ce que la PR va dire', () => {
  it('sans numéro demandé, prend le correctif suivant', () => {
    const plan = releasePlan({ current: '1.0.43' });
    assert.equal(plan.ok, true);
    assert.equal(plan.version, '1.0.44');
    assert.equal(plan.branch, 'release/v1.0.44');
    assert.equal(plan.commitMessage, 'chore(release): 1.0.44');
    assert.equal(plan.prTitle, plan.commitMessage);
  });

  it('le résumé tient dans le titre, sur une seule ligne', () => {
    const plan = releasePlan({ current: '1.0.43', requested: '1.1.0', summary: '  une   dépense\nne se paie plus deux fois ' });
    assert.equal(plan.commitMessage, 'chore(release): 1.1.0 — une dépense ne se paie plus deux fois');
  });

  it('un numéro déjà servi est refusé — republier n’atteint aucun poste', () => {
    const equal = releasePlan({ current: '1.0.43', requested: '1.0.43' });
    assert.equal(equal.ok, false);
    assert.match(equal.problems.join('\n'), /strictement supérieure/);

    const lower = releasePlan({ current: '1.0.43', requested: '1.0.42' });
    assert.equal(lower.ok, false);
  });

  it('un numéro illisible est refusé au lieu d’être deviné', () => {
    const plan = releasePlan({ current: '1.0.43', requested: '1.0' });
    assert.equal(plan.ok, false);
    assert.match(plan.problems.join('\n'), /illisible/);
  });

  it('le corps de la PR nomme le check requis et ce que le commit touche', () => {
    const plan = releasePlan({ current: '1.0.43', requested: '1.0.44' });
    assert.match(plan.prBody, new RegExp(REQUIRED_CHECK.replace(/[+]/g, '\\+')));
    assert.match(plan.prBody, /`package\.json` et `package-lock\.json`/);
    assert.match(plan.prBody, /Desktop release/);
  });

  it('le check requis est bien celui que la protection exige', () => {
    assert.equal(REQUIRED_CHECK, 'Lint + tests + audit');
    const docs = readFileSync(join(root, 'docs/PROTECTION_MAIN.md'), 'utf8');
    assert.match(docs, /Lint \+ tests \+ audit/, 'le document doit nommer le même check');
  });
});

describe('la réécriture des versions — chirurgicale, en CRLF', () => {
  it('package.json : la ligne de la racine, et pas celle d’une dépendance', () => {
    const bumped = bumpPackageJsonVersion(PACKAGE_JSON, '1.0.44');
    assert.ok(bumped);
    assert.equal(bumped.replaced, 1);
    assert.equal(JSON.parse(bumped.text).version, '1.0.44');
    assert.equal(JSON.parse(bumped.text).dependencies.jspdf, '1.0.43', 'une dépendance ne bouge pas');
    assert.match(bumped.text, /\r\n/, 'les fins de ligne sont conservées');
    assert.equal(bumped.text.split('\r\n').length, PACKAGE_JSON.split('\r\n').length, 'même nombre de lignes');
  });

  it('package-lock.json : la racine ET packages[""], pas node_modules', () => {
    const bumped = bumpPackageLockVersions(PACKAGE_LOCK, '1.0.44');
    assert.ok(bumped);
    assert.equal(bumped.replaced, 2);
    const lock = JSON.parse(bumped.text);
    assert.equal(lock.version, '1.0.44');
    assert.equal(lock.packages[''].version, '1.0.44');
    assert.equal(lock.packages['node_modules/jspdf'].version, '1.0.43', 'le paquet installé ne bouge pas');
    assert.match(bumped.text, /\r\n/);
  });

  it('un fichier dont la forme est inconnue rend null — l’appelant échoue avant d’écrire', () => {
    assert.equal(bumpPackageJsonVersion('{ "name": "x" }', '1.0.44'), null);
    assert.equal(bumpPackageJsonVersion(PACKAGE_JSON, 'pas-un-numéro'), null);
    assert.equal(bumpPackageLockVersions('{ "name": "x" }', '1.0.44'), null);
    const noPackageVersion = '{\r\n  "version": "1.0.43",\r\n  "packages": {\r\n    "": {\r\n      "name": "x"\r\n    }\r\n  }\r\n}\r\n';
    assert.equal(bumpPackageLockVersions(noPackageVersion, '1.0.44'), null, 'un verrou incohérent ne se corrige pas en silence');
  });
});

describe('le chemin lui-même', () => {
  it('le script est exposé par son script npm, et il ouvre une PR', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['release:pr'], 'node scripts/release-pr.mjs');
    const script = readFileSync(join(root, 'scripts/release-pr.mjs'), 'utf8');
    assert.match(script, /\/repos\/\$\{slug\}\/pulls/, 'il ouvre la PR par l’API');
    assert.match(script, /'main'/, 'la base est main');
    // Le jeton ne doit jamais être imprimé : la seule occurrence acceptable est
    // sa lecture, et le script ne le met dans aucun console.log.
    assert.doesNotMatch(script, /console\.\w+\([^)]*token\b/, 'le jeton ne s’imprime pas');
  });
});
