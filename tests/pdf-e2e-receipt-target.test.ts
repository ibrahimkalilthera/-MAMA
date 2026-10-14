// ─────────────────────────────────────────────────────────────────────────────
// LE GESTE « TÉLÉCHARGER LE REÇU » — VISÉ PAR SON MARQUEUR, JAMAIS PAR SON MOT
//
// Ce que ce contrôle garde est un rouge payé, et mesuré. Le 2026-10-14, le
// pixel-check E2E (`scripts/verify-pdf-download.mjs`, mode `recu-parent`) est
// tombé sur DEUX commits de suite avec « aperçu du reçu non affiché — bouton
// « Télécharger le reçu » introuvable » : l'onglet du rail « Reçus muets »
// (`navSilentReceipts`), rendu AVANT les modales dans le DOM, dit « Reçus
// muets » — il matchait donc /reçu/i, et recevait le clic destiné au reçu de la
// fiche. Le contrôle quittait la fiche ouverte, ne voyait aucun aperçu, et
// accusait l'application d'un défaut qui n'existait pas : le geste du guichet,
// lui, allait très bien.
//
// La leçon n'est pas « une fonctionnalité a cassé un test ». C'est qu'un
// contrôle qui vise un MOT dépend du vocabulaire de l'écran ENTIER — y compris
// de mots qui n'ont rien à voir avec lui — tandis qu'un MARQUEUR (`data-slot`)
// appartient au geste, et survit à une traduction comme à un onglet voisin.
//
// Trois verrous, dans l'ordre où ils peuvent céder :
//
//   1. le SCRIPT ne matche plus aucun libellé : un littéral de regex qui nomme
//      le reçu et s'applique à un `.test(...)` est refusé. La source est lue
//      BLANCHIE (`maskComments`) — ce fichier-ci cite le motif dans sa prose, et
//      un contrôle qui lirait la prose comme du code se contenterait de se lire
//      lui-même ;
//   2. le MARQUEUR existe vraiment : chaque hôte du geste le déclare (le carnet
//      de la fiche, la carte d'un membre, l'aperçu) — un sélecteur qui ne
//      résoudrait rien ferait retomber le pixel-check dans le silence ;
//   3. la SÉLECTION, éprouvée sur un DOM réel (happy-dom) : le même document
//      porte l'onglet du rail ET le bouton marqué, et c'est le marqué qui est
//      trouvé — la règle 1 est aussi éprouvée par MUTATION sur une copie abîmée
//      du script, parce qu'une règle qu'aucune mutation ne fait rougir ne
//      regarde rien.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installDomGlobals } from './harness';
import { maskComments } from '../scripts/lib/source-text.mjs';
import {
  PREVIEW_DOWNLOAD_SELECTOR,
  RECEIPT_BUTTON_SELECTOR,
  RECEIPT_SLOT_PREFIX,
} from '../scripts/lib/e2e-receipt.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'scripts/verify-pdf-download.mjs';

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
/** La source d'un fichier, commentaires blanchis (longueur et lignes gardées). */
const code = (rel: string) => maskComments(read(rel));

/** Le mot qu'un contrôle ne doit plus employer pour viser le geste. */
const RECEIPT_WORD = /re[çc]u|receipt/i;

/**
 * Les littéraux de regex qui NOMMENT le reçu et s'appliquent à un `test(…)` —
 * c'est-à-dire les sélecteurs au libellé. Un document porte aussi des chemins
 * (`/templates/recu-parent.pdf`) : on ne juge donc que les lignes qui TESTENT une
 * valeur, jamais toute occurrence du mot.
 */
function labelMatchers(source: string): string[] {
  const offenders: string[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (!/\.test\s*\(/.test(line)) continue;
    const literals = line.match(/\/[^\n/]*\/[gimsuy]*/g) ?? [];
    if (literals.some((literal) => RECEIPT_WORD.test(literal))) {
      offenders.push(`ligne ${index + 1} : ${line.trim()}`);
    }
  }
  return offenders;
}

/** Une copie abîmée du script : le clic redevient un match sur le mot traduit. */
const WITH_LABEL_CLICK = (source: string): string =>
  source.replace(
    'async function downloadReceiptFromPreview(page, studentName) {',
    "async function downloadReceiptFromPreview(page, studentName) {\n  if (/reçu|recu|receipt/i.test(studentName || '')) return;",
  );

describe('pixel-check E2E — le reçu se vise par marqueur, jamais par son mot', () => {
  it('le script ne sélectionne plus aucun bouton par un mot', () => {
    const offenders = labelMatchers(code(SCRIPT));
    assert.deepEqual(offenders, [], `sélecteur(s) au libellé :\n${offenders.join('\n')}`);
  });

  it('la règle n’est pas décorative : la mutation qui remet le clic au mot est accusée', () => {
    const mutated = code(SCRIPT);
    assert.deepEqual(labelMatchers(mutated), [], 'la copie saine doit passer avant la mutation');
    const broken = WITH_LABEL_CLICK(mutated);
    assert.notEqual(broken, mutated, 'la mutation doit réellement modifier la source');
    assert.equal(labelMatchers(broken).length, 1, 'la mutation doit être accusée, et une fois');
  });

  it('le script emploie les deux marqueurs du lib, et les passe dans la page', () => {
    const source = code(SCRIPT);
    assert.match(
      source,
      /import \{ PREVIEW_DOWNLOAD_SELECTOR, RECEIPT_BUTTON_SELECTOR \} from '\.\/lib\/e2e-receipt\.mjs'/,
      'le script importe ses deux cibles de scripts/lib/e2e-receipt.mjs',
    );
    assert.match(source, /querySelector\(selector\)/, 'la cible est cherchée dans la page');
    assert.match(source, /\}, RECEIPT_BUTTON_SELECTOR\)/, 'le marqueur du reçu part dans le premier clic');
    assert.match(source, /\}, PREVIEW_DOWNLOAD_SELECTOR\)/, 'celui de l’aperçu part dans le second');
  });

  it('chaque hôte du geste déclare son marqueur', () => {
    for (const [file, slot] of [
      ['src/components/PaymentLedger.tsx', 'payment-receipt-ledger'],
      ['src/components/PayrollView.tsx', 'payment-receipt-payroll'],
      ['src/components/ReceiptPreviewModal.tsx', 'receipt-preview-download'],
    ] as const) {
      const source = code(file);
      const declarations = source.match(new RegExp(`data-slot="${slot}"`, 'g')) ?? [];
      assert.equal(declarations.length, 1, `${file} doit déclarer ${slot} exactement une fois`);
    }
  });

  it('les sélecteurs ne portent aucun libellé traduit (un marqueur est un nom, pas une phrase)', () => {
    for (const selector of [RECEIPT_BUTTON_SELECTOR, PREVIEW_DOWNLOAD_SELECTOR]) {
      assert.match(selector, /^\[data-slot[^\]]*\]$/, `« ${selector} » doit être un sélecteur de marqueur`);
      assert.match(selector, /^[\x20-\x7E]+$/, `« ${selector} » ne doit porter aucun accent — donc aucun libellé`);
    }
    assert.equal(RECEIPT_BUTTON_SELECTOR, `[data-slot^="${RECEIPT_SLOT_PREFIX}"]`);
  });

  it('sur un DOM réel, le marqueur trouve le reçu de la fiche — pas l’onglet « Reçus muets »', () => {
    installDomGlobals();
    document.body.innerHTML = [
      '<nav><button type="button" title="1 reçu(s) muet(s) à rattraper"><span>Reçus muets</span></button></nav>',
      '<div role="dialog"><button type="button" data-slot="payment-receipt-ledger">Reçu</button></div>',
    ].join('');

    // Le geste tel qu'il était visé : le rail dit « Reçus muets », il vient en
    // premier dans le DOM, et c'est donc LUI que l'ancien contrôle cliquait.
    const byWord = [...document.querySelectorAll('button')].filter(
      (button) =>
        RECEIPT_WORD.test(button.textContent ?? '') ||
        RECEIPT_WORD.test(button.getAttribute('title') ?? ''),
    );
    assert.equal(byWord.length, 2, 'les deux boutons portent un mot du reçu — c’est le piège');
    assert.equal(byWord[0].textContent?.trim(), 'Reçus muets', 'le premier est l’onglet du rail');

    // Le geste tel qu'il est visé désormais.
    const target = document.querySelector(RECEIPT_BUTTON_SELECTOR);
    assert.ok(target, 'le marqueur doit résoudre le bouton du carnet');
    assert.equal(target.getAttribute('data-slot'), 'payment-receipt-ledger');
    // Identité projetée en booléen : la règle de classe du dépôt refuse qu'un
    // nœud happy-dom entre dans une assertion d'égalité (il ferait exploser le
    // tas au lieu de dire « attendu null, reçu <div…> »).
    assert.ok(target === byWord[1], 'et c’est bien le bouton du reçu, pas l’onglet');

    // Le marqueur de l'aperçu, lui, reste distinct : deux cibles, deux noms.
    assert.ok(
      document.querySelector(PREVIEW_DOWNLOAD_SELECTOR) === null,
      'aucun aperçu ouvert ici',
    );
  });
});
