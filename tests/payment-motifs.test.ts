/**
 * Suite de `src/lib/paymentMotifs.ts` — à QUOI un paiement correspond.
 *
 * Le reçu officiel porte une ligne « Motif ». Elle imprimait toujours « Frais de
 * scolarité » parce que rien ne disait l'autre : une famille venue régler le
 * DROIT D'INSCRIPTION recevait un reçu qui parlait de scolarité. Ce module est le
 * seul endroit qui décide de la forme de ce choix, donc c'est ici que se
 * verrouillent les trois choses qu'un écran pourrait casser en silence :
 *
 *   • la LISTE est fermée (deux clés, jamais un libellé) ;
 *   • la RELECTURE d'une ligne ne devine rien et ne laisse jamais un reçu muet
 *     (`paymentMotifOf` : l'inconnu retombe sur l'ordinaire) ;
 *   • l'INSCRIPTION ne déclare aucun mois d'elle-même — sinon un reçu de droit
 *     d'entrée ferait compter Octobre comme réglé dans la fiche de l'élève.
 *
 * Pur : ni horloge, ni DOM, ni réseau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAYMENT_MOTIF,
  PAYMENT_MOTIFS,
  isPaymentMotif,
  paymentMotifAuditTag,
  paymentMotifFromDetails,
  paymentMotifLabel,
  paymentMotifMonths,
  paymentMotifNeedsMonths,
  paymentMotifOf,
  toggledPaymentMonthsForMotif,
} from '../src/lib/paymentMotifs';
import type { PaymentMotif } from '../src/lib/paymentMotifs';
import { academicYearMonths } from '../src/lib/paymentMonths';
import { translations } from '../src/i18n/translations';

const OPTIONS = academicYearMonths('2026-2027'); // septembre 2026 … août 2027
const DATE_MONTH = '2026-10';

describe('PAYMENT_MOTIFS — la liste est fermée', () => {
  it('nomme les deux motifs, et propose la scolarité d’abord', () => {
    assert.deepEqual([...PAYMENT_MOTIFS], ['scolarite', 'inscription']);
    assert.equal(DEFAULT_PAYMENT_MOTIF, 'scolarite', 'le geste ordinaire est celui que l’écran propose d’avance');
  });

  it('reconnaît ses clés et refuse tout le reste', () => {
    for (const motif of PAYMENT_MOTIFS) assert.equal(isPaymentMotif(motif), true);
    for (const other of ['', 'SCOLARITE', 'Scolarite', 'inscriptions', 'Frais de scolarité', 'registration', '  scolarite  ']) {
      assert.equal(isPaymentMotif(other), false, `« ${other} » n’est pas une clé de la liste`);
    }
    for (const other of [null, undefined, 3, true, {}, ['scolarite']]) {
      assert.equal(isPaymentMotif(other), false, `${String(other)} n’est pas une clé`);
    }
  });

  // C'est la clé du formulaire ET de la contrainte `payments_motif_shape_check`
  // (migration 20261016000000) : une clé ajoutée ici sans la base ferait refuser
  // l'écriture par Postgres, et une clé de la base sans ici serait illisible.
  it('n’accepte que les deux clés que la base accepte', () => {
    assert.deepEqual([...PAYMENT_MOTIFS].sort(), ['inscription', 'scolarite']);
  });
});

describe('la mention du motif dans une phrase du journal — écrivain et lecteur ENSEMBLE', () => {
  // C'est la seule autre source du motif d'un geste : les entrées écrites AVANT
  // la colonne `payments.motif` n'ont pas d'instantané, et leur ligne d'historique
  // n'a que cette mention pour dire autre chose que « frais de scolarité ».
  it('relit exactement ce que son écrivain écrit — l’aller-retour, pas une devinette', () => {
    for (const motif of PAYMENT_MOTIFS) {
      const phrase = `Paiement de 25000 FCFA (reçu REC-7) — élève Awa Traoré${paymentMotifAuditTag(motif)}`;
      // L'écrivain ne marque QUE ce qui sort de l'ordinaire : la clé ordinaire
      // s'écrit « rien » (c'est ce que dit son document), donc sa relecture vaut
      // l'ABSENCE — et c'est `paymentMotifOf` qui en refait le motif du papier.
      const expected = motif === DEFAULT_PAYMENT_MOTIF ? undefined : motif;
      assert.equal(paymentMotifFromDetails(phrase), expected, `« ${motif} » doit se relire dans sa propre mention`);
      assert.equal(
        paymentMotifOf(paymentMotifFromDetails(phrase)),
        motif,
        `et la ligne d’historique porte quand même « ${motif} » — le motif de son papier`,
      );
    }
    // Le geste ordinaire n'écrit RIEN (l'écrivain le dit) : sa relecture vaut donc
    // l'absence — c'est `paymentMotifOf` qui en fera « frais de scolarité ».
    assert.equal(paymentMotifAuditTag(DEFAULT_PAYMENT_MOTIF), '');
    assert.equal(paymentMotifFromDetails('Paiement de 4000 FCFA (reçu REC-1)'), undefined);
  });

  it('refuse une clé que le dépôt ne connaît pas, et une phrase qui ne porte pas la mention', () => {
    assert.equal(paymentMotifFromDetails('Paiement de 4000 FCFA (reçu REC-1) — motif : bourse'), undefined);
    assert.equal(paymentMotifFromDetails('Motif du reçu corrigé'), undefined, 'parler de motif n’est pas déclarer un motif');
    assert.equal(paymentMotifFromDetails('— motif :'), undefined);
    assert.equal(paymentMotifFromDetails(null), undefined);
    assert.equal(paymentMotifFromDetails(undefined), undefined);
  });
});

describe('paymentMotifOf — la relecture d’une ligne ne devine rien', () => {
  it('rend un motif connu tel quel', () => {
    assert.equal(paymentMotifOf('scolarite'), 'scolarite');
    assert.equal(paymentMotifOf('inscription'), 'inscription');
  });

  // Le cas des reçus d'AVANT la colonne, et des imports : la valeur est absente,
  // et le reçu ne doit pas devenir muet pour autant — il imprime l'ordinaire,
  // donc un papier déjà délivré ne change pas.
  it('retombe sur l’ordinaire quand rien n’est déclaré — et n’invente jamais l’inscription', () => {
    for (const absent of [null, undefined, '', 'autre_chose']) {
      assert.equal(paymentMotifOf(absent), DEFAULT_PAYMENT_MOTIF, `${String(absent)} → motif ordinaire`);
    }
    for (const absent of [null, undefined, '', 'autre_chose']) {
      assert.notEqual(paymentMotifOf(absent), 'inscription', 'un droit d’entrée ne se DÉDUIT pas');
    }
  });
});

describe('paymentMotifLabel — les mots du reçu, dans la langue du reçu', () => {
  it('rend la scolarité et l’inscription en français', () => {
    assert.equal(paymentMotifLabel('scolarite', translations.fr), 'Frais de scolarité');
    assert.equal(paymentMotifLabel('inscription', translations.fr), 'Inscription');
  });

  it('rend les mêmes motifs en anglais', () => {
    assert.equal(paymentMotifLabel('scolarite', translations.en), 'School fees');
    assert.equal(paymentMotifLabel('inscription', translations.en), 'Registration');
  });

  it('lit ses mots dans le dictionnaire — la clé du reçu, pas une copie', () => {
    for (const lang of ['fr', 'en'] as const) {
      const t = translations[lang];
      assert.equal(paymentMotifLabel('scolarite', t), t.pdfMotifTuition);
      assert.equal(paymentMotifLabel('inscription', t), t.pdfMotifRegistration);
    }
  });
});

describe('paymentMotifNeedsMonths — l’inscription est un droit d’entrée', () => {
  it('exige un mois pour la scolarité, et aucun pour l’inscription', () => {
    assert.equal(paymentMotifNeedsMonths('scolarite'), true);
    assert.equal(paymentMotifNeedsMonths('inscription'), false);
  });

  it('couvre exactement la liste des motifs', () => {
    for (const motif of PAYMENT_MOTIFS) {
      assert.equal(typeof paymentMotifNeedsMonths(motif), 'boolean', `${motif} doit avoir sa règle`);
    }
  });
});

describe('paymentMotifMonths — ce que le choix déclare réellement', () => {
  it('scolarité : le mois proposé suit la date tant que rien n’a été coché', () => {
    assert.deepEqual(paymentMotifMonths('scolarite', [], false, DATE_MONTH, OPTIONS), [DATE_MONTH]);
  });

  it('scolarité : dès qu’un clic a eu lieu, c’est le choix du caissier qui compte', () => {
    assert.deepEqual(
      paymentMotifMonths('scolarite', ['2026-12', '2026-09'], true, DATE_MONTH, OPTIONS),
      ['2026-09', '2026-12'],
    );
  });

  // Le point qui protège la FICHE de l'élève : `monthsCoverage` compte un mois
  // couvert dès qu'un paiement le déclare. Une pastille pré-cochée sous une
  // inscription ferait donc afficher « Octobre réglé » pour un droit d'entrée.
  it('inscription : rien n’est déclaré d’avance — aucun mois n’est offert au reçu', () => {
    assert.deepEqual(paymentMotifMonths('inscription', [], false, DATE_MONTH, OPTIONS), []);
  });

  it('inscription : seuls les mois RÉELLEMENT cochés comptent, triés', () => {
    assert.deepEqual(paymentMotifMonths('inscription', ['2026-10'], true, DATE_MONTH, OPTIONS), ['2026-10']);
    assert.deepEqual(
      paymentMotifMonths('inscription', ['2026-12', '2026-09'], true, DATE_MONTH, OPTIONS),
      ['2026-09', '2026-12'],
    );
  });

  it('sur une année illisible, la scolarité ne propose rien non plus (aucun mois inventé)', () => {
    assert.deepEqual(paymentMotifMonths('scolarite', [], false, DATE_MONTH, []), []);
  });
});

describe('toggledPaymentMonthsForMotif — cocher sous le motif courant', () => {
  it('scolarité : le premier clic AJOUTE au mois de la date', () => {
    assert.deepEqual(
      toggledPaymentMonthsForMotif('scolarite', [], false, DATE_MONTH, OPTIONS, '2026-11'),
      ['2026-10', '2026-11'],
    );
  });

  it('inscription : le premier clic coche CE mois, et lui seul', () => {
    assert.deepEqual(
      toggledPaymentMonthsForMotif('inscription', [], false, DATE_MONTH, OPTIONS, '2026-11'),
      ['2026-11'],
    );
  });

  it('un second clic sur le même mois le décoche', () => {
    const once = toggledPaymentMonthsForMotif('inscription', [], false, DATE_MONTH, OPTIONS, '2026-11');
    assert.deepEqual(toggledPaymentMonthsForMotif('inscription', once, true, DATE_MONTH, OPTIONS, '2026-11'), []);
  });

  it('rend toujours l’ordre du calendrier scolaire, quel que soit l’ordre des clics', () => {
    let months = toggledPaymentMonthsForMotif('inscription', [], false, DATE_MONTH, OPTIONS, '2026-12');
    months = toggledPaymentMonthsForMotif('inscription', months, true, DATE_MONTH, OPTIONS, '2026-09');
    assert.deepEqual(months, ['2026-09', '2026-12'], 'décembre cliqué avant septembre ne change pas le reçu');
  });
});

describe('paymentMotifAuditTag — la mention du journal, écrite une seule fois', () => {
  it('nomme l’inscription par sa clé STOCKÉE, jamais par un libellé traduit', () => {
    assert.equal(paymentMotifAuditTag('inscription'), ' — motif : inscription');
    assert.equal(
      paymentMotifAuditTag('inscription').includes(translations.fr.pdfMotifRegistration),
      false,
      'le journal n’a pas de langue : le mot traduit appartient au reçu',
    );
  });

  it('laisse le geste ordinaire — et l’absence de motif — sans rien ajouter', () => {
    assert.equal(paymentMotifAuditTag('scolarite'), '', 'la phrase d’avant ne bouge pas pour l’ordinaire');
    assert.equal(paymentMotifAuditTag(undefined), '', 'une entrée d’avant la colonne ne gagne aucun suffixe');
  });

  it('suit la LISTE : un motif ajouté est nommé sans toucher au journal', () => {
    for (const motif of PAYMENT_MOTIFS) {
      const tag = paymentMotifAuditTag(motif);
      assert.equal(tag.includes(motif) || tag === '', true, `${motif} doit être nommé par sa clé, ou tu`);
    }
  });
});

/**
 * Le motif est une clé, jamais un libellé — et la règle des mois en dérive.
 * Ce cas relie les deux modules : une pastille ne se propose pas pour un motif
 * qui ne couvre rien.
 */
describe('la règle des mois découle du motif', () => {
  it('un motif qui n’exige pas de mois n’en propose aucun d’avance', () => {
    const proposing: PaymentMotif[] = [];
    for (const motif of PAYMENT_MOTIFS) {
      const months = paymentMotifMonths(motif, [], false, DATE_MONTH, OPTIONS);
      if (months.length > 0) proposing.push(motif);
    }
    assert.deepEqual(proposing, ['scolarite'], 'seule la scolarité propose le mois de la date');
    for (const motif of PAYMENT_MOTIFS) {
      assert.equal(
        paymentMotifMonths(motif, [], false, DATE_MONTH, OPTIONS).length > 0,
        paymentMotifNeedsMonths(motif),
        `${motif} : proposer un mois et l’exiger disent la même chose`,
      );
    }
  });
});
