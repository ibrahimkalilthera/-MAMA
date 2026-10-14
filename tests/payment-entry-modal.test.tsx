import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PaymentEntryModal } from '../src/components/PaymentEntryModal';
import { translations } from '../src/i18n/translations';
import type { Student } from '../src/lib/useSupabaseData';
import {
  academicYearMonths,
  formatPaidMonths,
  paymentMonthLabel,
} from '../src/lib/paymentMonths';
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

function mount(lang: 'en' | 'fr' = 'fr', initialStudent = '') {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const submissions: string[] = [];
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
    return createElement(PaymentEntryModal, {
      t: translations[lang], lang, currentTheme: defaults.currentTheme,
      students, availableClasses: [
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
      paymentMonths: paymentMotifMonths(motif, selected, touched, dateMonth, monthOptions),
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
    container, select, change, submissions, chip, click, monthsLine, motifSelect,
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
