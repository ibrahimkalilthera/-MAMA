/**
 * Le garde du push direct — la ceinture derrière la protection de branche.
 *
 * La protection de `main` est active et vaut désormais aussi pour
 * l'administrateur (`enforce_admins: true`) : GitHub refuse un push direct pour
 * tous les comptes. Ce garde ne la remplace pas — il ne BLOQUE pas le push — mais
 * il rend visible le jour où un commit arriverait quand même : run rouge, avec
 * le SHA et la raison. Et il n'exempte plus rien par le message : depuis que les
 * releases ont leur PR, `chore(release):` n'est plus un laissez-passer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directPushVerdict } from '../scripts/lib/direct-push.mjs';

const root = join(import.meta.dirname, '..');

describe('directPushVerdict — une PR, et rien d’autre', () => {
  it('un commit associé à une PR passe', () => {
    const verdict = directPushVerdict({ associatedPulls: [{ number: 96 }], message: 'Merge pull request #96' });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /1 PR/);
  });

  it('un commit sans PR est refusé, avec la marche à suivre', () => {
    const verdict = directPushVerdict({ associatedPulls: [], message: 'fix: corrige un solde' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /AUCUNE pull request/);
    assert.match(verdict.reason, /ouvrez une PR/);
  });

  it('un commit de release n’est plus exempté : il passe par une PR comme le reste', () => {
    const verdict = directPushVerdict({ associatedPulls: [], message: 'chore(release): 1.0.44 — deux correctifs' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /release:pr/);
  });

  it('le module ne porte plus d’exception par préfixe de message', () => {
    const source = readFileSync(join(root, 'scripts/lib/direct-push.mjs'), 'utf8');
    assert.doesNotMatch(source, /RELEASE_COMMIT_PREFIX/, 'aucune constante d’exemption ne doit subsister');
    assert.doesNotMatch(source, /startsWith\(/, 'le message n’est plus un critère : seule la provenance compte');
  });

  it('une réponse illisible ne fabrique pas un rouge', () => {
    assert.equal(directPushVerdict({ associatedPulls: null, message: 'fix: x' }).ok, true);
    assert.equal(directPushVerdict({ message: 'fix: x' }).ok, true);
    assert.equal(directPushVerdict().ok, true);
  });

  it('le workflow tourne sur les pushes vers main, avec les droits minimaux', () => {
    const workflow = readFileSync(join(root, '.github/workflows/main-direct-push-guard.yml'), 'utf8');
    assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/, 'il doit écouter les pushes sur main');
    assert.match(workflow, /pull-requests:\s*read/, 'lire les PR associées demande ce droit');
    // Le script est appelé par SON SCRIPT npm, jamais recopié : un workflow qui
    // réécrit la commande peut rester vert le jour où `package.json` change
    // (scripts/lib/ci-commands.mjs refuse cette recopie pour cette raison).
    assert.match(workflow, /run: npm run check:direct-push/);
    // Pas de `contents: write` : ce garde ne doit rien pouvoir modifier.
    assert.doesNotMatch(workflow, /contents:\s*write/);
  });
});
