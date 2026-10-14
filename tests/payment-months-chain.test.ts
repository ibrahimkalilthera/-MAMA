/**
 * Les MOIS COCHÉS AU GUICHET, d'un bout à l'autre : formulaire → base → reçu.
 *
 * WHY THIS EXISTS
 * ---------------
 * Le 2026-10-11, le choix des mois est devenu une DONNÉE du paiement (colonne
 * `payments.months`, voir supabase/migrations/20261011000000_payments_months.sql,
 * et DEVELOPMENT_HISTORY.md). Chaque moitié de la chaîne avait ses cas :
 *
 *   • le formulaire → la charge utile : 12 cas sur la modale, 4 sur le hook ;
 *   • les octets du reçu : 7 cas sur la ligne « Mois » de `pdfReceipt.ts` ;
 *   • le rejeu hors ligne : 1 cas sur la file.
 *
 * Mais AUCUN test ne portait une valeur du début à la fin, et deux jointures
 * n'étaient couvertes nulle part — mesuré le 2026-10-12 :
 *
 *   1. l'ÉCRITURE (`src/lib/dataOps/payments.ts`, `months: payment.months ?? []`)
 *      n'avait aucun cas : un `months` oublié là n'aurait fait rougir personne ;
 *   2. la RELECTURE (la ligne de base → le paiement manipulé) vivait en clair au
 *      milieu du regroupement par élève de `useSupabaseData.ts` : un test ne
 *      pouvait pas la tenir. Elle est devenue la brique nommée `mapPaymentRow`
 *      (src/lib/rowMappers.ts), et c'est ce fichier qui la juge.
 *
 * Une jointure qui perd les mois ne casse rien de visible : le reçu retombe
 * SILENCIEUSEMENT sur le mois de sa date — un papier officiel qui dit
 * « Octobre » à une famille qui a réglé septembre, novembre et décembre. C'est
 * exactement le défaut que la colonne existe pour supprimer, et c'est pourquoi
 * le cas principal ci-dessous ne se contente pas de comparer des tableaux : il
 * exige que le PAPIER porte les mois cochés, et il prouve (dernier cas) que le
 * test rougirait si la relecture les perdait.
 *
 * Ce que ce fichier n'est pas : un test de la base. La ligne est celle que
 * l'application ENVOIE, aux colonnes que Postgres rend (`database.types.ts`,
 * `payments.Row`) — la contrainte `payments_months_shape_check` est tenue par
 * tests/apply-migration.test.ts, la pile réelle par le pixel-check E2E
 * (`--mode recu-mois`, .github/workflows/pdf-e2e.yml).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Payment, Student, User } from '../src/app/types';
import type { DbRow } from '../src/lib/database.types';
import { buildParentReceiptPdf } from '../src/lib/pdfReceipt';
import { formatPaidMonths, paymentMonthLabel } from '../src/lib/paymentMonths';
import { mapPaymentRow } from '../src/lib/rowMappers';
import { installDomGlobals, stubAlert, renderHook } from './harness';
import { mockModule } from './module-mock';

// ── Le faux client Supabase : il ENREGISTRE ce qui part vers la base ─────────
// Même forme que tests/offline-import-promote.test.ts et
// tests/dataops-write-honesty.test.ts. Le module est simulé AVANT l'import du
// gestionnaire (le vrai client ne se charge pas sous le lanceur de tests), et
// c'est ce journal qui porte la jointure « charge utile → ligne écrite ».
interface Call {
  op: 'insert' | 'update' | 'delete' | 'select' | 'rpc';
  table: string;
  payload?: Record<string, unknown>;
}

let calls: Call[] = [];
// Une LECTURE rend une liste vide (et non `null`) : le hook des paiements
// relit les notes du calendrier au montage, et `null` y ferait planter une
// itération — ce fichier ne juge pas cette lecture, il ne doit pas s'y casser.
const rowsResult: { data: unknown; error: unknown } = { data: [], error: null };

interface Chain extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: (column: string, value: unknown) => Chain;
  neq: (column: string, value: unknown) => Chain;
  order: (column: string, opts?: unknown) => Chain;
  limit: (count: number) => Chain;
  select: (columns?: string) => Chain;
  single: () => Promise<{ data: unknown; error: unknown }>;
}

function chain(resolveWith: () => { data: unknown; error: unknown }): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    eq: () => api,
    neq: () => api,
    order: () => api,
    limit: () => api,
    select: () => api,
    single: () => Promise.resolve().then(resolveWith),
    then: promise.then.bind(promise),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  auth: {
    getUser: async () => ({ data: { user: null } }),
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: (table: string) => ({
    select: () => {
      calls.push({ op: 'select', table });
      return chain(() => rowsResult);
    },
    insert: (payload: Record<string, unknown>) => {
      calls.push({ op: 'insert', table, payload });
      return chain(() => ({ data: null, error: null }));
    },
    update: (payload: Record<string, unknown>) => {
      calls.push({ op: 'update', table, payload });
      return chain(() => rowsResult);
    },
    delete: () => {
      calls.push({ op: 'delete', table });
      return chain(() => rowsResult);
    },
  }),
  // L'écriture BORNÉE des mois (20261013000000_econome_payment_months.sql) : la
  // fonction de la base rend le NOMBRE de lignes écrites, et c'est ce nombre que
  // l'app lit — 0 n'est pas un succès. Elle est capturée comme un appel à part :
  // un appel de FONCTION n'est pas une table, et un chemin qui repasserait par un
  // UPDATE de `payments` doit se voir ici.
  rpc: async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ op: 'rpc', table: fn, payload: args });
    return { data: 1, error: null };
  },
};

installDomGlobals();
// Le reçu du MOMENT passe par jsPDF (impossible à exécuter sous happy-dom) : les
// importateurs reçoivent un générateur inerte. Le reçu que ce fichier juge est
// celui de la RÉIMPRESSION — `buildParentReceiptPdf`, du vrai module, importé
// plus haut et donc déjà lié.
mockModule('../src/lib/pdfReceipt', {
  generatePaymentReceiptPdf: async () => {},
});
mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { usePayments } = await import('../src/app/usePayments');
const { createPaymentOps } = await import('../src/lib/dataOps/payments');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const t = translations.fr as TranslationDict;

const cashier: User = { username: 'ibrahim', name: 'Ibrahim Thera', role: 'admin' };

const ali: Student = {
  id: 's1',
  name: 'Ali Diallo',
  parentName: 'Mamadou Diallo',
  parentEmail: 'parent@example.com',
  parentPhone: '+223 70 00 00 00',
  totalDue: 150000,
  amountPaid: 50000,
  dueDate: '2026-12-31',
  grade: '9eme A',
  academicYear: '2026-2027',
  payments: [],
  notes: '',
};

/** Les mots que le reçu emploie — lus dans les vrais dictionnaires. */
const words = (lang: 'fr' | 'en' = 'fr') => ({
  label: (ym: string) => paymentMonthLabel(ym, translations[lang] as TranslationDict),
  count: (n: number) => String(translations[lang].paidMonthsCount).replace('{count}', String(n)),
  rangeTo: String(translations[lang].paidMonthsRangeTo),
});

/** Le papier de l'école, injecté : le contrôle ne va rien chercher sur le réseau. */
const templateBytes = readFileSync(new URL('../public/templates/recu-parent.pdf', import.meta.url));

/** Le texte réellement IMPRIMÉ sur le reçu (pas ce qu'on a voulu y mettre). */
async function printedTexts(payment: Payment): Promise<string[]> {
  const { bytes } = await buildParentReceiptPdf({
    student: ali,
    payment,
    lang: 'fr',
    cashierName: cashier.name,
    template: new Uint8Array(templateBytes),
  });
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await loadingTask.promise;
  try {
    const content = await (await doc.getPage(1)).getTextContent();
    return content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .map((item) => item.str);
  } finally {
    await loadingTask.destroy();
  }
}

// ── Le guichet : le vrai hook, de vrais clics sur les pastilles ──────────────
interface Spies {
  alerts: string[];
  payments: Array<{ studentId: string; payment: Payment }>;
}

function baseDeps(spies: Spies) {
  return {
    t,
    lang: 'fr' as const,
    selectedYear: '2026-2027',
    lockedYears: [],
    students: [ali],
    staff: [],
    expenses: [],
    todos: [],
    currentUser: cashier,
    addPayment: async (studentId: string, payment: Payment) => {
      spies.payments.push({ studentId, payment });
      return true;
    },
    updateStudent: async () => true,
    toastError: (msg: string) => { spies.alerts.push(msg); },
  } as unknown as Parameters<typeof usePayments>[0];
}

/**
 * Le geste du guichet : on ouvre la saisie, on date, on coche des mois, on
 * envoie. Rend ce que le domaine a reçu — la charge utile, pas un tableau
 * reconstruit par le test.
 */
async function tickAndSubmit(date: string, tick: string[]): Promise<Payment> {
  const spies: Spies = { alerts: [], payments: [] };
  const ref: { current: ReturnType<typeof usePayments> | null } = { current: null };
  const { unmount } = renderHook(usePayments, baseDeps(spies), ref);
  const restoreAlert = stubAlert(spies.alerts);
  try {
    await act_(() => {
      ref.current!.setShowPaymentForm(true);
      ref.current!.setPaymentStudentId('s1');
      ref.current!.setPaymentAmount('25000');
      ref.current!.setPaymentDate(date);
    });
    for (const month of tick) {
      await act_(() => ref.current!.togglePaymentMonth(month));
    }
    await act_(async () => {
      await ref.current!.handlePaymentSubmit({ preventDefault: () => {} } as never);
    });
    const sent = spies.payments[0];
    assert.ok(sent, `aucun paiement n’est parti (alertes : ${spies.alerts.join(' | ')})`);
    return sent.payment;
  } finally {
    unmount();
    restoreAlert();
  }
}

/** Le vrai `act` de React, sans importer React deux fois dans ce fichier. */
async function act_(body: () => void | Promise<void>): Promise<void> {
  const { act } = await import('react');
  await act(async () => { await body(); });
}

// ── La base : l'écriture réelle, sur un faux client ─────────────────────────
function ctx() {
  return {
    students: [ali],
    staff: [],
    parents: [],
    vendorExpenses: [],
    expenses: [],
    setParents: () => {},
    setStudents: () => {},
    setStaff: () => {},
    setSalaryPayments: () => {},
    setExpenses: () => {},
    setVendorExpenses: () => {},
    setTodos: () => {},
    setCustomClasses: () => {},
    notifySuccess: () => {},
    notifyError: () => {},
    isOffline: () => false,
    enqueueOffline: () => {},
    updateQueueCount: () => {},
  } as unknown as Parameters<typeof createPaymentOps>[0];
}

/** La ligne que l'application ENVOIE à `payments` — la dernière insérée. */
function sentPaymentRow(): Record<string, unknown> {
  const insert = calls.filter((c) => c.op === 'insert' && c.table === 'payments').at(-1);
  assert.ok(insert?.payload, 'le paiement doit être écrit en base (aucun insert capturé)');
  return insert.payload;
}

/**
 * La ligne telle que la BASE la rend : mêmes colonnes que `payments.Row`
 * (snake_case, `created_at` fourni par Postgres), construite à partir de ce qui
 * a été envoyé — ce que la base stocke est ce qu'on lui a donné.
 */
function rowFromBase(sent: Record<string, unknown>): DbRow<'payments'> {
  return {
    id: String(sent.id ?? 'pay-1'),
    student_id: String(sent.student_id),
    date: String(sent.date),
    amount: Number(sent.amount),
    academic_year: (sent.academic_year ?? null) as string | null,
    receipt_number: (sent.receipt_number ?? null) as string | null,
    months: (sent.months ?? []) as string[],
    // Le motif suit la même règle : ce que la base stocke est ce qu'on lui a
    // donné, et `null` quand le geste n'en déclarait pas.
    motif: (sent.motif ?? null) as string | null,
    created_at: '2026-10-12T00:00:00.000Z',
  };
}

describe('la chaîne des mois — guichet → base → reçu', () => {
  it('trois mois cochés (troués) arrivent TELS QUELS sur le reçu, et pas le mois de la date', async () => {
    calls = [];
    const payment = await tickAndSubmit('2026-10-04', ['2026-10', '2026-09', '2026-11', '2026-12']);
    // Le premier clic DÉCOCHE le mois proposé d'avance (celui de la date) : la
    // liste est donc trouée, ce qui est la forme la plus exigeante à transporter.
    assert.deepEqual(payment.months, ['2026-09', '2026-11', '2026-12'], 'le formulaire a trié le choix');

    const written = await createPaymentOps(ctx()).addPayment('s1', payment);
    assert.equal(written, true, 'l’écriture est annoncée réussie');
    assert.deepEqual(sentPaymentRow().months, ['2026-09', '2026-11', '2026-12'], 'la LIGNE part avec les mois cochés');

    const readBack = mapPaymentRow(rowFromBase(sentPaymentRow()));
    assert.deepEqual(readBack.months, ['2026-09', '2026-11', '2026-12'], 'la RELECTURE les rend tels quels');

    const texts = await printedTexts(readBack);
    const expected = formatPaidMonths(readBack.months!, words());
    assert.equal(expected, '3 mois : Septembre, Novembre, Décembre', 'les mots du reçu (règle du module pur)');
    assert.ok(texts.includes(expected), `le PAPIER porte « ${expected} » — imprimé : ${texts.join(' | ')}`);
    assert.ok(!texts.includes('Octobre'), 'le mois de la date n’est PAS écrit à la place des mois réglés');
  });

  it('un seul mois coché se dit NU sur le reçu — et part nu en base', async () => {
    calls = [];
    const payment = await tickAndSubmit('2026-10-04', ['2026-10', '2026-11']);
    assert.deepEqual(payment.months, ['2026-11'], 'octobre décoché, novembre coché');

    await createPaymentOps(ctx()).addPayment('s1', payment);
    assert.deepEqual(sentPaymentRow().months, ['2026-11']);

    const texts = await printedTexts(mapPaymentRow(rowFromBase(sentPaymentRow())));
    assert.ok(texts.includes('Novembre'), `le mois choisi est écrit (imprimé : ${texts.join(' | ')})`);
    assert.ok(!texts.some((s) => s.includes('1 mois')), 'un seul mois ne se compte pas');
    assert.ok(!texts.includes('Octobre'), 'et le mois de la date ne s’y ajoute pas');
  });

  it('un paiement SANS mois (ligne d’avant la colonne) écrit `[]` et le reçu retombe sur sa date', async () => {
    calls = [];
    // Ce chemin n'est plus atteignable au guichet (le formulaire exige un mois),
    // mais il l'est par l'API, l'import Excel et le rejeu d'un geste ancien : la
    // colonne est NOT NULL, donc c'est `[]` — jamais `null`, qui ferait échouer
    // l'insertion et perdrait le paiement.
    const legacy: Payment = { id: 'pay-legacy', date: '2026-10-04', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-OLD' };
    assert.equal(await createPaymentOps(ctx()).addPayment('s1', legacy), true);
    assert.deepEqual(sentPaymentRow().months, [], 'la colonne reçoit un tableau vide, pas `null`');

    const readBack = mapPaymentRow(rowFromBase(sentPaymentRow()));
    assert.equal(readBack.months, undefined, 'une liste vide vaut « non renseigné »');

    const texts = await printedTexts(readBack);
    assert.ok(texts.includes('Octobre'), `le reçu retombe sur le mois de sa date (imprimé : ${texts.join(' | ')})`);
  });

  it('un reçu MUET corrigé par la fonction bornée : la réimpression dit enfin ses mois', async () => {
    calls = [];
    // Le reçu d'avant la colonne : sa couverture est INCONNUE, donc sa
    // réimpression ne nomme que le mois de sa date.
    const mute: Payment = { id: 'pay-muet', date: '2026-10-04', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-MUET' };
    const before = await printedTexts(mute);
    assert.ok(before.includes('Octobre'), 'avant le geste, le papier retombe sur le mois de sa date');

    // Le geste du guichet : l'école renseigne les mois réellement réglés. Il passe
    // par la FONCTION de la base — jamais par un UPDATE de table — parce qu'une
    // policy borne des lignes, pas des colonnes : c'est ce qui empêche ce même
    // geste d'atteindre le MONTANT du reçu (décision du 2026-10-13).
    assert.equal(
      await createPaymentOps(ctx()).updatePaymentMonths('s1', mute, ['2026-11', '2026-09', '2026-12']),
      true,
    );
    const call = calls.find((c) => c.op === 'rpc');
    assert.ok(call, 'l’écriture part par la fonction, pas par un UPDATE de table');
    assert.equal(call.table, 'set_payment_months');
    assert.deepEqual(call.payload, { p_payment_id: 'pay-muet', p_months: ['2026-09', '2026-11', '2026-12'] });
    assert.equal(
      calls.filter((c) => c.op === 'update').length,
      0,
      'aucun UPDATE de table : le montant n’est pas atteignable par ce chemin',
    );

    // Ce que la base stocke (l'application a déjà trié), puis ce que le PAPIER en dit.
    const readBack = mapPaymentRow(rowFromBase({
      id: 'pay-muet', student_id: 's1', date: '2026-10-04', amount: 25000,
      academic_year: '2026-2027', receipt_number: 'REC-MUET',
      months: ['2026-09', '2026-11', '2026-12'],
    }));
    const expected = formatPaidMonths(readBack.months!, words());
    assert.equal(expected, '3 mois : Septembre, Novembre, Décembre');
    const after = await printedTexts(readBack);
    assert.ok(after.includes(expected), `le PAPIER porte « ${expected} » — imprimé : ${after.join(' | ')}`);
    assert.ok(!after.includes('Octobre'), 'et le mois de la date ne se substitue plus aux mois réglés');
  });

  it('PREUVE PAR MUTATION : une relecture qui perd les mois ferait rougir ce fichier', async () => {
    calls = [];
    const payment = await tickAndSubmit('2026-10-04', ['2026-10', '2026-09', '2026-12']);
    await createPaymentOps(ctx()).addPayment('s1', payment);
    const row = rowFromBase(sentPaymentRow());
    const expected = formatPaidMonths(['2026-09', '2026-12'], words());

    assert.ok((await printedTexts(mapPaymentRow(row))).includes(expected), 'le reçu porte bien les deux mois cochés');

    // On ne touche PAS au dépôt : on retire les mois de la LIGNE, comme le ferait
    // une relecture qui les oublie. Le reçu doit alors changer — et c'est ce
    // changement que les cas ci-dessus exigent de ne jamais voir arriver.
    const lost = await printedTexts(mapPaymentRow({ ...row, months: [] }));
    assert.ok(!lost.includes(expected), 'sans la colonne relue, la ligne des mois n’est plus celle du guichet');
    assert.ok(lost.includes('Octobre'), 'elle retombe sur le mois de la date — exactement le reçu faux à empêcher');
  });
});
