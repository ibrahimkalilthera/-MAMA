// Suite for electron/download-policy.cjs — un téléchargement, une sortie.
//
// L'incident : le reçu PDF d'un parent arrivait DEUX fois sur les postes
// installés. Tant que `will-download` ne fixe pas le chemin d'enregistrement,
// Electron applique sa « routine d'origine » (un dialogue) ; le code ouvrait en
// plus le sien, donc un clic écrivait deux fichiers — sans aucune erreur, ce qui
// est le pire des deux mondes. La règle est donc testée comme une décision :
// jamais deux sorties pour un même téléchargement.
//
// La dernière suite lit `electron/main.cjs` : c'est le seul endroit qui puisse
// réintroduire la main en trop, et le faire ici coûte moins qu'un poste qui
// réclame le même reçu deux fois.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { downloadPlan, DEFAULT_FILENAME, SAVE_DIALOG_TITLE } = require('../electron/download-policy.cjs');

describe('download-plan — le mode automatique impose un chemin', () => {
  it('fixe le chemin sous le dossier donné, et ne propose AUCUN dialogue', () => {
    const plan = downloadPlan({ autoDir: 'C:/dl', filename: 'Recu_REC-123_Rahim.pdf' });
    assert.equal(plan.kind, 'path');
    assert.equal(plan.dir, 'C:/dl');
    assert.equal(plan.path, join('C:/dl', 'Recu_REC-123_Rahim.pdf'));
    assert.equal('options' in plan, false, 'un chemin imposé ne doit pas ouvrir de dialogue');
  });

  it('ignore un dossier vide ou en espaces', () => {
    assert.equal(downloadPlan({ autoDir: '   ', filename: 'a.pdf' }).kind, 'dialog');
  });
});

describe('download-plan — sans dossier imposé, Electron ouvre LE dialogue', () => {
  it('rend des options pour le dialogue d’Electron, sans chemin', () => {
    const plan = downloadPlan({ filename: 'Recu_REC-123_Rahim.pdf' });
    assert.equal(plan.kind, 'dialog');
    assert.deepEqual(plan.options, { defaultPath: 'Recu_REC-123_Rahim.pdf', title: SAVE_DIALOG_TITLE });
    assert.equal('path' in plan, false, 'sans chemin, c’est la routine d’Electron qui enregistre — la nôtre ferait un doublon');
  });

  it('propose un nom utilisable même sans nom de fichier', () => {
    for (const filename of [undefined, null, '', '  ']) {
      const plan = downloadPlan({ filename: filename as string | undefined });
      assert.equal(plan.options.defaultPath, DEFAULT_FILENAME);
    }
  });
});

describe('electron/main.cjs — la main en trop ne peut pas revenir', () => {
  const main = readFileSync(join(root, 'electron/main.cjs'), 'utf8');
  const handler = main.slice(main.indexOf("on('will-download'"), main.indexOf("on('will-download'") + 900);

  it('le gestionnaire existe et emploie le contrat partagé', () => {
    assert.ok(handler.length > 0, 'le gestionnaire de téléchargement a disparu de main.cjs');
    assert.match(handler, /downloadPlan\(/, 'la décision doit venir de download-policy.cjs');
    assert.match(handler, /item\.setSaveDialogOptions\(/, 'le dialogue doit être celui d’Electron, personnalisé');
  });

  it('n’ouvre plus son propre dialogue d’enregistrement', () => {
    assert.doesNotMatch(
      handler,
      /showSaveDialog/,
      'ouvrir notre dialogue EN PLUS de celui d’Electron est exactement ce qui téléchargeait le reçu deux fois',
    );
  });
});
