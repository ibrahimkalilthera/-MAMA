import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PaymentEntryModal } from '../src/components/PaymentEntryModal';
import { translations } from '../src/i18n/translations';
import type { Payment, Student } from '../src/lib/useSupabaseData';
import {
  academicYearMonths,
  formatPaidMonthLine,
  formatPaidMonths,
  monthsNotYetPaid,
  paidReceiptEvidence,
  paymentMonthHistory,
  paymentMonthLabel,
} from '../src/lib/paymentMonths';
import type { PaymentLike, PaymentMonthFact } from '../src/lib/paymentMonths';
import { formatCurrency, formatDateLang } from '../src/lib/formatters';
import {
  DEFAULT_PAYMENT_MOTIF,
  PAYMENT_MOTIFS,
  paymentMotifLabel,
  paymentMotifMonths,
  paymentMotifNeedsMonths,
  toggledPaymentMonthsForMotif,
} from '../src/lib/paymentMotifs';
import type { PaymentMotif } from '../src/lib/paymentMotifs';
import { academicYearOf } from '../src/lib/dateWindows';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const students: Student[] = [
  { id: 'a', name: 'Awa', grade: ' 1a ', studentId: 'MAT-001', totalDue: 100000, amountPaid: 10000, scholarshipDiscount: 10, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'b', name: 'Binta', grade: '2A', studentId: '2026-0002', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'c', name: 'Coumba', grade: 'OLD', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'd', name: 'Djeneba', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
];

/**
 * Un reçu tel que la modale le reçoit (`PaymentLike`) rendu à la forme de la
 * ligne `payments` : le carnet de l'élève porte des `Payment` complets, et c'est
 * LÀ que la modale retrouve le reçu à retirer.
 */
const asPayment = (p: PaymentLike): Payment => ({
  ...p, months: p.months ? [...p.months] : undefined,
});

function mount(lang: 'en' | 'fr' = 'fr', initialStudent = '', receipts: PaymentLike[] = [], canDeletePayment = true) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const submissions: string[] = [];
  /** Les reçus que la modale a demandé de retirer, dans l'ordre. */
  const deletions: { studentId: string; payment: Payment }[] = [];
  const defaults = makeProps();
  function Host() {
    const [paymentStudentId, setPaymentStudentId] = useState(initialStudent);
    const [paymentAmount, setPaymentAmount] = useState('5000');
    const [paymentDate, setPaymentDate] = useState('2026-10-04');
    // Les mois vivent dans le domaine (`usePayments`) : la même règle PURE est
    // rejouée ici, pour que la modale soit essayée avec ce qu'elle reçoit pour
    // de vrai — jamais avec un tableau fabriqué pour la circonstance.
    const [selected, setSelected] = useState<string[]>([]);
    const [touched, setTouched] = useState(false);
    // Le motif vit aussi dans le domaine : le même état et la même règle PURE
    // sont rejoués ici (`paymentMotifMonths`), pour que la modale soit essayée
    // avec ce qu'elle reçoit pour de vrai.
    const [motif, setMotif] = useState<PaymentMotif>(DEFAULT_PAYMENT_MOTIF);
    const monthOptions = academicYearMonths(academicYearOf(paymentDate));
    const dateMonth = paymentDate.slice(0, 7);
    // Comme le domaine : les mois déjà réglés de l’élève — AVEC le reçu qui les
    // couvre — sont calculés par le module pur à partir des reçus, et ces mois
    // sont RETIRÉS des propositions (`monthsNotYetPaid`). La modale est donc
    // essayée avec ce qu’elle reçoit pour de vrai, jamais avec un tableau
    // fabriqué pour la circonstance.
    // Les reçus vivent dans l'état : un reçu RETIRÉ quitte la liste, donc le mois
    // redevient libre — c'est le comportement que la modale doit provoquer.
    const [paidReceipts, setPaidReceipts] = useState<PaymentLike[]>(receipts);
    const history = paymentMonthHistory(paidReceipts, monthOptions);
    const paidMonths = history.facts.map((f) => f.month);
    // Le carnet de l’élève porte ses reçus : c’est là que la modale retrouve la
    // ligne à retirer (`deletePayment` a besoin du reçu ENTIER, motif compris).
    const withReceipts = students.map((s) =>
      (s.id === 'a' ? { ...s, payments: paidReceipts.map(asPayment) } : s));
    return createElement(PaymentEntryModal, {
      t: translations[lang], lang, currentTheme: defaults.currentTheme,
      students: withReceipts, availableClasses: [
        { id: '1A', nameEn: 'First A', nameFr: 'Première A' },
        { id: '2A', nameEn: 'Second A', nameFr: 'Deuxième A' },
        { id: 'EMPTY', nameEn: 'Empty', nameFr: 'Vide' },
      ],
      getGradeDisplay: (grade) => `Classe ${grade}`,
      paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount,
      paymentDate, setPaymentDate,
      paymentMonthOptions: monthOptions,
      paymentMotif: motif,
      setPaymentMotif: setMotif,
      paymentMonths: monthsNotYetPaid(paymentMotifMonths(motif, selected, touched, dateMonth, monthOptions), paidMonths),
      paidMonthFacts: history.facts,
      undeclaredPaymentCount: history.undeclared,
      canDeletePayment,
      onDeletePayment: async (studentId, payment) => {
        deletions.push({ studentId, payment });
        setPaidReceipts((prev) => prev.filter((r) => r.id !== payment.id));
        return true;
      },
      togglePaymentMonth: (month: string) => {
        setSelected((prev) => toggledPaymentMonthsForMotif(motif, prev, touched, dateMonth, monthOptions, month));
        setTouched(true);
      },
      formatCurrency: (amount) => `${amount} XOF`,
      handlePaymentSubmit: async (e) => { e.preventDefault(); submissions.push(paymentStudentId); },
      overlayRef: () => {}, onClose: () => {},
    });
  }
  const render = () => act(() => root.render(createElement(Host)));
  render();
  const select = (id: string) => {
    const el = container.querySelector<HTMLSelectElement>(`#${id}`);
    assert.ok(el);
    return el;
  };
  const change = (id: string, value: string) => act(() => {
    const el = select(id);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const chip = (month: string) => {
    const el = container.querySelector<HTMLButtonElement>(`[data-month="${month}"]`);
    assert.ok(el, `pastille du mois ${month} absente`);
    return el;
  };
  const click = (month: string) => act(() => chip(month).click());
  const monthsLine = () => container.querySelector<HTMLParagraphElement>('[data-slot="payment-months"] p:last-of-type');
  const motifSelect = () => container.querySelector<HTMLSelectElement>('#payment-motif-select');
  return {
    container, select, change, submissions, deletions, chip, click, monthsLine, motifSelect,
    reopen: () => { act(() => root.render(null)); render(); },
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

const values = (select: HTMLSelectElement) => Array.from(select.options, (o) => o.value);

describe('PaymentEntryModal — filtre classe', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`propose les classes présentes et leurs libellés ${lang}, y compris une classe retirée`, () => {
      const h = mount(lang);
      try {
        assert.deepEqual(values(h.select('payment-class-filter')), ['all', '1A', '2A', 'old']);
        assert.equal(h.select('payment-class-filter').options[1].textContent, lang === 'fr' ? 'Première A' : 'First A');
        assert.deepEqual(values(h.select('payment-student')), ['', 'a', 'b', 'c', 'd']);
        assert.ok(h.select('payment-student').options[1].textContent?.includes('80000 XOF'));
        assert.ok(h.container.querySelector('label[for="payment-class-filter"]'));
        assert.ok(h.container.querySelector('label[for="payment-student"]'));
      } finally { h.cleanup(); }
    });
  }

  it('filtre sans tenir compte de la casse ni des espaces et restaure tous les élèves', () => {
    const h = mount();
    try {
      h.change('payment-class-filter', '1A');
      assert.deepEqual(values(h.select('payment-student')), ['', 'a']);
      h.change('payment-class-filter', 'old');
      assert.deepEqual(values(h.select('payment-student')), ['', 'c']);
      h.change('payment-class-filter', 'all');
      assert.deepEqual(values(h.select('payment-student')), ['', 'a', 'b', 'c', 'd']);
    } finally { h.cleanup(); }
  });

  it('préserve une présélection visible mais efface un élève hors classe sans changer le montant', () => {
    const h = mount('fr', 'a');
    try {
      assert.equal(h.select('payment-student').value, 'a');
      h.change('payment-class-filter', '1A');
      assert.equal(h.select('payment-student').value, 'a');
      h.change('payment-class-filter', '2A');
      assert.equal(h.select('payment-student').value, '');
      assert.equal(h.select('payment-student').validity.valueMissing, true);
      assert.equal(h.container.querySelector<HTMLInputElement>('input[type="number"]')?.value, '5000');
      h.change('payment-student', 'b');
      act(() => h.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.deepEqual(h.submissions, ['b']);
      h.reopen();
      assert.equal(h.select('payment-class-filter').value, 'all');
      assert.equal(h.select('payment-student').value, 'a');
    } finally { h.cleanup(); }
  });
});

describe('PaymentEntryModal — champ de recherche par nom ou matricule', () => {
  // La frappe ne peut pas être simulée ici : React lit `onChange` via son
  // value-tracker, que le harnais happy-dom ne fait jamais changer pour un
  // `<input>` contrôlé. Le COMPORTEMENT de recherche est donc verrouillé à la
  // source pure (tests/payment-student-filter.test.ts) ; ce qui suit vérifie le
  // câblage DOM : le champ existe, est étiqueté, et porte le bon placeholder.
  for (const lang of ['fr', 'en'] as const) {
    it(`rend un champ de recherche étiqueté et combinable au filtre de classe (${lang})`, () => {
      const h = mount(lang);
      try {
        const search = h.container.querySelector<HTMLInputElement>('#payment-student-search');
        assert.ok(search, 'champ de recherche absent');
        assert.equal(search.dataset.slot, 'payment-student-search');
        assert.equal(search.getAttribute('placeholder'), translations[lang].searchStudents);
        assert.ok(h.container.querySelector('label[for="payment-student-search"]'), 'le champ doit être étiqueté');
        // Le filtre de classe reste opérationnel à côté du champ.
        assert.ok(h.container.querySelector('#payment-class-filter'));
      } finally { h.cleanup(); }
    });
  }

  // La recherche est inutile si son résultat ne se VÉRIFIE pas : quand le
  // caissier cherche un matricule lu sur un reçu, la ligne trouvée doit le
  // montrer. Sans lui, « Awa » et « Awa » se ressemblent, et le mauvais élève
  // est encaissé.
  it('affiche le matricule sur la ligne de l’élève, à côté du solde', () => {
    const h = mount();
    try {
      const texts = Array.from(h.select('payment-student').options, (o) => o.textContent ?? '');
      assert.ok(texts[1].includes(translations.fr.studentId), `libellé de matricule absent de « ${texts[1]} »`);
      assert.ok(texts[1].includes('MAT-001'), `matricule absent de « ${texts[1]} »`);
      assert.ok(texts[1].includes('80000 XOF'), 'le solde reste affiché à côté du matricule');
      assert.ok(texts[2].includes('2026-0002'), 'un matricule sans préfixe s’affiche aussi');
      assert.equal(texts[3].includes(translations.fr.studentId), false, 'aucun matricule inventé pour un élève qui n’en a pas');
    } finally { h.cleanup(); }
  });
});

describe('PaymentEntryModal — le motif du paiement', () => {
  it('propose la liste fermée des motifs, ses mots de reçu, et l’ordinaire d’avance', () => {
    const h = mount('fr');
    try {
      const select = h.motifSelect();
      assert.ok(select, 'le motif doit être un choix de la fenêtre de saisie');
      assert.ok(h.container.querySelector('label[for="payment-motif-select"]'), 'le choix doit être étiqueté');
      assert.deepEqual(values(select), [...PAYMENT_MOTIFS], 'la liste est celle du module, et rien d’autre');
      assert.deepEqual(
        Array.from(select.options, (o) => o.textContent),
        PAYMENT_MOTIFS.map((m) => paymentMotifLabel(m, translations.fr)),
        'les libellés sont les MOTS DU REÇU : ce qui se choisit ici s’imprime là',
      );
      assert.equal(select.value, DEFAULT_PAYMENT_MOTIF, 'l’encaissement ordinaire reste le défaut');
      assert.ok(h.container.textContent?.includes(translations.fr.paymentMotif), 'le champ est intitulé');
      assert.ok(h.container.textContent?.includes(translations.fr.paymentMotifHint), 'et expliqué');
    } finally { h.cleanup(); }
  });

  it('localise les deux motifs', () => {
    const h = mount('en');
    try {
      assert.deepEqual(
        Array.from(h.motifSelect()!.options, (o) => o.textContent),
        PAYMENT_MOTIFS.map((m) => paymentMotifLabel(m, translations.en)),
      );
      assert.equal(h.motifSelect()!.options[1].textContent, translations.en.pdfMotifRegistration);
    } finally { h.cleanup(); }
  });

  // La demande est explicite : le motif se choisit EN HAUT des mois payés. Un
  // ordre inversé ferait cocher des mois avant de dire à quoi ils correspondent.
  it('se place AU-DESSUS des mois payés, dans l’ordre du reçu', () => {
    const h = mount('fr');
    try {
      const html = h.container.innerHTML;
      const motif = html.indexOf('data-slot="payment-motif"');
      const months = html.indexOf('data-slot="payment-months"');
      assert.ok(motif >= 0, 'le marqueur du motif doit être posé');
      assert.ok(months >= 0, 'le champ des mois doit être présent');
      assert.ok(motif < months, 'le motif doit précéder les mois payés');
    } finally { h.cleanup(); }
  });

  // Le cœur de la demande : pouvoir ENREGISTRER une inscription. C’est un droit
  // d’entrée, il ne couvre aucun mois — donc le bouton ne doit plus être fermé
  // faute de mois coché, et AUCUN mois ne doit être déclaré à sa place (sinon la
  // fiche de l’élève compterait Octobre réglé par un reçu d’inscription).
  it('l’inscription s’enregistre sans mois — et n’en déclare aucun', () => {
    const h = mount('fr');
    try {
      const submit = () => h.container.querySelector<HTMLButtonElement>('button[type="submit"]');
      assert.equal(paymentMotifNeedsMonths(DEFAULT_PAYMENT_MOTIF), true, 'la scolarité, elle, exige un mois');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'true', 'le mois de la date est proposé d’avance');

      h.change('payment-motif-select', 'inscription');
      assert.equal(h.motifSelect()?.value, 'inscription');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'false', 'aucun mois n’est coché d’avance pour une inscription');
      assert.equal(submit()?.disabled, false, 'une inscription s’enregistre sans mois');
      assert.ok(h.container.textContent?.includes(translations.fr.paidMonthsHint), 'les mois restent PROPOSÉS');
      assert.equal(
        h.container.textContent?.includes(translations.fr.paidMonthsRequired),
        false,
        'et ne sont plus EXIGÉS : l’écran ne réclame pas un mois pour une inscription',
      );

      // Un mois coché À LA MAIN reste possible : une famille peut régler les deux.
      h.click('2026-11');
      assert.equal(h.chip('2026-11').getAttribute('aria-pressed'), 'true');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'false', 'cocher n’entraîne pas le mois de la date');
      assert.equal(h.monthsLine()?.textContent, 'Novembre');
      h.click('2026-11');
      assert.equal(h.chip('2026-11').getAttribute('aria-pressed'), 'false');
      assert.equal(submit()?.disabled, false, 'de nouveau sans mois : toujours enregistrable');

      // Revenir à la scolarité remet l’exigence — et rien n’est coché d’office :
      // un mois coché plus tôt ne suit plus la date (le choix du caissier prime),
      // donc c’est à lui de cocher.
      h.change('payment-motif-select', 'scolarite');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'false');
      assert.equal(submit()?.disabled, true, 'la scolarité sans mois est fermée');
      h.click('2026-10');
      assert.equal(submit()?.disabled, false);
      assert.equal(h.monthsLine()?.textContent, 'Octobre', 'et la ligne annonce ce que le reçu écrira');
    } finally { h.cleanup(); }
  });
});

describe('PaymentEntryModal — les mois payés', () => {
  const expectedLine = (months: string[], lang: 'fr' | 'en') => formatPaidMonths(months, {
    label: (ym) => paymentMonthLabel(ym, translations[lang]),
    count: (n) => translations[lang].paidMonthsCount.replace('{count}', String(n)),
    rangeTo: translations[lang].paidMonthsRangeTo,
  });

  it('propose les douze mois de l’année scolaire, le mois de la date coché d’avance', () => {
    const h = mount('fr');
    try {
      assert.ok(h.container.querySelector('[data-slot="payment-months"]'), 'le champ des mois doit être présent');
      const chips = Array.from(h.container.querySelectorAll<HTMLButtonElement>('[data-month]'));
      assert.equal(chips.length, 12, 'les douze mois de l’année scolaire');
      assert.equal(chips[0].textContent, 'Septembre', 'l’année scolaire commence en septembre');
      assert.equal(chips[11].textContent, 'Août', 'et finit en août');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'true', 'le mois de la date est coché');
      assert.equal(h.chip('2026-11').getAttribute('aria-pressed'), 'false');
      assert.equal(h.monthsLine()?.textContent, 'Octobre', 'la ligne annonce exactement ce que le reçu écrira');
      assert.ok(h.container.textContent?.includes(translations.fr.paidMonths), 'le champ est intitulé');
      assert.ok(h.container.textContent?.includes(translations.fr.paidMonthsHint), 'et expliqué');
      assert.equal(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
    } finally { h.cleanup(); }
  });

  it('localise les pastilles et la ligne du reçu', () => {
    const h = mount('en');
    try {
      assert.equal(h.chip('2026-10').textContent, 'October');
      assert.equal(h.monthsLine()?.textContent, 'October');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'true');
    } finally { h.cleanup(); }
  });

  it('cocher un mois voisin écrit une PLAGE — et AJOUTE au mois de la date', () => {
    const h = mount('fr');
    try {
      h.click('2026-11');
      assert.equal(h.chip('2026-11').getAttribute('aria-pressed'), 'true');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'true', 'octobre ne disparaît pas au premier clic');
      assert.equal(h.monthsLine()?.textContent, expectedLine(['2026-10', '2026-11'], 'fr'));
      assert.equal(h.monthsLine()?.textContent, '2 mois : Octobre à Novembre');
      h.click('2026-09');
      assert.equal(h.monthsLine()?.textContent, '3 mois : Septembre à Novembre');
    } finally { h.cleanup(); }
  });

  it('un mois troué se dit en LISTE, dans l’ordre du calendrier', () => {
    const h = mount('fr');
    try {
      h.click('2026-12');
      assert.equal(h.monthsLine()?.textContent, expectedLine(['2026-10', '2026-12'], 'fr'));
      assert.equal(h.monthsLine()?.textContent, '2 mois : Octobre, Décembre');
    } finally { h.cleanup(); }
  });

  it('sans aucun mois coché, l’envoi est fermé — et la ligne le dit', () => {
    const h = mount('fr');
    try {
      h.click('2026-10');
      assert.equal(h.monthsLine()?.textContent, translations.fr.paidMonthsRequired);
      assert.equal(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
      h.click('2026-10');
      assert.equal(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
    } finally { h.cleanup(); }
  });

  // La date est un `<input>` : sous happy-dom son `onChange` ne reçoit aucun
  // événement expédié (même limite que la recherche par nom, mesurée plus haut),
  // donc « le mois proposé suit la date » est verrouillé sur la règle PURE
  // (tests/payment-months.test.ts, `effectivePaymentMonths`) et pas ici.
});

describe('PaymentEntryModal — la fenêtre reste atteignable', () => {
  // Le panneau partagé (`ModalShell`) est `overflow-hidden` et ne porte AUCUNE
  // hauteur maximale : ce qui dépasse l'écran n'est pas coupé « un peu », il
  // devient INATTEIGNABLE. Ce formulaire est le plus long de l'application —
  // recherche, filtre de classe, élève, deux champs, DOUZE pastilles de mois,
  // indice, ligne du reçu, bouton — et il était le SEUL corps de modale sans
  // défilement. Mesuré sur un écran de portable : le bouton de validation tombait
  // sous le bord bas, sans barre pour l'atteindre, donc aucun paiement ne pouvait
  // être enregistré. Les formulaires voisins (élève, personnel) portent la même
  // paire de classes ; ce cas refuse sa disparition.
  it('porte une hauteur maximale et un défilement vertical, bouton compris', () => {
    const h = mount('fr');
    try {
      const form = h.container.querySelector('form');
      assert.ok(form, 'le formulaire de paiement doit exister');
      const classes = form.className;
      assert.match(
        classes,
        /(^|\s)max-h-\[/,
        'sans hauteur maximale, le panneau coupe le bas du formulaire au lieu de le laisser défiler',
      );
      assert.match(
        classes,
        /(^|\s)overflow-y-auto(\s|$)/,
        'sans défilement vertical, le bouton de validation redevient inatteignable sur un écran court',
      );
      assert.match(
        classes,
        /(^|\s)custom-scrollbar(\s|$)/,
        'la barre de défilement doit être celle du dépôt (mêmes classes que les formulaires voisins)',
      );
      // Et le bouton vit bien DANS la zone qui défile : un défilement dont le
      // bouton est dehors ne rendrait rien atteignable.
      assert.ok(
        form.querySelector('button[type="submit"]'),
        'le bouton de validation doit vivre dans le formulaire qui défile',
      );
    } finally { h.cleanup(); }
  });
});

/** La ligne `payments` d'octobre 2026 — la preuve que l'écran doit montrer. */
const octoberReceipt = { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456' };
const paidOctober: PaymentLike = { ...octoberReceipt, months: ['2026-10'] };
/** Le fait correspondant, monté par le module pur : ce que la modale reçoit. */
const octoberFact: PaymentMonthFact = { month: '2026-10', receipts: [octoberReceipt] };

/** Les phrases de la grille des mois — c'est là que la preuve est écrite. */
const gridLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="payment-months"] p'), (p) => p.textContent ?? '');

describe('PaymentEntryModal — les mois déjà réglés de l’élève', () => {
  // La demande est explicite : quand un mois est déjà réglé pour l'élève choisi,
  // il apparaît EN ROUGE et ne se coche plus, ou disparaît du tableau. L'écran
  // dit aussi POURQUOI, et PAR QUEL REÇU : un mois qui ne se coche pas sans
  // explication laisse croire à une panne du guichet, et un refus sans numéro de
  // reçu laisse le caissier sans moyen de vérifier le papier de la famille.
  it('marque en rouge, barre et FERME la pastille d’un mois déjà réglé', () => {
    const h = mount('fr', '', [paidOctober]);
    try {
      const paid = h.chip('2026-10');
      assert.equal(paid.dataset.paid, 'true', 'la pastille dit qu’elle est déjà réglée');
      assert.equal(paid.disabled, true, 'et elle ne se coche plus');
      assert.match(paid.className, /text-rose-600/, 'elle est ROUGE');
      assert.match(paid.className, /line-through/, 'et barrée');
      assert.equal(paid.getAttribute('aria-pressed'), 'false', 'elle n’est pas cochée pour autant');
      // La PREUVE : le mois, le numéro du reçu, sa date et son montant. Le
      // caissier peut alors vérifier le papier que la famille présente, au lieu
      // de subir un refus qu'il ne peut pas expliquer.
      const preuve = gridLines(h.container).find((line) => line.includes('REC-123456'));
      assert.ok(preuve, `la preuve du reçu doit être écrite sous la grille (reçu : ${gridLines(h.container).join(' | ')})`);
      assert.ok(preuve.includes('Octobre'), 'elle NOMME le mois réglé');
      assert.ok(preuve.includes(formatDateLang(octoberReceipt.date, 'fr')), 'elle donne la DATE du reçu');
      assert.ok(preuve.includes(formatCurrency(octoberReceipt.amount)), 'et son MONTANT');
      assert.equal(
        preuve,
        formatPaidMonthLine(octoberFact, translations.fr, 'fr'),
        'et c’est la phrase du module pur — la même que le message de refus',
      );

      assert.equal(h.chip('2026-11').disabled, false, 'un mois libre reste cochable');
      assert.equal(h.chip('2026-11').dataset.paid, undefined, 'et ne se dit pas réglé');

      // Cliquer la pastille ne coche rien : l'écran ne doit pas laisser composer
      // un second reçu pour un mois que le domaine refusera d'enregistrer.
      h.click('2026-10');
      assert.equal(h.chip('2026-10').getAttribute('aria-pressed'), 'false', 'aucun mois réglé ne se coche');
      assert.equal(h.monthsLine()?.textContent, translations.fr.paidMonthsRequired, 'et rien n’est coché');
    } finally { h.cleanup(); }
  });

  it('localise la preuve du mois déjà réglé', () => {
    const h = mount('en', '', [paidOctober]);
    try {
      const preuve = gridLines(h.container).find((line) => line.includes('REC-123456'));
      assert.ok(preuve, 'la preuve doit être écrite aussi en anglais');
      assert.equal(preuve, formatPaidMonthLine(octoberFact, translations.en, 'en'));
      assert.ok(preuve.includes('October'), 'le mois est traduit');
      assert.ok(preuve.includes('receipt REC-123456'), 'et le mot du reçu vient du dictionnaire anglais');
    } finally { h.cleanup(); }
  });

  it('ferme l’envoi quand TOUTE l’année est réglée, en disant la VRAIE raison', () => {
    const year = academicYearMonths(academicYearOf('2026-10-04'));
    // Un seul reçu qui déclare l'année entière : les douze mois sont réglés.
    const h = mount('fr', '', [{ date: '2026-09-01', amount: 300000, receiptNumber: 'REC-777777', months: year }]);
    try {
      assert.equal(h.container.querySelectorAll('[data-month][data-paid="true"]').length, year.length, 'les douze mois sont marqués réglés');
      assert.equal(
        h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
        true,
        'plus rien à cocher : l’envoi reste fermé',
      );
      assert.equal(h.monthsLine()?.textContent, translations.fr.paidMonthsAllCovered, 'et il dit la VRAIE raison');
      assert.equal(
        h.container.textContent?.includes(translations.fr.paidMonthsRequired),
        false,
        '« cochez au moins un mois » serait faux : il n’en reste aucun',
      );
    } finally { h.cleanup(); }
  });

  it('compte les reçus muets, dont la couverture est INCONNUE', () => {
    const h = mount('fr', '', [
      { date: '2026-10-05', amount: 10000 },
      { date: '2026-10-06', amount: 10000 },
    ]);
    try {
      assert.equal(
        h.container.textContent?.includes(translations.fr.monthsUndeclaredNote.replace('{count}', '2')),
        true,
        'un mois absent de la liste rouge ne veut pas dire « jamais payé »',
      );
      assert.equal(
        h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
        false,
        'et l’encaissement ordinaire reste ouvert',
      );
    } finally { h.cleanup(); }
  });

  it('ne dit rien de plus quand aucun mois n’est réglé ni aucun reçu muet', () => {
    const h = mount('fr');
    try {
      assert.equal(h.container.querySelectorAll('[data-paid="true"]').length, 0, 'aucune pastille marquée réglée');
      assert.equal(h.container.textContent?.includes(translations.fr.paidMonthsAllCovered), false);
      assert.equal(h.container.textContent?.includes(translations.fr.monthsUndeclaredNote.replace('{count}', '0')), false);
      assert.equal(h.monthsLine()?.textContent, 'Octobre', 'la ligne redevient la ligne du reçu');
      assert.equal(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
      // Et aucune ligne de reçu ne s’ouvre : il n’y a rien à départager.
      assert.equal(h.container.querySelectorAll('[data-receipt]').length, 0);
    } finally { h.cleanup(); }
  });
});

describe('PaymentEntryModal — le reçu EN TROP d’un mois déclaré deux fois', () => {
  // La demande : listER TOUS les reçus d'un même mois, pas seulement le plus
  // ancien, et laisser retirer celui qui est en trop. Le doublon existe déjà en
  // base (une saisie faite deux fois, ou deux dépôts le même mois) ; n'en montrer
  // qu'un le laisserait invisible, donc intact. L'application ne CHOISIT pas
  // lequel est en trop — elle les nomme, et le caissier tranche devant la famille.
  const first: PaymentLike = { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456', months: ['2026-10'] };
  const second: PaymentLike = { id: 'p2', date: '2026-10-20', amount: 25000, receiptNumber: 'REC-999999', months: ['2026-10'] };

  it('nomme LES DEUX reçus du mois, chacun avec sa date et son montant', () => {
    const h = mount('fr', 'a', [first, second]);
    try {
      // Les faits reçus par la modale, montés par le module pur : la phrase du
      // mois est celle du domaine, et elle dit qu'il y en a PLUSIEURS au lieu de
      // citer le premier — ce qui laisserait croire que le second n'existe pas.
      const [fact] = paymentMonthHistory([first, second], academicYearMonths(academicYearOf('2026-10-04'))).facts;
      const text = h.container.textContent ?? '';
      assert.ok(
        text.includes(formatPaidMonthLine(fact, translations.fr, 'fr')),
        `la phrase du mois doit dire qu’il y en a deux (texte : ${gridLines(h.container).join(' | ')})`,
      );
      // Puis une ligne PAR reçu : numéro, date, montant — de quoi vérifier le
      // papier que la famille présente, et reconnaître celui qui est en trop.
      for (const receipt of fact.receipts) {
        assert.ok(
          text.includes(paidReceiptEvidence(receipt, translations.fr, 'fr')),
          `chaque reçu du mois doit être nommé, date et montant compris (reçu ${receipt.receiptNumber})`,
        );
      }
      const rows = Array.from(h.container.querySelectorAll('[data-receipt]'), (el) => el.getAttribute('data-receipt'));
      assert.deepEqual(rows, ['p1', 'p2'], 'une ligne par reçu, du plus ancien au plus récent');
    } finally { h.cleanup(); }
  });

  it('n’offre RIEN à retirer quand le mois n’a qu’un reçu — il n’y a pas de trop', () => {
    const h = mount('fr', 'a', [first]);
    try {
      assert.equal(h.container.querySelectorAll('[data-receipt]').length, 0);
      assert.equal(h.container.querySelectorAll('[data-receipt-remove]').length, 0);
    } finally { h.cleanup(); }
  });

  it('ne retire rien avant confirmation, et laisse renoncer', () => {
    const h = mount('fr', 'a', [first, second]);
    try {
      const remove = h.container.querySelector<HTMLButtonElement>('[data-receipt-remove="p2"]');
      assert.ok(remove, 'le reçu en trop doit pouvoir être proposé à l’annulation');
      assert.equal(remove.title, translations.fr.deletePayment, 'le geste est étiqueté');
      act(() => remove.click());
      assert.equal(h.deletions.length, 0, 'aucun reçu ne part avant la confirmation');
      // La confirmation NOMME le reçu visé — son montant (rendu par le même
      // formateur que l'écran) et son numéro — sans quoi `deletePaymentConfirm`
      // serait le même texte pour tous les reçus de l'élève.
      assert.ok(
        h.container.textContent?.includes(translations.fr.deletePaymentConfirm
          .replace('{amount}', `${second.amount} XOF`)
          .replace('{receipt}', second.receiptNumber!)),
        'et la confirmation dit le montant ET le numéro, pour viser le bon reçu',
      );
      const cancel = Array.from(h.container.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === translations.fr.cancel);
      assert.ok(cancel, 'renoncer doit rester possible');
      act(() => cancel.click());
      assert.equal(h.deletions.length, 0);
      // Le nœud est PROJETÉ en booléen avant d'être affirmé : une assertion qui
      // reçoit un élément happy-dom fait exploser le tas au lieu de dire son verdict.
      assert.equal(h.container.querySelector('[data-slot="payment-receipt-remove"]') !== null, false, 'la confirmation se referme');
      assert.ok(h.container.querySelector('[data-receipt-remove="p2"]'), 'et le geste reste offert');
    } finally { h.cleanup(); }
  });

  it('retire la ligne du reçu confirmé EN ENTIER — motif compris — et le doublon disparaît', () => {
    const h = mount('fr', 'a', [first, second]);
    try {
      assert.equal(h.chip('2026-10').disabled, true, 'octobre se ferme tant qu’il est déclaré deux fois');
      act(() => h.container.querySelector<HTMLButtonElement>('[data-receipt-remove="p2"]')!.click());
      act(() => h.container.querySelector<HTMLButtonElement>('[data-slot="payment-receipt-remove"]')!.click());
      assert.equal(h.deletions.length, 1, 'un seul geste, une seule suppression');
      assert.equal(h.deletions[0].studentId, 'a', 'le reçu part sous SON élève');
      // Le reçu ENTIER, pas un objet reconstruit depuis l'affichage : c'est ce
      // que la file hors ligne et l'instantané du journal exigent pour que le
      // geste reste restaurable (montant, numéro, date, mois, motif, année).
      assert.deepEqual(h.deletions[0].payment, asPayment(second));
      // Le reçu en trop a quitté le carnet : le mois n'est plus déclaré deux
      // fois, la preuve du second disparaît — et octobre reste RÉGLÉ par le reçu
      // qui demeure (retirer un doublon ne libère pas le mois).
      assert.equal(h.chip('2026-10').disabled, true, 'le mois reste réglé par le reçu qui demeure');
      assert.equal(h.chip('2026-10').dataset.paid, 'true');
      const text = h.container.textContent ?? '';
      assert.ok(text.includes('REC-123456'), 'le reçu qui reste est toujours nommé');
      assert.equal(text.includes('REC-999999'), false, 'celui qui est parti ne s’affiche plus');
      assert.equal(h.container.querySelector('[data-receipt]') !== null, false, 'plus de doublon à départager');
      const [only] = paymentMonthHistory([first], academicYearMonths(academicYearOf('2026-10-04'))).facts;
      assert.ok(
        text.includes(formatPaidMonthLine(only, translations.fr, 'fr')),
        'la phrase du mois redevient celle d’un seul reçu',
      );
    } finally { h.cleanup(); }
  });

  it('montre le doublon SANS offrir le geste quand le rôle n’a pas le droit', () => {
    // Le droit est celui qui existe déjà (`canDeletePayment` : admin, dev,
    // économe) : aucun droit nouveau n’est inventé, et sans lui la liste reste
    // informative — un doublon invisible serait pire qu’un doublon montré.
    const h = mount('fr', 'a', [first, second], false);
    try {
      assert.equal(h.container.querySelectorAll('[data-receipt]').length, 2, 'les deux reçus se voient');
      assert.equal(h.container.querySelectorAll('[data-receipt-remove]').length, 0, 'mais rien ne s’offre à retirer');
      assert.equal(h.container.querySelectorAll('[data-slot="payment-receipt-remove"]').length, 0);
    } finally { h.cleanup(); }
  });
});
