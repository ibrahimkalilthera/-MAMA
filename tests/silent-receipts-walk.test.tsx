// LE PARCOURS ÉLÈVE PAR ÉLÈVE, tel qu'il s'enchaîne depuis l'écran École.
//
// La brique pure est jugée à part (`tests/silent-receipts.test.ts` : l'ordre du
// plan, la vivacité d'une cible, les trois verdicts). Ici, on mesure ce que le
// PANNEAU en fait, et les six choses qui peuvent casser en silence :
//
//   • **l'ordre du geste** — l'élève le plus lourd d'abord, ses reçus du plus
//     ancien au plus récent, l'élève suivant ensuite. C'est la demande, et un
//     panneau qui reprendrait l'ordre de la mémoire le ferait sans rien dire ;
//   • **un reçu, une écriture** — un appel par reçu, dans l'ordre, jamais un lot :
//     la base ne connaît aucune écriture de masse de `months`, et chaque appel
//     laisse sa propre entrée au journal ;
//   • **aucune fiche ouverte** — c'est le point de la fonctionnalité : le parcours
//     ne doit pas appeler `setSelectedStudent` une seule fois ;
//   • **le compte rendu survit à la liste qui se vide** — le parcours écrit TOUS
//     les reçus, donc il vide la liste par construction : un panneau monté « s'il
//     y a du travail » emporterait la seule trace de ce qu'il vient d'écrire ;
//   • **un refus ne fait pas avancer** — l'éditeur reste sur le même reçu, le
//     brouillon intact, et le refus se lit à côté du reçu qui l'a essuyé ;
//   • **un reçu renseigné entre-temps est ÉCARTÉ** — jamais écrasé, et c'est dit.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SilentReceiptsView } from '../src/components/SilentReceiptsView';
import { MainViewsContext } from '../src/app/mainViewsContext';
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

/**
 * Trois élèves, dont un à DEUX reçus muets — et c'est le plus lourd, donc le
 * premier du parcours : le déroulé doit enchaîner SES DEUX reçus avant de passer
 * au suivant, du plus ancien au plus récent.
 */
const STUDENTS: Student[] = [
  student('st-big', 'Awa Traoré', '3A', [
    silent('p-big-new', '2026-10-12', 30000),
    silent('p-big-old', '2026-09-15', 10000),
  ]),
  student('st-small', 'Ali Diallo', '1A', [silent('p-small', '2026-09-20', 25000)]),
  // Hors du travail : un reçu qui déclare ses mois ne fait pas de ligne.
  student('st-ok', 'Fanta Keïta', '2A', [declared('p-ok', '2026-11-04', 60000, ['2026-09'])]),
];

/** Le mois de septembre de l'année jugée — la pastille que ces cas cochent. */
const SEP = '2026-09';
/** Un second mois, pour un reçu qui en couvre deux. */
const OCT = '2026-10';

/**
 * Monte l'écran École avec un ÉCRIVAIN piloté par le test, qui met à jour l'état
 * local comme le fait vraiment `updatePaymentMonths` (un succès retire le reçu de
 * la liste des muets). Sans cette mise à jour, aucun cas ne verrait la liste se
 * vider, et le compte rendu se féliciterait de n'avoir rien à publier.
 */
function mountWalk(opts: {
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
  const opened: (Student | null)[] = [];
  let students = opts.students ?? STUDENTS;

  const render = () => {
    const props = makeProps({
      students,
      selectedYear: '2026-2027',
      canEditPaymentMonths: opts.canEditPaymentMonths ?? true,
      setSelectedStudent: (value) => {
        opened.push(typeof value === 'function' ? value(null) : value);
      },
      setStudentFileFocus: () => undefined,
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
  const attr = (name: string, attribute: string) => slot(name)?.getAttribute(attribute) ?? null;

  return {
    container,
    calls,
    opened,
    click,
    slot,
    slots,
    root,
    /** Une pastille de l'éditeur partagé, par sa CLÉ (jamais par son libellé). */
    month: (ym: string) => container.querySelector(`button[data-month="${ym}"]`),
    /** Le bouton « Enregistrer » de l'éditeur partagé (fermé sans mois coché). */
    saveButton: () => slot('payment-months-save'),
    /** Enregistrer pour de vrai, et laisser l'écriture aboutir. */
    save: async () => { await act(async () => { (slot('payment-months-save') as HTMLElement).click(); }); },
    start: () => click(slot('silent-receipts-walk-start')),
    again: () => click(slot('silent-receipts-walk-again')),
    skip: () => click(slot('silent-receipts-walk-skip')),
    ready: () => (slot('silent-receipts-walk-ready')?.textContent ?? '').trim(),
    /** L'élève de l'étape en cours, par son identifiant. */
    stepStudent: () => attr('silent-receipts-walk-student', 'data-student'),
    /** Le reçu de l'étape en cours, par son identifiant. */
    stepReceipt: () => attr('silent-receipts-walk-receipt', 'data-receipt'),
    progress: () => (slot('silent-receipts-walk-progress')?.textContent ?? '').trim(),
    refused: () => slot('silent-receipts-walk-refused'),
    offline: () => slot('silent-receipts-walk-offline'),
    readOnly: () => slot('silent-receipts-read-only'),
    /** Combien d'éditeurs des mois sont à l'écran — jamais plus d'UN. */
    editors: () => container.querySelectorAll('[data-slot="payment-months-editor"]').length,
    /** L'éditeur est-il rendu DANS le panneau nommé ? (l'arbitrage, moitié par moitié) */
    editorIn: (panel: string) => Boolean(slot(panel)?.querySelector('[data-slot="payment-months-editor"]')),
    outcomes: () => slots('silent-receipts-walk-outcome').map((el) => ({
      student: el.getAttribute('data-student') ?? '',
      receipt: el.getAttribute('data-receipt') ?? '',
      ok: el.getAttribute('data-ok') ?? '',
      skip: el.getAttribute('data-skip') ?? '',
      text: (el.textContent ?? '').trim(),
    })),
    summary: () => (slot('silent-receipts-walk-summary')?.textContent ?? '').trim(),
    /** Les lignes encore muettes de l'écran (la liste qui se vide). */
    rows: () => slots('silent-receipts-row').map((el) => el.getAttribute('data-student') ?? ''),
    /** Un COLLÈGUE renseigne un reçu pendant que le parcours est ouvert. */
    fillInMeanwhile: (studentId: string, paymentId: string, months: string[]) => {
      students = students.map((s) => (s.id === studentId
        ? { ...s, payments: s.payments.map((p) => (p.id === paymentId ? { ...p, months: [...months] } : p)) }
        : s));
      act(() => render());
    },
    /** Le choix de classe de la PASSE, l'autre porte du même éditeur. */
    chooseClass: (grade: string) => {
      const select = slot('silent-receipts-pass-class') as HTMLSelectElement;
      act(() => {
        select.value = grade;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    text: () => container.textContent ?? '',
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('SilentReceiptsWalk — renseigner les mois depuis l’écran École, sans ouvrir de fiche', () => {
  it('enchaîne les élèves du plus gros montant au plus petit, un reçu à la fois', async () => {
    const h = mountWalk();
    try {
      assert.equal(
        h.ready(),
        t.silentReceiptsWalkReady.replace('{receipts}', '3').replace('{students}', '2'),
        'avant de partir, le panneau NOMME le travail : trois reçus muets, chez deux élèves',
      );

      h.start();
      assert.equal(h.stepStudent(), 'st-big', 'le départ est le plus gros montant non documenté');
      assert.equal(h.stepReceipt(), 'p-big-old', 'et il prend le reçu muet LE PLUS ANCIEN de cet élève');
      assert.equal(h.progress(), t.silentReceiptsWalkProgress.replace('{current}', '1').replace('{total}', '3'),
        'la position est dite : reçu 1 sur 3');

      h.click(h.month(SEP));
      await h.save();
      assert.deepEqual(h.calls, [{ studentId: 'st-big', paymentId: 'p-big-old', months: [SEP] }],
        'un appel, pour ce reçu-là, avec les mois triés');
      assert.equal(h.stepReceipt(), 'p-big-new',
        'le reçu suivant du MÊME élève : ses reçus s’enchaînent avant de passer à l’élève suivant');

      h.click(h.month(OCT));
      await h.save();
      assert.equal(h.stepStudent(), 'st-small', 'une fois l’élève fini, le parcours descend la liste');
      assert.equal(h.stepReceipt(), 'p-small');
      assert.equal(h.progress(), t.silentReceiptsWalkProgress.replace('{current}', '3').replace('{total}', '3'));

      h.click(h.month(SEP));
      await h.save();

      assert.deepEqual(h.calls.map((c) => c.paymentId), ['p-big-old', 'p-big-new', 'p-small'],
        'trois reçus, trois écritures, dans l’ordre de la liste — jamais un lot');
      assert.deepEqual(h.outcomes().map((o) => ({ student: o.student, receipt: o.receipt, ok: o.ok })), [
        { student: 'st-big', receipt: 'p-big-old', ok: 'true' },
        { student: 'st-big', receipt: 'p-big-new', ok: 'true' },
        { student: 'st-small', receipt: 'p-small', ok: 'true' },
      ], 'le compte rendu nomme chaque reçu écrit');
      assert.equal(h.summary(), t.silentReceiptsWalkSummary
        .replace('{written}', '3').replace('{refused}', '0').replace('{skipped}', '0'));
      assert.deepEqual(h.opened, [], 'et AUCUNE fiche n’a été ouverte : c’est tout l’intérêt du parcours');
    } finally {
      h.cleanup();
    }
  });

  it('le compte rendu survit à la liste qui se vide sous lui', async () => {
    // Le parcours écrit TOUS les reçus : la dernière écriture vide la liste, donc
    // la vue ne monte plus les panneaux « s'il y a du travail ». Un compte rendu
    // relu dans la liste se viderait ici, et l'école ne saurait pas ce qui est
    // parti — c'est le piège exact de cette fonctionnalité.
    const h = mountWalk();
    try {
      h.start();
      for (const month of [SEP, OCT, SEP]) {
        h.click(h.month(month));
        await h.save();
      }

      assert.deepEqual(h.rows(), [], 'il n’y a plus une seule ligne muette à l’écran');
      assert.ok(h.slot('silent-receipts-walk'), 'le panneau est toujours là');
      assert.equal(h.outcomes().length, 3, 'et le compte rendu porte les trois écritures');
      assert.ok(h.slot('silent-receipts-walk-again'), '« Nouveau parcours » est offert à la fin');
    } finally {
      h.cleanup();
    }
  });

  it('un refus ne fait PAS avancer, et se lit à côté du reçu qui l’a essuyé', async () => {
    const h = mountWalk({ result: (studentId, payment) => payment.id !== 'p-big-old' });
    try {
      h.start();
      h.click(h.month(SEP));
      await h.save();

      assert.equal(h.calls.length, 1, 'l’écriture a bien été tentée');
      assert.equal(h.stepReceipt(), 'p-big-old', 'la base a refusé : le parcours reste sur le même reçu');
      assert.ok(h.refused(), 'et le refus se lit à côté de lui, pas seulement à la fin');
      assert.ok(h.refused()?.textContent?.includes(t.silentReceiptsWalkRefused), 'avec ses mots');
      assert.equal(h.month(SEP)?.getAttribute('aria-pressed'), 'true',
        'le mois coché est INTACT : le poste peut réessayer sans le recocher');

      // Réessayer, puis laisser ce reçu de côté : le parcours avance alors, sans
      // avoir rien écrit pour lui.
      await h.save();
      assert.equal(h.calls.length, 2, 'le second essai repart du même reçu');
      h.skip();
      assert.equal(h.stepReceipt(), 'p-big-new', '« Passer » débloque le parcours');
      assert.equal(h.calls.length, 2, 'et n’écrit évidemment rien de plus');

      h.click(h.month(OCT));
      await h.save();
      h.click(h.month(SEP));
      await h.save();
      assert.deepEqual(h.outcomes().map((o) => ({ receipt: o.receipt, ok: o.ok, skip: o.skip })), [
        { receipt: 'p-big-old', ok: 'false', skip: '' },
        { receipt: 'p-big-old', ok: 'false', skip: '' },
        { receipt: 'p-big-old', ok: 'false', skip: 'passed' },
        { receipt: 'p-big-new', ok: 'true', skip: '' },
        { receipt: 'p-small', ok: 'true', skip: '' },
      ], 'chaque verdict est publié, refus et reçu laissé de côté compris');
      assert.equal(h.summary(), t.silentReceiptsWalkSummary
        .replace('{written}', '2').replace('{refused}', '2').replace('{skipped}', '1'));
      assert.ok(h.outcomes()[2]!.text.includes(t.silentReceiptsWalkPassed),
        'un reçu laissé de côté est NOMMÉ — il ne se fond ni dans les écrits ni dans les refus');
    } finally {
      h.cleanup();
    }
  });

  it('un reçu renseigné entre-temps est ÉCARTÉ, jamais écrasé', async () => {
    const h = mountWalk();
    try {
      h.start();
      // Un collègue a renseigné ce reçu pendant que le parcours était ouvert.
      h.fillInMeanwhile('st-big', 'p-big-old', [SEP]);

      h.click(h.month(OCT));
      await h.save();

      assert.deepEqual(h.calls, [], 'rien n’a été écrit : le choix existant n’est pas écrasé');
      assert.equal(h.stepReceipt(), 'p-big-new', 'le parcours avance sans rien toucher');
      assert.ok(h.outcomes().length === 0,
        'et il l’a fait AVANCER : la liste ne se met pas à attendre un reçu déjà renseigné');

      // Le verdict se lit au COMPTE RENDU, donc en fin de plan : on laisse les
      // deux reçus restants de côté pour l’atteindre.
      h.skip();
      h.skip();
      assert.deepEqual(h.outcomes().map((o) => ({ receipt: o.receipt, ok: o.ok, skip: o.skip })), [
        { receipt: 'p-big-old', ok: 'false', skip: 'stale' },
        { receipt: 'p-big-new', ok: 'false', skip: 'passed' },
        { receipt: 'p-small', ok: 'false', skip: 'passed' },
      ], 'le reçu renseigné entre-temps est ÉCARTÉ, et NOMMÉ comme tel');
      assert.ok(h.outcomes()[0]!.text.includes(t.silentReceiptsWalkStale), 'et le compte rendu l’explique');
      assert.equal(h.summary(), t.silentReceiptsWalkSummary
        .replace('{written}', '0').replace('{refused}', '0').replace('{skipped}', '3'),
        'aucun refus n’est compté : rien n’a été TENTÉ sur le reçu périmé');
    } finally {
      h.cleanup();
    }
  });

  it('hors ligne, le compte rendu dit « en file » et non « écrit »', async () => {
    const h = mountWalk();
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
      h.start();
      // Le parcours va jusqu'au bout : la note hors ligne et les verdicts vivent
      // dans le COMPTE RENDU, donc un cas qui s'arrêterait à la première étape
      // regarderait un écran où il n'y a encore rien à lire.
      for (const month of [SEP, OCT, SEP]) {
        h.click(h.month(month));
        await h.save();
      }

      assert.ok(h.offline(), 'le compte rendu porte sa note hors ligne');
      assert.equal(h.outcomes().length, 3, 'les trois reçus sont partis en file');
      for (const outcome of h.outcomes()) {
        assert.ok(outcome.text.includes(t.silentReceiptsPassQueued),
          'chaque reçu est dit EN FILE — « écrit » serait faux, rien n’est encore en base');
        assert.equal(outcome.text.includes(t.silentReceiptsPassWritten), false);
      }
      assert.equal(h.summary(), t.silentReceiptsWalkSummary
        .replace('{written}', '3').replace('{refused}', '0').replace('{skipped}', '0'),
        'et le résumé les compte comme écrits — mis en file, ce sont bien des gestes aboutis');
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
      h.cleanup();
    }
  });

  it('l’éditeur des mois n’a qu’UN hôte à la fois sur l’écran', async () => {
    // Les deux portes de l'écran École partagent la même UI de mois : sans
    // arbitrage, le même reçu afficherait vingt-quatre pastilles au lieu de douze.
    const h = mountWalk();
    try {
      assert.equal(h.editors(), 0, 'au repos, aucune pastille à l’écran');

      h.start();
      assert.equal(h.editors(), 1, 'le parcours ouvre l’éditeur, et un seul');
      assert.ok(h.editorIn('silent-receipts-walk'), 'il est rendu DANS le parcours');

      // L'autre porte prend l'éditeur (une classe choisie) : le parcours ne
      // l'affiche plus, et il le REPREND dès qu'elle le rend.
      h.chooseClass('3A');
      assert.equal(h.editors(), 1, 'choisir une classe ouvre l’éditeur de la passe — toujours un seul');
      assert.equal(h.editorIn('silent-receipts-walk'), false, 'le parcours s’efface devant elle');
      assert.ok(h.editorIn('silent-receipts-pass'), 'et c’est la passe qui le porte');

      h.chooseClass('');
      assert.equal(h.editors(), 1, 'la passe le rend en se vidant');
      assert.ok(h.editorIn('silent-receipts-walk'), 'et le parcours, qui a une étape en cours, le reprend');
    } finally {
      h.cleanup();
    }
  });

  it('« Nouveau parcours » repart de zéro', async () => {
    const h = mountWalk();
    try {
      h.start();
      h.skip();
      h.skip();
      h.skip();
      assert.equal(h.outcomes().length, 3, 'les trois reçus ont été laissés de côté');
      h.again();
      assert.ok(h.slot('silent-receipts-walk-start'), 'le panneau revient à son état de départ');
      assert.equal(h.outcomes().length, 0, 'et le compte rendu est vidé avec lui');
      assert.equal(h.editors(), 0, 'plus un seul éditeur à l’écran');
    } finally {
      h.cleanup();
    }
  });

  it('n’est offert qu’à qui peut écrire les mois', () => {
    const allowed = mountWalk();
    try {
      assert.ok(allowed.slot('silent-receipts-walk'), 'un compte qui peut écrire voit le parcours');
    } finally {
      allowed.cleanup();
    }

    const refused = mountWalk({ canEditPaymentMonths: false });
    try {
      assert.equal(refused.slot('silent-receipts-walk'), null,
        'sans le droit d’écrire les mois, aucun parcours n’est offert — un geste que la base refuserait est tu, pas annoncé');
      assert.ok(refused.readOnly(), 'et l’écran dit pourquoi');
      assert.ok(refused.slot('silent-receipts-row'), 'la liste, elle, reste lisible');
    } finally {
      refused.cleanup();
    }
  });
});
