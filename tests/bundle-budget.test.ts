// Suite du budget d'octets par morceau (`scripts/lib/bundle-budget.mjs`).
//
// Ce module existe parce que le seul plafond de performance du dépôt est un
// score Lighthouse GLOBAL : une moyenne peut rester verte pendant qu'un morceau
// double. Les cas ci-dessous ne mesurent pas une intention de découpage — ils
// vérifient que la règle NOMME le morceau fautif, qu'elle ne se déclenche pas au
// seuil exact (sinon elle pleure pour un octet d'arrondi), et que la tolérance
// est un choix visible, jamais un silence.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHUNK_BUDGETS_KB,
  budgetVerdict,
  chunkFamily,
  formatBudgetReport,
  measureChunks,
} from '../scripts/lib/bundle-budget.mjs';

const KB = 1024;
const file = (path: string, kb: number) => ({ path, bytes: Math.round(kb * KB) });

describe('bundle-budget — la famille d’un morceau, d’après son nom livré', () => {
  it('reconnaît les familles que le découpage de Vite produit réellement', () => {
    assert.equal(chunkFamily('assets/index-AbC123.js'), 'index');
    assert.equal(chunkFamily('assets/vendor-AbC123.js'), 'vendor');
    assert.equal(chunkFamily('assets/pdfReceipt-AbC123.js'), 'pdf');
    assert.equal(chunkFamily('assets/charts-AbC123.js'), 'charts');
    assert.equal(chunkFamily('assets/ExcelImportModal-AbC123.js'), 'excel');
    assert.equal(chunkFamily('assets/icons-AbC123.js'), 'icons');
    assert.equal(chunkFamily('assets/index-AbC123.css'), 'css');
  });

  it('reconnaît les morceaux que Vite nomme d’après le COMPOSANT, pas d’après le paquet', () => {
    // Mesuré sur le build du 2026-11-08 : ces trois noms tombaient dans « other »
    // et faisaient relever le budget des morceaux divers pour des paquets qui ont
    // pourtant leur famille.
    assert.equal(chunkFamily('assets/App-BjR6P8Ux.js'), 'index', 'le shell est l’application');
    assert.equal(chunkFamily('assets/BarChart-CAE7bIPP.js'), 'charts', 'recharts s’appelle BarChart');
    assert.equal(chunkFamily('assets/es-D6FXhYAN.js'), 'pdf', 'l’entrée `es` de pdfjs contient PDFDocument');
    assert.equal(chunkFamily('assets/AppModals-BU6oKbD3.js'), 'other', '`app-` n’est pas `app`');
    assert.equal(chunkFamily('assets/index.es-BkFf5bPO.js'), 'index');
  });

  it('une feuille de style reste une feuille de style, quel que soit son nom', () => {
    assert.equal(chunkFamily('assets/pdf-AbC123.css'), 'css');
    assert.equal(chunkFamily('C:\\build\\assets\\vendor-AbC123.css'), 'css');
  });

  it('ce qui n’est reconnu n’est pas « index » : c’est « other », et il a un budget', () => {
    assert.equal(chunkFamily('assets/StudentFormModal-AbC123.js'), 'other');
    assert.equal(chunkFamily(''), 'other');
    assert.equal(typeof CHUNK_BUDGETS_KB.other, 'number');
  });
});

describe('bundle-budget — mesurer, puis juger', () => {
  it('mesure les Ko au dixième et retient le budget de la famille', () => {
    const [measured] = measureChunks([file('assets/vendor-AbC123.js', 300.44)]);
    assert.equal(measured.family, 'vendor');
    assert.equal(measured.kb, 300.4);
    assert.equal(measured.budgetKb, CHUNK_BUDGETS_KB.vendor);
    assert.equal(measured.over, false);
  });

  it('le seuil exact n’est pas un dépassement : 420 Ko tient un budget de 420', () => {
    const [exact] = measureChunks([{ path: 'assets/vendor-AbC123.js', bytes: 420 * KB }]);
    assert.equal(exact.kb, 420);
    assert.equal(exact.over, false, 'arrondir avant de comparer ferait pleurer le garde pour zéro octet');

    const [above] = measureChunks([{ path: 'assets/vendor-AbC123.js', bytes: 420 * KB + 1 }]);
    assert.equal(above.over, true, 'un octet de plus est un dépassement, et il doit se voir');
  });

  it('un dépassement est nommé avec son fichier, ses Ko et sa famille', () => {
    const measured = measureChunks([file('assets/vendor-AbC123.js', 512)]);
    const verdict = budgetVerdict(measured);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /vendor-AbC123\.js : 512 Ko > 420 Ko \(famille vendor\)/);
    assert.equal(verdict.worst, 'assets/vendor-AbC123.js');
  });

  it('le pire dépassement est celui du plus grand RAPPORT, pas du plus grand écart', () => {
    const measured = measureChunks([
      file('assets/index-AbC123.js', 520), // +20 Ko sur 500
      file('assets/icons-AbC123.js', 200), // +80 Ko sur 120
    ]);
    const verdict = budgetVerdict(measured);
    assert.equal(verdict.worst, 'assets/icons-AbC123.js');
  });

  it('tout ce qui tient rend un verdict vert, et le dit', () => {
    const measured = measureChunks([
      file('assets/index-AbC123.js', 340),
      file('assets/index-AbC123.css', 80),
    ]);
    const verdict = budgetVerdict(measured);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.worst, null);
  });

  it('la tolérance absorbe un arrondi de build — elle ne blanchit pas ce qui est affiché', () => {
    const measured = measureChunks([file('assets/vendor-AbC123.js', 425)]);
    assert.equal(budgetVerdict(measured).ok, false, 'sans tolérance, 425 > 420');
    assert.equal(budgetVerdict(measured, { tolerance: 0.05 }).ok, true, '5 % de tolérance l’absout');
    const report = formatBudgetReport(measured, budgetVerdict(measured, { tolerance: 0.05 }));
    assert.match(report, /425 Ko \/ 420 Ko/, 'le rapport dit toujours la mesure réelle');
    assert.match(report, /vendor/, 'et la famille, pour savoir quoi retirer');
  });

  it('le rapport porte l’unité et une ligne par morceau', () => {
    const measured = measureChunks([
      file('assets/index-AbC123.js', 340),
      file('assets/vendor-AbC123.js', 500),
    ]);
    const report = formatBudgetReport(measured, budgetVerdict(measured));
    assert.match(report, /Ko/);
    assert.match(report, /index/);
    assert.match(report, /vendor/);
    assert.match(report, /pire : assets\/vendor-AbC123\.js/);
  });

  it('une liste vide n’est pas une réussite silencieuse de contenu', () => {
    const verdict = budgetVerdict([]);
    assert.equal(verdict.ok, true);
    assert.match(formatBudgetReport([], verdict), /0 mesuré\(s\)/);
  });
});
