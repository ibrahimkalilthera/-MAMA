/**
 * Le garde du push direct — la protection que l'API refuse.
 *
 * La protection de branche rend `404` sur ce dépôt (jeton sans administration,
 * ou offre qui ne l'ouvre pas). Ce garde ne la remplace pas — il ne BLOQUE pas
 * le push — mais il rend le contournement visible : le run devient rouge avec
 * le SHA et la raison.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_COMMIT_PREFIX, directPushVerdict } from '../scripts/lib/direct-push.mjs';

const root = join(import.meta.dirname, '..');

describe('directPushVerdict — une PR, ou une exception nommée', () => {
  it('un commit associé à une PR passe', () => {
    const verdict = directPushVerdict({ associatedPulls: [{ number: 96 }], message: 'Merge pull request #96' });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /1 PR/);
  });

  it('un commit sans PR et sans préfixe de release est refusé, avec la marche à suivre', () => {
    const verdict = directPushVerdict({ associatedPulls: [], message: 'fix: corrige un solde' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /AUCUNE pull request/);
    assert.match(verdict.reason, /ouvrez une PR/);
  });

  it('un commit de release est exempté — par son préfixe, pas par son auteur', () => {
    assert.equal(RELEASE_COMMIT_PREFIX, 'chore(release):');
    const verdict = directPushVerdict({ associatedPulls: [], message: 'chore(release): 1.0.43 — huit bumps' });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /exception nommée/);
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
