// Suite for scripts/check-download-contract.mjs — the gate that binds a PDF
// generator's TERMINAL BEHAVIOUR (direct download vs preview) to the E2E step
// that drives it.
//
// Why this gate exists: on 2026-10-05 the parent receipt gained a preview, so
// its "download" button stopped downloading — the file only leaves at the
// second click, inside the modal — while `verify-pdf-download.mjs` still clicked
// once and waited. Sixty seconds of nothing, a red run on the receipt step
// alone. The defect lived in the LINK between two files, and nothing checked it.
//
// The suite judges the gate the way this repository judges every gate: on
// fabricated fixtures (a rule nobody can trigger is decoration), with the
// prose-as-code trap (a comment that CITES the label must not satisfy the E2E
// step), and the refusal of vacuity (no generator read ⇒ exit 2).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREVIEW_FLOWS,
  I18N_FILE,
  classifyGenerator,
  findPreviewOpeners,
  labelsFor,
  judgeDownloadContract,
} from '../scripts/lib/download-contract.mjs';
import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Les marqueurs sont COMPOSÉS, jamais peints en clair : la même discipline que
// les autres suites de gardes, pour qu'aucun scan ne se lise elle-même.
const call = (name: string) => `${name}(receipt, opts);`;
const entry = (key: string, value: string) => `  ${key}: '${value}',`;

describe('download-contract — la décision, sur fixtures', () => {
  it('classe un générateur : aperçu, téléchargement direct, rien', () => {
    assert.equal(classifyGenerator(call('showReceiptPreview')).kind, 'preview');
    assert.equal(classifyGenerator('downloadBytes(bytes, name);').kind, 'direct');
    assert.equal(classifyGenerator('const x = 1;').kind, 'unknown');
  });

  it('l’aperçu l’emporte sur le téléchargement (l’action de confirmation en appelle un)', () => {
    const src = `${call('showReceiptPreview')}\nfunction downloadPreparedReceipt(r){ downloadBytes(r.bytes, r.filename); }`;
    assert.equal(classifyGenerator(src).kind, 'preview');
    assert.deepEqual(findPreviewOpeners(src), ['showReceiptPreview']);
  });

  it('ne lit pas la prose : un commentaire qui cite un aperçu ne compte pas', () => {
    assert.deepEqual(findPreviewOpeners(`// ${call('showReceiptPreview')} jamais appelé`), []);
    assert.deepEqual(findPreviewOpeners('/* showReceiptPreview( */ const x = 1;'), []);
  });

  it('extrait les libellés FR et EN d’une clé', () => {
    const src = `${entry('downloadReceipt', 'Download receipt')}\n${entry('downloadReceipt', 'Télécharger le reçu')}`;
    assert.deepEqual(labelsFor(src, 'downloadReceipt'), ['Download receipt', 'Télécharger le reçu']);
  });
});

describe('download-contract — le jugement, sur fixtures', () => {
  const flow = PREVIEW_FLOWS[0];
  const previewGen = [{ path: flow.generator, source: call(flow.opener) }];
  const files = (over: Record<string, string> = {}) => ({
    [flow.modal]: `{t.${flow.labelKey}}`,
    [flow.e2e]: 'const b = [...].find(x => /télécharger le reçu|download receipt/i.test(x));',
    [I18N_FILE]: `${entry(flow.labelKey, 'Download receipt')}\n${entry(flow.labelKey, 'Télécharger le reçu')}`,
    ...over,
  });

  it('accepte un flux complet', () => {
    const r = judgeDownloadContract({ generators: previewGen, files: files() });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.flowsChecked, [flow.generator]);
  });

  it('refuse un aperçu NON DÉCLARÉ (l’incident : l’E2E ne le sait pas)', () => {
    const r = judgeDownloadContract({
      generators: [{ path: 'src/lib/pdfInconnu.ts', source: call('showMachinPreview') }],
      files: files(),
    });
    assert.match(r.problems.join('\n'), /pdfInconnu\.ts : ouvre un aperçu .*n.est pas déclaré dans PREVIEW_FLOWS/);
  });

  it('refuse une entrée déclarée dont le générateur n’ouvre plus d’aperçu', () => {
    const r = judgeDownloadContract({ generators: [{ path: flow.generator, source: 'downloadBytes(b, n);' }], files: files() });
    assert.match(r.problems.join('\n'), /déclaré comme aperçu, mais n.ouvre plus/);
  });

  it('refuse une entrée déclarée introuvable (garantie sur du code disparu)', () => {
    const r = judgeDownloadContract({ generators: [], files: files() });
    assert.match(r.problems.join('\n'), /introuvable dans le corpus/);
  });

  it('refuse une modale qui ne rend pas le bouton de confirmation', () => {
    const r = judgeDownloadContract({ generators: previewGen, files: files({ [flow.modal]: '<div>sans bouton</div>' }) });
    assert.match(r.problems.join('\n'), /n.affiche pas le bouton de confirmation/);
  });

  it('refuse un libellé présent dans une seule langue', () => {
    const r = judgeDownloadContract({ generators: previewGen, files: files({ [I18N_FILE]: entry(flow.labelKey, 'Download receipt') }) });
    assert.match(r.problems.join('\n'), /n.a que 1 libellé/);
  });

  it('refuse un E2E qui n’a pas l’étape de confirmation', () => {
    const r = judgeDownloadContract({ generators: previewGen, files: files({ [flow.e2e]: "await page.click('ancien bouton seul');" }) });
    assert.match(r.problems.join('\n'), /ne clique pas la confirmation/);
  });

  it('refuse la prose : un commentaire qui cite le libellé ne satisfait pas l’E2E', () => {
    const r = judgeDownloadContract({ generators: previewGen, files: files({ [flow.e2e]: '// on clique « Télécharger le reçu »\n' }) });
    assert.match(r.problems.join('\n'), /ne clique pas la confirmation/);
  });
});

describe('download-contract — le dépôt réel', () => {
  it('le contrôle passe sur le corpus réel et publie sa mesure', () => {
    const out = execFileSync(process.execPath, ['scripts/check-download-contract.mjs'], { cwd: root, encoding: 'utf8' });
    assert.match(out, /générateur\(s\) PDF/);
    assert.match(out, /par aperçu/);
  });

  it('le contrôle est câblé dans le script npm ET dans la chaîne qualité', () => {
    assert.match(PKG.scripts['check:download-contract'], /check-download-contract\.mjs/);
    assert.match(PKG.scripts['lint:chain'], /node scripts\/check-download-contract\.mjs/);
  });

  it('le contrôle est déclaré dans l’inventaire d’immunités', () => {
    const found = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-download-contract.mjs');
    assert.ok(found, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (found as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });
});
