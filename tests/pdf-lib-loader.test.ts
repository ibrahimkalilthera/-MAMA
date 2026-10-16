/**
 * Suite du chargeur de `pdf-lib` — le refus qui remplace un « undefined » tacite.
 *
 * CE QUI EST VERROUILLÉ ICI, ET POURQUOI (panne réelle du 2026-10-16)
 * -------------------------------------------------------------------
 * En CI, le geste d'encaissement a produit :
 *
 *     PDF receipt generation error: TypeError: Cannot destructure property
 *     'PDFDocument' of '(intermediate value)' as it is undefined
 *
 * Le message accusait la déstructuration alors que la panne était un morceau
 * (chunk) non arrivé : le helper de Vite ne relance l'erreur que si l'événement
 * `vite:preloadError` n'a pas été bloqué, donc un échec de chargement pouvait
 * être rendu comme une promesse RÉSOLUE avec `undefined`. Ces cas exigent que le
 * chargeur (1) RETENTE un chargement manqué, et (2) REFUSE un module
 * inutilisable en le NOMMANT — plus jamais un « cannot destructure ».
 *
 * Le chargeur est injectable : les cas ci-dessous ne dépendent ni du réseau ni
 * de l'ordre des morceaux, ils injectent ce que le navigateur aurait rendu.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDF_LIB_ATTEMPTS, loadPdfLib } from '../src/lib/pdfLib';

/** Ce que le navigateur rend quand tout va bien. */
const realModule = async () => import('pdf-lib');

describe('loadPdfLib — un chargement manqué est retenté, un module inutilisable est nommé', () => {
  it('rend les trois exportations employées par les générateurs (chargeur réel)', async () => {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    assert.equal(typeof PDFDocument, 'function', 'PDFDocument est la classe attendue');
    assert.equal(typeof rgb, 'function', 'rgb est la fonction attendue');
    assert.ok(StandardFonts && typeof StandardFonts.Helvetica === 'string', 'StandardFonts.Helvetica est nommé');
    // Un document VIDE se crée : c'est le geste que les quatre générateurs font
    // ensuite (charger un modèle, y dessiner) — le charger ne rend pas un objet
    // inerte.
    const doc = await PDFDocument.create();
    assert.equal(doc.getPageCount(), 0, 'un document neuf n’a aucune page');
  });

  it('RETENTE un chargement qui échoue — un morceau manqué n’est pas une panne définitive', async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      // Le premier essai échoue comme échoue un morceau non arrivé…
      if (calls === 1) throw new Error('Failed to fetch dynamically imported module: /assets/es-abc.js');
      return await realModule();
    };

    const { PDFDocument } = await loadPdfLib(flaky);
    assert.equal(calls, 2, 'le chargeur a refait la tentative (et non relu le même échec)');
    assert.equal(typeof PDFDocument, 'function', 'le second essai rend un module utilisable');
  });

  it('REFUSE un « undefined » — le symptôme exact de la CI — en nommant le chargement', async () => {
    let calls = 0;
    const rendersUndefined = async () => {
      calls += 1;
      return undefined;
    };

    await assert.rejects(
      () => loadPdfLib(rendersUndefined),
      (error: Error) => {
        assert.match(error.message, /pdf-lib/, 'le message nomme la bibliothèque en cause');
        assert.match(error.message, /undefined/, 'le message dit ce qui a été reçu');
        assert.doesNotMatch(error.message, /destructure/i, 'jamais un « cannot destructure » : il accuse le mauvais code');
        assert.equal(error.cause instanceof Error, true, 'la cause est gardée pour le diagnostic');
        return true;
      },
    );
    assert.equal(calls, PDF_LIB_ATTEMPTS, 'un `undefined` est retenté avant d’être refusé');
  });

  it('REFUSE un objet sans PDFDocument en disant ce qu’il portait', async () => {
    const empty = async () => ({ default: {}, somethingElse: 1 });
    await assert.rejects(
      () => loadPdfLib(empty),
      (error: Error) => {
        assert.match(error.message, /pdf-lib/);
        assert.match(error.message, /sans PDFDocument/, 'le refus décrit la forme reçue');
        assert.match(error.message, /somethingElse/, 'les clés reçues sont citées');
        return true;
      },
    );
  });

  it('la panne ordinaire (rejet) est retentée puis rapportée telle quelle', async () => {
    let calls = 0;
    const alwaysFails = async (): Promise<unknown> => {
      calls += 1;
      throw new Error('le réseau est tombé');
    };
    await assert.rejects(() => loadPdfLib(alwaysFails), /le réseau est tombé/);
    assert.equal(calls, PDF_LIB_ATTEMPTS, 'les deux essais ont eu lieu');
  });
});
