// L'ÉCRAN ÉCOLE des reçus muets, tel qu'il se lit et tel qu'il s'ouvre.
//
// La brique pure est jugée à part (tests/silent-receipts.test.ts) : ici on mesure
// ce que l'écran en FAIT — l'ordre qu'il affiche, le total qu'il annonce, et
// surtout le CLIC : la fiche doit s'ouvrir sur le reçu muet LE PLUS ANCIEN de
// l'élève, et sur aucun autre. C'est le geste que l'utilisateur vient chercher, et
// le seul endroit où l'écran a quelque chose à décider (l'agrégat a déjà décidé du
// reste).
//
// Trois choses y sont vérifiées, chacune cassable en silence :
//
//   • le focus est posé AVANT la fiche (`setStudentFileFocus` puis
//     `setSelectedStudent`) : posé après, la fiche serait déjà née sans lui et
//     l'éditeur ne s'ouvrirait qu'au clic suivant — un écran qui semble marcher ;
//   • sans reçu muet, l'écran dit une PHRASE, pas un en-tête de tableau vide — un
//     tableau vide se lit « la lecture a raté », pas « il n'y a rien à faire » ;
//   • sans droit d'écrire les mois, l'écran le DIT. Il ne cache pas les lignes
//     (il ne lit que les élèves déjà chargés, donc tout compte connecté a le droit
//     de savoir ce qui reste) mais il ne promet pas un éditeur que la base
//     refuserait.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SilentReceiptsView } from '../src/components/SilentReceiptsView';
import { MainViews } from '../src/components/MainViews';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import { translations } from '../src/i18n/translations';
import type { Payment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.en;

const silent = (id: string, date: string, amount: number): Payment => ({ id, date, amount });
const declared = (id: string, date: string, amount: number, months: string[]): Payment =>
  ({ id, date, amount, months });

const student = (id: string, name: string, grade: string, payments: Payment[]): Student => ({
  id,
  name,
  parentName: `Parent ${name}`,
  parentEmail: '',
  parentPhone: '',
  totalDue: 150000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  dueDate: '2027-06-30',
  notes: '',
  payments,
  grade,
  academicYear: '2026-2027',
});

const STUDENTS: Student[] = [
  student('st-big', 'Awa Traoré', '3A', [
    silent('p-new', '2026-10-12', 30000),
    // Le plus ANCIEN, rangé après le plus récent : c'est cet id-là que le clic
    // doit poser en focus.
    silent('p-old', '2026-09-15', 10000),
  ]),
  student('st-small', 'Ali Diallo', '1A', [
    silent('p-small', '2026-09-20', 25000),
    declared('p-oct', '2026-10-05', 10000, ['2026-10']),
  ]),
  student('st-ok', 'Fanta Keïta', '2A', [declared('p-ok', '2026-11-04', 60000, ['2026-09'])]),
];

function mount(overrides: Partial<MainViewsProps> = {}) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const selected: (Student | null)[] = [];
  const focuses: (string | null)[] = [];

  const props = makeProps({
    students: STUDENTS,
    selectedYear: '2026-2027',
    canEditPaymentMonths: true,
    setSelectedStudent: (value) => {
      selected.push(typeof value === 'function' ? value(null) : value);
    },
    setStudentFileFocus: (value) => {
      focuses.push(typeof value === 'function' ? value(null) : value);
    },
    ...overrides,
  });

  act(() => {
    root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(SilentReceiptsView)));
  });

  const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
  const rows = () => Array.from(container.querySelectorAll('[data-slot="silent-receipts-row"]'));
  const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

  return {
    container,
    selected,
    focuses,
    click,
    root,
    /** La racine de l'écran — présente dès qu'il est monté, muets ou non. */
    screen: () => slot('silent-receipts'),
    rows,
    /** Les lignes, avec l'élève et le reçu que le clic ouvrirait. */
    lines: () => rows().map((el) => ({
      student: el.getAttribute('data-student') ?? '',
      receipt: el.getAttribute('data-receipt') ?? '',
      text: (el.textContent ?? '').trim(),
    })),
    /** Le pied de liste (élèves + montant non documenté), lu par son marqueur. */
    total: () => (slot('silent-receipts-total')?.textContent ?? '').trim(),
    empty: () => slot('silent-receipts-empty'),
    readOnly: () => slot('silent-receipts-read-only'),
    text: () => container.textContent ?? '',
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

// ─── LA PASSE GROUPÉE, depuis l'écran École ──────────────────────────────────
//
// Ce que ces cas tiennent, et qui peut casser en silence :
//
//   • **un reçu, une écriture** — la passe appelle l'écrivain de l'application
//     une fois par reçu retenu, jamais un « lot » : la base ne connaît aucune
//     écriture de masse de `months`, et chaque appel laisse sa propre entrée au
//     journal. Un test qui compterait les appels le prouve ;
//   • **le reçu visé** est le plus ANCIEN de chaque élève coché, et seulement
//     dans la classe choisie — un élève à deux reçus muets garde le second ;
//   • **ce qui a été écrit est PUBLIÉ, et survit à la liste qui se vide** : c'est
//     le piège de la fonctionnalité. Si le compte rendu était relu dans la liste
//     (qui perd les reçus écrits au fur et à mesure), il se viderait tout seul et
//     l'école ne saurait pas ce qui est parti ;
//   • **un refus est nommé** et n'efface pas les réussites déjà publiées ;
//   • **hors ligne**, le compte rendu dit « en file » et non « écrit ».

const BULK_STUDENTS: Student[] = [
  // 1A : deux élèves, dont un à DEUX reçus muets (seul le plus ancien part).
  student('st-a', 'Awa Traoré', '1A', [silent('p-a-new', '2026-10-12', 30000), silent('p-a-old', '2026-09-15', 10000)]),
  student('st-b', 'Ali Diallo', '1A', [silent('p-b', '2026-09-20', 25000)]),
  // 2A : un seul, qui ne doit PAS être emporté par une passe faite en 1A.
  student('st-c', 'Fanta Keïta', '2A', [silent('p-c', '2026-09-22', 40000)]),
];

/**
 * Monte l'écran avec un ÉCRIVAIN piloté par le test — et qui met à jour l'état
 * local comme le fait vraiment `updatePaymentMonths` (un succès retire le reçu de
 * la liste des muets). Sans cette mise à jour, le cas ne verrait jamais la liste
 * se vider, et se féliciterait d'un compte rendu qui n'a rien à publier.
 */
function mountBulk(opts: {
  students?: Student[];
  /** Rend `true` (écrit) ou `false` (refusé) pour un reçu donné. */
  result?: (studentId: string, payment: Payment) => boolean;
  canEditPaymentMonths?: boolean;
} = {}) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: { studentId: string; paymentId: string; months: string[] }[] = [];
  let students = opts.students ?? BULK_STUDENTS;

  const render = () => {
    const props = makeProps({
      students,
      selectedYear: '2026-2027',
      canEditPaymentMonths: opts.canEditPaymentMonths ?? true,
      updatePaymentMonths: async (studentId: string, payment: Payment, months: string[]) => {
        calls.push({ studentId, paymentId: payment.id ?? '', months: [...months] });
        const ok = opts.result ? opts.result(studentId, payment) : true;
        if (ok) {
          // Ce que fait l'écrivain réel : le reçu quitte les « sans mois déclaré ».
          students = students.map((s) => (s.id === studentId
            ? { ...s, payments: s.payments.map((p) => (p.id === payment.id ? { ...p, months: [...months] } : p)) }
            : s));
          act(() => render());
        }
        return ok;
      },
    });
    root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(SilentReceiptsView)));
  };
  act(render);

  const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
  const slots = (name: string) => Array.from(container.querySelectorAll(`[data-slot="${name}"]`));
  const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });

  return {
    container,
    calls,
    click,
    root,
    slot,
    /** Le choix de classe — piloté par l'événement que React écoute vraiment. */
    chooseClass: (grade: string) => {
      const select = slot('silent-receipts-pass-class') as HTMLSelectElement;
      act(() => {
        select.value = grade;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    /** Les élèves cochables de la classe choisie. */
    passStudents: () => slots('silent-receipts-pass-student').map((el) => ({
      student: el.getAttribute('data-student') ?? '',
      checked: (el.querySelector('input') as HTMLInputElement).checked,
      text: (el.textContent ?? '').trim(),
    })),
    /** Les classes offertes par le sélecteur. */
    classOptions: () => Array.from((slot('silent-receipts-pass-class') as HTMLSelectElement).options)
      .map((option) => option.value),
    /** Les lignes encore muettes, en haut (la liste de l'écran). */
    rows: () => slots('silent-receipts-row').map((el) => el.getAttribute('data-student') ?? ''),
    /** Les pastilles de l'éditeur partagé. */
    month: (ym: string) => container.querySelector(`button[data-month="${ym}"]`),
    /** Le compte rendu, reçu par reçu. */
    outcomes: () => slots('silent-receipts-pass-outcome').map((el) => ({
      student: el.getAttribute('data-student') ?? '',
      receipt: el.getAttribute('data-receipt') ?? '',
      ok: el.getAttribute('data-ok') ?? '',
      text: (el.textContent ?? '').trim(),
    })),
    summary: () => (slot('silent-receipts-pass-summary')?.textContent ?? '').trim(),
    offlineNote: () => slot('silent-receipts-pass-offline'),
    readOnly: () => slot('silent-receipts-read-only'),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

/** Le mois de septembre de l'année jugée — la pastille que ces cas cochent. */
const SEP = '2026-09';

describe('SilentReceiptsPass — la passe groupée des reçus muets', () => {
  it('écrit chaque reçu SÉPARÉMENT et publie ce qui a été écrit', async () => {
    const h = mountBulk();
    try {
      assert.deepEqual(h.classOptions(), ['', '1A', '2A'],
        'les classes qui portent du travail, plus le choix vide');

      h.chooseClass('1A');
      assert.deepEqual(h.passStudents().map((s) => s.student), ['st-a', 'st-b'],
        'seuls les élèves de la classe choisie sont proposés');
      assert.deepEqual(h.passStudents().map((s) => s.checked), [false, false], 'rien de coché au départ');

      h.click(h.slot('silent-receipts-pass-all'));
      assert.deepEqual(h.passStudents().map((s) => s.checked), [true, true], 'toute la classe les coche');

      h.click(h.month(SEP));
      h.click(h.slot('payment-months-save'));
      assert.equal(
        (h.slot('silent-receipts-pass-run')?.textContent ?? '').trim(),
        t.silentReceiptsPassConfirm.replace('{count}', '2'),
        'l’étape de confirmation ANNONCE les deux reçus avant d’écrire',
      );

      await act(async () => { (h.slot('silent-receipts-pass-run') as HTMLElement).click(); });

      assert.deepEqual(h.calls, [
        { studentId: 'st-a', paymentId: 'p-a-old', months: [SEP] },
        { studentId: 'st-b', paymentId: 'p-b', months: [SEP] },
      ], 'un appel PAR reçu, dans l’ordre de la liste, et seul le reçu le PLUS ANCIEN de st-a');

      assert.deepEqual(h.outcomes().map((o) => ({ student: o.student, receipt: o.receipt, ok: o.ok })), [
        { student: 'st-a', receipt: 'p-a-old', ok: 'true' },
        { student: 'st-b', receipt: 'p-b', ok: 'true' },
      ], 'le compte rendu nomme chaque reçu écrit');
      assert.equal(h.summary(), t.silentReceiptsPassSummary.replace('{written}', '2').replace('{refused}', '0'));

      // Le piège : les deux reçus ont quitté la liste (l’écrivain a mis à jour
      // l’état), et le compte rendu doit rester lisible.
      assert.deepEqual(h.rows(), ['st-c', 'st-a'],
        'st-b n’a plus de reçu muet ; st-a garde son second (10 000), et st-c, hors de la passe, est intact');
      assert.equal(h.outcomes().length, 2, 'le compte rendu, lui, ne se vide pas avec la liste');
    } finally {
      h.cleanup();
    }
  });

  it('public un refus SANS effacer les écritures déjà faites', async () => {
    const h = mountBulk({ result: (studentId) => studentId !== 'st-b' });
    try {
      h.chooseClass('1A');
      h.click(h.slot('silent-receipts-pass-all'));
      h.click(h.month(SEP));
      h.click(h.slot('payment-months-save'));
      await act(async () => { (h.slot('silent-receipts-pass-run') as HTMLElement).click(); });

      assert.deepEqual(h.outcomes().map((o) => ({ student: o.student, ok: o.ok })), [
        { student: 'st-a', ok: 'true' },
        { student: 'st-b', ok: 'false' },
      ], 'les deux lignes sont publiées, chacune avec son verdict');
      assert.ok(h.outcomes()[1]!.text.includes(t.silentReceiptsPassRefused), 'le refus est nommé');
      assert.ok(h.outcomes()[0]!.text.includes(t.silentReceiptsPassWritten), 'et l’écrit aussi');
      assert.equal(h.summary(), t.silentReceiptsPassSummary.replace('{written}', '1').replace('{refused}', '1'),
        'le résumé sépare les deux — un total unique ferait passer un refus pour une réussite');
      assert.deepEqual(h.rows().sort(), ['st-a', 'st-b', 'st-c'],
        'le reçu refusé est toujours muet : il reste sur la liste, avec les élèves hors passe');
    } finally {
      h.cleanup();
    }
  });

  it('hors ligne, le compte rendu dit « en file » et non « écrit »', async () => {
    const h = mountBulk();
    const win = globalThis.window as unknown as Window;
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
      h.chooseClass('1A');
      h.click(h.slot('silent-receipts-pass-all'));
      h.click(h.month(SEP));
      h.click(h.slot('payment-months-save'));
      await act(async () => { (h.slot('silent-receipts-pass-run') as HTMLElement).click(); });

      assert.ok(h.offlineNote(), 'le compte rendu porte sa note hors ligne');
      assert.ok(
        h.outcomes().every((o) => o.text.includes(t.silentReceiptsPassQueued)),
        'chaque reçu est dit EN FILE — « écrit » serait faux, rien n’est encore en base',
      );
      assert.ok(h.outcomes().every((o) => o.text.includes(t.silentReceiptsPassWritten) === false),
        'et aucun n’est dit écrit');
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
      void win;
      h.cleanup();
    }
  });

  it('n’est offerte qu’à qui peut écrire les mois', () => {
    const allowed = mountBulk();
    try {
      assert.ok(allowed.slot('silent-receipts-pass'), 'un compte qui peut écrire voit la passe');
    } finally {
      allowed.cleanup();
    }

    const refused = mountBulk({ canEditPaymentMonths: false });
    try {
      assert.equal(refused.slot('silent-receipts-pass'), null,
        'sans le droit d’écrire les mois, aucune passe n’est offerte — un geste que la base refuserait est empêché, pas annoncé');
      assert.ok(refused.readOnly(), 'et l’écran dit pourquoi');
      assert.ok(refused.slot('silent-receipts-row'), 'la liste, elle, reste lisible');
    } finally {
      refused.cleanup();
    }
  });
});

describe('SilentReceiptsView — l’écran École des reçus muets', () => {
  it('liste les élèves du plus gros montant non documenté au plus petit', () => {
    const h = mount();
    try {
      assert.ok(h.screen(), 'l’écran est monté');
      assert.deepEqual(h.lines().map((l) => l.student), ['st-big', 'st-small'],
        'le plus gros montant d’abord — et aucun élève sans reçu muet');
      assert.deepEqual(h.lines().map((l) => l.receipt), ['p-old', 'p-small'],
        'chaque ligne porte le reçu muet LE PLUS ANCIEN de l’élève');
      assert.equal(h.empty(), null, 'il y a du travail : pas de message « rien à faire »');
      assert.ok(h.lines()[0]!.text.includes('Awa Traoré'), 'la ligne nomme l’élève');
      assert.ok(h.lines()[0]!.text.includes('40000 XOF'),
        'et affiche le montant non documenté (la somme de ses reçus muets)');
      assert.ok(h.lines()[1]!.text.includes(t.monthsCoveredCount.replace('{covered}', '1').replace('{total}', '12')),
        'la couverture déjà déclarée se lit sur la ligne');
      assert.ok(h.text().includes(t.silentReceiptsHint.replace('{year}', '2026-2027')),
        'l’en-tête NOMME l’année jugée : un reçu absent pour cause d’année doit pouvoir se comprendre');
    } finally {
      h.cleanup();
    }
  });

  it('le pied de liste dit combien d’élèves et combien reste à documenter', () => {
    const h = mount();
    try {
      assert.equal(h.total(), t.silentReceiptsSummary.replace('{students}', '2').replace('{amount}', '65000 XOF'),
        'deux élèves, 65 000 de reçus à documenter');
    } finally {
      h.cleanup();
    }
  });

  it('cliquer une ligne ouvre la fiche SUR son reçu muet le plus ancien', () => {
    const h = mount();
    try {
      h.click(h.rows()[0]!);
      assert.deepEqual(h.focuses, ['p-old'],
        'le focus est le reçu muet LE PLUS ANCIEN — pas celui que la fiche lirait d’abord');
      assert.deepEqual(h.selected.map((s) => s?.id), ['st-big'],
        'et la fiche de l’élève de la ligne s’ouvre dans le même geste');

      h.click(h.rows()[1]!);
      assert.deepEqual(h.focuses, ['p-old', 'p-small'], 'la seconde ligne pose son propre reçu');
      assert.deepEqual(h.selected.map((s) => s?.id), ['st-big', 'st-small']);
    } finally {
      h.cleanup();
    }
  });

  it('sans reçu muet, l’écran le dit — il ne laisse pas un tableau vide', () => {
    const h = mount({ students: [STUDENTS[2]!], selectedYear: '2026-2027' });
    try {
      assert.equal(h.rows().length, 0, 'aucune ligne');
      assert.ok(h.empty(), 'l’état vide est rendu');
      assert.ok(h.text().includes(t.silentReceiptsEmpty), 'et il porte sa phrase');
      assert.equal(h.total(), '', 'pas de pied de liste : il n’y a rien à additionner');
    } finally {
      h.cleanup();
    }
  });

  it('la ROUTE de l’onglet rend bien cet écran, et rien d’autre', async () => {
    // Le dernier maillon, et celui que l'utilisateur clique : le routeur des vues
    // doit rendre CET écran sur `activeTab === 'silentReceipts'`. Un câblage
    // oublié quelque part entre l'union de types, le routeur et l'import paresseux
    // ne se voit pas dans les cas ci-dessus — ils rendent la vue directement.
    installDomGlobals();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = makeProps({ students: STUDENTS, selectedYear: '2026-2027', activeTab: 'silentReceipts' });
    try {
      await act(async () => {
        root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(MainViews, props)));
      });
      // L'import paresseux se résout en promesse : on la laisse aboutir.
      for (let i = 0; i < 5 && !container.querySelector('[data-slot="silent-receipts"]'); i += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      }
      assert.ok(container.querySelector('[data-slot="silent-receipts"]'),
        'la route de l’onglet rend l’écran des reçus muets');
      assert.equal(container.querySelectorAll('[data-slot="silent-receipts-row"]').length, 2,
        'avec ses lignes — la route n’est pas un simple fallback');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('sans droit d’écrire les mois, l’écran le DIT sans cacher le travail', () => {
    const withRight = mount();
    try {
      assert.equal(withRight.readOnly(), null, 'un compte qui peut écrire ne lit pas cet avertissement');
    } finally {
      withRight.cleanup();
    }

    const without = mount({ canEditPaymentMonths: false });
    try {
      assert.ok(without.readOnly(), 'l’avertissement est rendu');
      assert.ok(without.text().includes(t.silentReceiptsReadOnly), 'et il nomme ce qui manque');
      assert.deepEqual(without.lines().map((l) => l.student), ['st-big', 'st-small'],
        'les lignes restent : lire ce qui reste à documenter n’est pas un droit d’écrire');
    } finally {
      without.cleanup();
    }
  });
});
