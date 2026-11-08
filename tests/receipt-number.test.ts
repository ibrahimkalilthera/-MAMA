/**
 * Suite de `src/lib/receiptNumber.ts` — le NUMÉRO d'un reçu.
 *
 * Le numéro venait de l'horloge : `REC-` + les six derniers chiffres de
 * `Date.now()`, soit un cycle de 16 minutes 40 secondes. Deux reçus pouvaient
 * donc porter le même numéro, et un papier officiel devenait ambigu. Ce fichier
 * verrouille ce qui remplace l'horloge :
 *
 *   • le numéro se dérive de l'id du GESTE (clé primaire de la ligne), donc le
 *     même paiement redonne toujours le même numéro, et deux paiements ne se
 *     confondent pas ;
 *   • l'exercice donne le millésime, lu dans la CHAÎNE (aucun fuseau) ;
 *   • l'ancienne forme reste reconnue pour ne PAS être réécrite ;
 *   • le module ne touche ni `Date.now()` ni `Math.random()` — le test le lit
 *     dans la source, parce qu'une régression ici serait invisible à l'écran et
 *     ne se verrait que sur un papier déjà remis.
 *
 * Pur : ni horloge, ni DOM, ni réseau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECEIPT_NUMBER_PREFIX,
  ReceiptYearUnreadableError,
  legacyReceiptNumberIsKept,
  receiptNumberFor,
  receiptNumberIsCurrentFormat,
} from '../src/lib/receiptNumber';

/** Un UUID v4 valide, dont la QUEUE hexadécimale varie avec `n`. */
function uuidFor(n: number): string {
  const tail = n.toString(16).padStart(12, '0').slice(-12);
  return `3f2504e0-4f89-41d3-9a0c-${tail}`;
}

describe('receiptNumberFor — un numéro par GESTE, jamais par horloge', () => {
  it('la forme est lisible et dictable : préfixe, millésime, huit caractères', () => {
    const number = receiptNumberFor({ paymentId: uuidFor(1), academicYear: '2026-2027' });
    // `uuidFor(1)` finit par `000000000001` : les huit derniers caractères sont
    // la queue de l'id, pas un compteur d'horloge.
    assert.equal(number, 'REC-26-00000001');
    assert.equal(number.length, 15);
    assert.ok(number.startsWith(RECEIPT_NUMBER_PREFIX));
    assert.ok(receiptNumberIsCurrentFormat(number), number);
  });

  it('le MÊME geste redonne TOUJOURS le même numéro (réimpression, rejeu, double envoi)', () => {
    const input = { paymentId: uuidFor(42), academicYear: '2026-2027', date: '2026-10-07' };
    const first = receiptNumberFor(input);
    for (let i = 0; i < 50; i += 1) {
      assert.equal(receiptNumberFor(input), first, 'un seul paiement ne peut pas avoir deux numéros');
    }
  });

  it('dix mille gestes différents rendent dix mille numéros différents', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      seen.add(receiptNumberFor({ paymentId: uuidFor(i), academicYear: '2026-2027' }));
    }
    assert.equal(seen.size, 10_000, 'deux reçus ne peuvent pas se confondre');
  });

  it('le millésime vient de l’EXERCICE, lu dans la chaîne (aucun fuseau)', () => {
    assert.ok(receiptNumberFor({ paymentId: uuidFor(1), academicYear: '2026-2027' }).startsWith('REC-26-'));
    assert.ok(receiptNumberFor({ paymentId: uuidFor(1), academicYear: '2027-2028' }).startsWith('REC-27-'));
    // Un exercice écrit sans second millésime reste lisible.
    assert.ok(receiptNumberFor({ paymentId: uuidFor(1), academicYear: '2025' }).startsWith('REC-25-'));
  });

  it('sans exercice, la DATE donne le millésime — jamais l’horloge', () => {
    // Une date de décembre 2025 reste sur l'exercice 2025, même si le poste est
    // en 2026 : le numéro ne dépend pas du jour où on réimprime.
    assert.ok(receiptNumberFor({ paymentId: uuidFor(1), date: '2025-12-31' }).startsWith('REC-25-'));
    assert.ok(receiptNumberFor({ paymentId: uuidFor(1), date: '2031-01-01' }).startsWith('REC-31-'));
  });

  it('sans exercice NI date lisible, on REFUSE au lieu d’inventer le millésime', () => {
    assert.throws(
      () => receiptNumberFor({ paymentId: uuidFor(1) }),
      ReceiptYearUnreadableError,
    );
    assert.throws(
      () => receiptNumberFor({ paymentId: uuidFor(1), academicYear: 'exercice inconnu', date: 'demain' }),
      ReceiptYearUnreadableError,
    );
  });

  it('un id non-UUID (repli WebCrypto) rend quand même un numéro stable et bien formé', () => {
    const id = 'off_m9x2k4_1_abc123';
    const first = receiptNumberFor({ paymentId: id, academicYear: '2026-2027' });
    assert.equal(receiptNumberFor({ paymentId: id, academicYear: '2026-2027' }), first);
    assert.ok(receiptNumberIsCurrentFormat(first), first);
    assert.notEqual(receiptNumberFor({ paymentId: `${id}x`, academicYear: '2026-2027' }), first);
  });
});

describe('les reçus déjà remis gardent leur numéro', () => {
  it('l’ancienne forme `REC-123456` est reconnue pour ne PAS être réécrite', () => {
    assert.equal(legacyReceiptNumberIsKept('REC-123456'), true);
    assert.equal(legacyReceiptNumberIsKept('REC-000001'), true);
  });

  it('la forme courante n’est pas confondue avec une ancienne', () => {
    const current = receiptNumberFor({ paymentId: uuidFor(7), academicYear: '2026-2027' });
    assert.equal(legacyReceiptNumberIsKept(current), false);
    assert.equal(receiptNumberIsCurrentFormat(current), true);
    // Un ancien numéro n'est PAS « courant » : le contrôle de forme ne ment pas
    // dans le sens qui renuméroterait un papier déjà remis.
    assert.equal(receiptNumberIsCurrentFormat('REC-123456'), false);
    assert.equal(legacyReceiptNumberIsKept(undefined), false);
    assert.equal(legacyReceiptNumberIsKept(''), false);
  });
});

describe('la source ne peut pas retomber sur l’horloge', () => {
  it('ni `Date.now`, ni `Math.random`, ni `new Date()` : le numéro vient du geste', () => {
    const source = readFileSync(new URL('../src/lib/receiptNumber.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Date\.now\s*\(/, 'un numéro tiré du temps recommencerait son cycle');
    assert.doesNotMatch(source, /Math\.random\s*\(/, 'un aléa rendrait le numéro instable à la réimpression');
    assert.doesNotMatch(source, /new\s+Date\s*\(\s*\)/, 'aucune date système sans argument');
  });
});
