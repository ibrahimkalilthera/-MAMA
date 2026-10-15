/**
 * L'historique des paiements, mesuré SUR LA VUE — pas sur son intention.
 *
 * Trois choses s'y prouvent, et chacune répond à une phrase de la demande :
 *   • « par qui » — le nom de l'utilisateur CONNECTÉ sort du journal, colonne
 *     ENCAISSÉ PAR ;
 *   • « quel montant » — un montant chiffré quand le geste porte son instantané ;
 *   • et l'honnêteté du reste : un geste d'avant la colonne n'a pas de montant
 *     chiffré, sa ligne le DIT et le résumé compte ces lignes au lieu de laisser
 *     croire à un total complet.
 *
 * La garde de rôle est mesurée elle aussi : le journal (`audit_logs`) n'est
 * lisible que par `admin`/`dev`, donc un autre rôle ne doit pas voir un écran
 * vide qui se lirait « l'école n'a rien encaissé ».
 *
 * Depuis la correction des paies fautives, un QUATRIÈME sujet s'y mesure : les
 * GESTES DE CORRECTION (un salaire retiré, une dépense retirée, un salaire
 * rétabli). Ils vivent dans leur propre bloc — ce ne sont pas des encaissements —
 * et les cas ci-dessous verrouillent trois choses qui se paieraient en silence :
 * le montant retiré reste CHIFFRÉ et signé, le geste reste attribué à son auteur,
 * et « rétablir » n'est offert QUE tant que la suppression est réversible.
 *
 * ─── Ce que ce harnais ne sait PAS faire, et qui est donc mesuré ailleurs ─────
 * Une saisie au clavier ne peut pas être simulée ici : sous React 19 + happy-dom
 * 20, un `input` fabriqué puis dispatché sur un champ contrôlé n'atteint jamais
 * `onChange` (mesuré : les quatre variantes — accesseur du prototype, événement
 * du nœud ou global, `input` ou `change` — laissent l'état intact, alors qu'un
 * `<select>` réagit, lui, au même événement). Le champ de recherche est donc
 * mesuré pour son CÂBLAGE (présent, nommé, traduit), et la RECHERCHE elle-même
 * l'est dans `tests/payment-history.test.ts`, sur le module pur.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { PaymentHistoryView } from '../src/components/PaymentHistoryView';
import { translations } from '../src/i18n/translations';
import { DEFAULT_PAYMENT_MOTIF, paymentMotifLabel } from '../src/lib/paymentMotifs';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import { archivedSalaryFrom, salarySnapshotMetadata } from '../src/lib/salaryUndo';
import type { ArchivedSalaryPayment } from '../src/lib/salaryUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, SalaryPayment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { declaredDefaults, makeProps } from './views-harness';

const t = translations.fr;

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

// Le reçu de la fixture est un DROIT D'INSCRIPTION : le cas du motif se lit donc
// sur une ligne qui dit autre chose que le geste ordinaire, à côté de
// l'encaissement d'avant la colonne — qui doit, lui, dire « Frais de scolarité »
// comme le papier qu'il a produit.
const PAY: Payment = { id: 'pay1', date: '2026-10-02', amount: 4000, academicYear: '2026-2027', receiptNumber: 'REC-568556', motif: 'inscription' };
/** Le geste d'avant l'instantané, tel qu'il vit encore dans `payments`. */
const PAY_LEGACY: Payment = { id: 'pay0', date: '2026-09-20', amount: 6000, academicYear: '2026-2027', receiptNumber: 'REC-0' };
/**
 * L'annuaire tel qu'il est APRÈS l'annulation : `pay1` n'est plus dans `payments`.
 *
 * C'est l'état de la production, et il décide de tout : la ligne d'annulation n'a
 * donc plus de paiement vivant (donc pas de reçu à montrer), tandis que
 * l'encaissement d'avant l'instantané, lui, se retrouve par son numéro de reçu.
 */
const aliceAfterCancellation: Student = { ...alice, payments: [PAY_LEGACY] };

const logs: AuditLogEntry[] = [
  {
    id: 'p1',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: '2026-10-02T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
  {
    // Le geste d'AVANT l'instantané structuré : montant seulement dans la phrase.
    id: 'p2',
    action: 'RECORD_PAYMENT',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    createdAt: '2026-09-20T09:00:00Z',
    details: 'Paiement de 6000 FCFA (reçu REC-0)',
  },
  {
    id: 'c1',
    action: 'DELETE_PAYMENT',
    targetId: 'pay1',
    userName: 'Moussa Keïta',
    createdAt: '2026-10-05T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556) du 2026-10-02 supprimé — élève Alice Traoré',
    // Une suppression porte son instantané (c'est ce qui la rend annulable) :
    // l'élève et le montant s'y relisent, malgré un `target_id` qui EST le
    // paiement — le seul geste dont `target_id` est l'élève est l'encaissement.
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
  // Un geste qui n'est PAS un paiement : il ne doit jamais apparaître ici.
  { id: 'x1', action: 'ADD_STUDENT', userName: 'Admin', createdAt: '2026-10-06T09:00:00Z', details: 'Fatou BOLLY' },
];

// ─── Les GESTES DE CORRECTION ────────────────────────────────────────────────
// Une paie saisie pour le mauvais membre se corrige en la RETIRANT — et c'est la
// seule trace du montant qui a disparu. Ces entrées-là ne sont donc pas des
// encaissements : elles vivent dans leur propre bloc, et le net de la caisse ne
// les voit pas (c'est mesuré plus bas).

const SALARY: SalaryPayment = { id: 'sp1', staffId: 't1', date: '2026-10-03', amount: 175000, academicYear: '2026-2027' };

/**
 * Le retrait tel que le journal l'écrit : avec son INSTANTANÉ — c'est lui qui
 * rend le geste réversible (`restorableSalary` le relit pour offrir « Rétablir »).
 */
const salaryDeleted: AuditLogEntry = {
  id: 'sp-del',
  action: 'DELETE_SALARY_PAYMENT',
  targetType: 'salary_payment',
  targetId: SALARY.id,
  userName: 'Salif Dembélé',
  userEmail: 'salif@mama.test',
  userRole: 'admin',
  createdAt: '2026-10-07T09:00:00Z',
  details: 'Salaire de 175000 FCFA (2026-10-03) supprimé — membre Awa Cissé',
  metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', 'Awa Cissé', SALARY)),
};

/** Le même retrait SANS instantané : le geste d'avant la colonne. */
const salaryDeletedLegacy: AuditLogEntry = {
  ...salaryDeleted,
  id: 'sp-del-old',
  createdAt: '2026-10-04T09:00:00Z',
  metadata: null,
};

/** Le rétablissement qui suit : ses deux gestes se lisent, et l'offre disparaît. */
const salaryRestored: AuditLogEntry = {
  id: 'sp-back',
  action: 'RESTORE_SALARY_PAYMENT',
  targetType: 'salary_payment',
  targetId: SALARY.id,
  userName: 'Salif Dembélé',
  createdAt: '2026-10-08T09:00:00Z',
  details: 'Salaire de 175000 FCFA (2026-10-03) rétabli — membre Awa Cissé',
  metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', 'Awa Cissé', SALARY)),
};

function mount(overrides: Parameters<typeof makeProps>[0] = {}) {
  const win = installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(
      createElement(
        MainViewsContext.Provider,
        { value: makeProps({ auditLogs: logs, students: [alice], t, lang: 'fr', ...overrides }) },
        createElement(PaymentHistoryView),
      ),
    );
  });
  /**
   * Le tableau des GESTES DE CORRECTION — désigné par sa colonne « Membre / sujet »,
   * la seule qui la porte : les autres tableaux de l'écran (reçus, rapport de
   * caisse) ne l'ont pas. Le bloc est donc repéré par ce qu'il EST, jamais par sa
   * position dans la page.
   */
  const correctionsTable = () => [...container.querySelectorAll('table')]
    .find((table) => (table.querySelector('thead')?.textContent ?? '').includes(t.paymentHistorySubject)) ?? null;
  return {
    container,
    text: () => container.textContent ?? '',
    correctionsTable,
    corrections: () => correctionsTable()?.querySelector('tbody')?.textContent ?? '',
    correctionsRows: () => [...(correctionsTable()?.querySelectorAll('tbody tr') ?? [])] as HTMLTableRowElement[],
    /** Le corps du tableau SEUL : les menus de filtre contiennent aussi des libellés de gestes. */
    body: () => container.querySelector('tbody')?.textContent ?? '',
    select: () => container.querySelector<HTMLSelectElement>(`select[aria-label="${t.auditFilterAction}"]`),
    search: () => container.querySelector<HTMLInputElement>(`input[aria-label="${t.paymentHistorySearch}"]`),
    change: (el: HTMLSelectElement, value: string) => act(() => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('PaymentHistoryView — ce que la caisse relit', () => {
  it('montre l’élève, le montant chiffré et l’UTILISATEUR CONNECTÉ qui a encaissé', () => {
    const h = mount();
    try {
      const text = h.text();
      assert.match(text, /Alice Traoré/, 'l’élève est nommé');
      assert.match(text, /6B/, 'sa classe est lisible');
      assert.match(text, /4000 XOF/, 'le montant vient de l’instantané, pas de la phrase');
      assert.match(text, /REC-568556/, 'le reçu est lisible');
      assert.match(text, /Aggee Diarra/, 'l’encaisseur est nommé');
      assert.match(text, /aggee@mama.test/, 'et son compte est nommé');
      assert.match(text, /econome/, 'son rôle aussi');
      assert.match(h.body(), new RegExp(t.auditActionRecordPayment), 'le geste est libellé, pas le code');
      assert.match(h.body(), new RegExp(t.auditActionDeletePayment), 'l’annulation aussi');
      assert.doesNotMatch(text, /RECORD_PAYMENT|DELETE_PAYMENT/, 'aucun code brut à l’écran');
      assert.doesNotMatch(text, /Fatou BOLLY/, 'un geste qui n’est pas un paiement n’entre pas dans cet historique');
    } finally {
      h.cleanup();
    }
  });

  it('AFFICHE le montant d’un geste d’avant l’instantané, relu dans la phrase du journal', () => {
    // La réparation du 2026-10-06 : les 3 seuls gestes de paiement de la PRODUCTION
    // n'ont pas d'instantané, et la colonne MONTANT disait « voir le détail »
    // partout, pour des encaissements bien réels.
    const h = mount();
    try {
      const text = h.text();
      assert.doesNotMatch(text, new RegExp(t.paymentHistoryAmountInDetails), 'aucune ligne ne renvoie au détail');
      assert.match(h.body(), /6000 XOF/, 'le montant de la ligne sans instantané est affiché');
      assert.match(h.body(), /REC-0/, 'et son reçu se relit de la même phrase');
      assert.equal(
        text.includes(t.paymentHistoryWithoutAmount.replace('{count}', '1')),
        false,
        'plus aucune ligne n’est laissée de côté : l’avertissement n’a plus rien à dire',
      );
      // Le net porte donc sur les TROIS gestes : 4000 + 6000 encaissés − 4000 annulé.
      // (Comparé par `includes` : la phrase contient des parenthèses littérales,
      // qui seraient interprétées comme un groupe si elle passait par un RegExp.)
      assert.ok(
        text.includes(t.paymentHistoryTotals
          .replace('{count}', '3')
          .replace('{collected}', '10000 XOF')
          .replace('{cancelled}', '4000 XOF')
          .replace('{net}', '6000 XOF')),
        'le total compte les trois gestes, montant d’instantané ou de phrase',
      );
    } finally {
      h.cleanup();
    }
  });

  it('filtre par geste, et le résumé suit ce qui est affiché', () => {
    const h = mount();
    try {
      h.change(h.select()!, 'DELETE_PAYMENT');
      const cancelled = h.body();
      assert.match(cancelled, new RegExp(t.auditActionDeletePayment));
      assert.doesNotMatch(cancelled, new RegExp(t.auditActionRecordPayment), 'les encaissements sont filtrés');
      assert.match(cancelled, /Moussa Keïta/, 'l’auteur de l’annulation reste lisible');

      h.change(h.select()!, 'all');
      assert.match(h.body(), new RegExp(t.auditActionRecordPayment), 'revenir à « toutes les actions » rend les encaissements');
    } finally {
      h.cleanup();
    }
  });

  it('affiche le MOTIF de chaque reçu — les mots du papier, jamais une seconde formulation', () => {
    const h = mount();
    try {
      const header = h.container.querySelector('thead')?.textContent ?? '';
      assert.match(header, new RegExp(t.paymentMotif), 'la colonne MOTIF est annoncée');

      const body = h.body();
      assert.match(
        body,
        new RegExp(paymentMotifLabel('inscription', t)),
        'le reçu d’inscription dit son motif — le mot imprimé sur le papier remis',
      );
      assert.match(
        body,
        new RegExp(paymentMotifLabel(DEFAULT_PAYMENT_MOTIF, t)),
        'un reçu d’avant la colonne porte le motif que son papier portait alors',
      );
    } finally {
      h.cleanup();
    }
  });

  it('le champ de recherche est câblé au filtre (la saisie elle-même se mesure sur le module pur)', () => {
    const h = mount();
    try {
      const search = h.search();
      assert.ok(search, 'le champ de recherche est rendu');
      assert.equal(search.getAttribute('placeholder'), t.paymentHistorySearch, 'et il dit ce qu’il cherche');
      assert.equal(search.getAttribute('type'), 'search');
    } finally {
      h.cleanup();
    }
  });

  it('ne rend rien pour un rôle qui ne peut pas lire le journal', () => {
    const h = mount({ auth: { ...declaredDefaults.auth!, isAdmin: false } });
    try {
      assert.equal(h.text(), '', 'la policy RLS réserve audit_logs à admin/dev : pas d’écran vide qui se lirait « rien encaissé »');
      assert.equal(h.container.querySelectorAll('table').length, 0, 'aucun tableau n’est rendu');
    } finally {
      h.cleanup();
    }
  });

  it('l’export CSV emporte la vue FILTRÉE — mêmes lignes que celles affichées', async () => {
    // Les octets qui SORTENT de l'app sont captés : le clic du lien est neutralisé
    // (on ne mesure pas la navigation) et l'URL d'objet est espionnée.
    const blobs: Blob[] = [];
    const url = globalThis.URL as unknown as Record<string, unknown>;
    const realCreate = url.createObjectURL;
    const realRevoke = url.revokeObjectURL;
    url.createObjectURL = (blob: Blob) => { blobs.push(blob); return 'blob:probe'; };
    url.revokeObjectURL = () => {};
    const h = mount();
    const anchorProto = document.createElement('a').constructor.prototype as { click: () => void };
    const realClick = anchorProto.click;
    anchorProto.click = () => {};
    try {
      const buttons = [...h.container.querySelectorAll('button')] as HTMLButtonElement[];
      const csvButton = buttons.find((b) => (b.textContent ?? '').includes(t.exportCsv));
      assert.ok(csvButton, 'le bouton d’export CSV est rendu');
      assert.equal(csvButton.disabled, false, 'avec des lignes affichées, l’export est offert');

      await act(async () => { csvButton.click(); });
      assert.equal(blobs.length, 1, 'un export, un fichier');
      // Le BOM se mesure sur les OCTETS : `Blob.text()` le retire (décodage UTF-8),
      // donc un cas qui ne lirait que le texte ne pourrait pas le voir disparaître.
      const bytes = new Uint8Array(await blobs[0].arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'le BOM du tableur ouvre le fichier');
      const complete = new TextDecoder().decode(bytes.slice(3));
      assert.equal(complete.split('\r\n').length, 4, 'en-tête + les trois gestes de l’historique');

      // Le geste que l'écran filtre : l'annulation seulement. L'export doit suivre
      // l'écran, jamais repartir de l'historique complet pour se refiltrer seul.
      h.change(h.select()!, 'DELETE_PAYMENT');
      await act(async () => { csvButton.click(); });
      const filtered = new TextDecoder().decode(new Uint8Array(await blobs[1].arrayBuffer()).slice(3));
      assert.equal(filtered.split('\r\n').length, 2, 'en-tête + la seule annulation affichée');
      assert.match(filtered, /Moussa Keïta/, 'la ligne montrée est celle exportée');
      assert.doesNotMatch(filtered, /Aggee Diarra/, 'une ligne filtrée hors de l’écran ne part pas dans le fichier');
      assert.match(filtered, new RegExp(t.auditActionDeletePayment), 'le geste est libellé comme la colonne ACTIONS');
    } finally {
      anchorProto.click = realClick;
      url.createObjectURL = realCreate;
      url.revokeObjectURL = realRevoke;
      h.cleanup();
    }
  });

  it('le CLIC sur une ligne MONTRE le reçu du paiement — et ne le télécharge pas', async () => {
    const calls: Array<{ studentId: string; payment: Payment; cashierName?: string }> = [];
    const h = mount({
      students: [aliceAfterCancellation],
      generatePaymentReceiptPdf: async (opts) => {
        calls.push({ studentId: opts.student.id, payment: opts.payment, cashierName: opts.cashierName });
      },
    });
    try {
      const rowOf = (needle: string) => ([...h.container.querySelectorAll('tbody tr')] as HTMLTableRowElement[])
        .find((row) => (row.textContent ?? '').includes(needle));
      // La ligne de l'encaissement SANS instantané : son reçu ne se retrouve que par
      // le numéro écrit dans le journal — exactement le cas de la production.
      const legacy = rowOf('REC-0');
      assert.ok(legacy, 'la ligne de l’encaissement sans instantané est rendue');
      await act(async () => { legacy.click(); });
      assert.equal(calls.length, 1, 'un clic sur la ligne, un reçu');
      assert.equal(calls[0]!.payment.receiptNumber, 'REC-0', 'le reçu montré est celui de la ligne');
      assert.equal(calls[0]!.studentId, alice.id, 'et l’élève est celui de la ligne');
      assert.equal(calls[0]!.cashierName, 'Aggee Diarra', 'le caissier imprimé est celui du GESTE, pas de la session ouverte');

      // L'encaissement dont l'instantané nomme `pay1`, un paiement qui n'est PLUS
      // dans `payments` : il n'a plus de reçu, et cliquer ne doit rien promettre.
      const gone = rowOf(t.auditActionRecordPayment) !== undefined;
      assert.equal(gone, true, 'l’encaissement reste listé (le journal ne se réécrit pas)');
      const cancelled = rowOf(t.auditActionDeletePayment);
      assert.ok(cancelled, 'la ligne d’annulation est rendue');
      await act(async () => { cancelled.click(); });
      assert.equal(calls.length, 1, 'un paiement annulé n’a plus de reçu à montrer');
    } finally {
      h.cleanup();
    }
  });

  it('supprime LE PAIEMENT de la ligne, après confirmation — pas l’entrée du journal', async () => {
    const deleted: Array<{ studentId: string; paymentId?: string; receiptNumber?: string }> = [];
    const h = mount({
      students: [aliceAfterCancellation],
      canDeletePayment: true,
      deletePayment: async (studentId, payment) => {
        deleted.push({ studentId, paymentId: payment.id, receiptNumber: payment.receiptNumber });
        return true;
      },
    });
    try {
      const rowOf = (needle: string) => ([...h.container.querySelectorAll('tbody tr')] as HTMLTableRowElement[])
        .find((row) => (row.textContent ?? '').includes(needle))!;
      const buttons = (row: HTMLTableRowElement) => [...row.querySelectorAll('button')] as HTMLButtonElement[];

      const remove = buttons(rowOf('REC-0')).find((b) => (b.textContent ?? '').includes(t.deletePayment));
      assert.ok(remove, 'l’option « supprimer » est offerte DANS la ligne');
      await act(async () => { remove.click(); });

      // La confirmation dit ce qui part, montant ET reçu, avant de partir.
      const confirmText = rowOf('REC-0').textContent ?? '';
      assert.ok(confirmText.includes('6000 XOF') && confirmText.includes('REC-0'), 'la confirmation nomme le montant et le reçu');
      assert.equal(deleted.length, 0, 'rien ne part avant la confirmation');

      const confirm = buttons(rowOf('REC-0')).filter((b) => (b.textContent ?? '').trim() === t.deletePayment).pop();
      assert.ok(confirm, 'le bouton de confirmation est rendu');
      await act(async () => { confirm.click(); });

      assert.equal(deleted.length, 1, 'un geste, une suppression');
      assert.equal(deleted[0]!.studentId, alice.id, 'la suppression vise l’ÉLÈVE de la ligne');
      assert.equal(deleted[0]!.paymentId, PAY_LEGACY.id, 'et le PAIEMENT de la ligne — pas l’entrée du journal');
      assert.equal(deleted[0]!.receiptNumber, 'REC-0');
    } finally {
      h.cleanup();
    }
  });

  it('masque la suppression quand la base ne l’accorde pas au rôle', () => {
    const h = mount({ students: [aliceAfterCancellation], canDeletePayment: false });
    try {
      const row = [...h.container.querySelectorAll('tbody tr')]
        .find((r) => (r.textContent ?? '').includes('REC-0'))!;
      assert.equal(
        [...row.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(t.deletePayment)),
        false,
        '« Payment deleters delete payments » : sans le droit, pas de bouton',
      );
    } finally {
      h.cleanup();
    }
  });

  it('n’offre les deux exports que lorsqu’il y a des lignes à emporter', () => {
    const h = mount({ auditLogs: [] });
    try {
      const buttons = [...h.container.querySelectorAll('button')] as HTMLButtonElement[];
      const csvButton = buttons.find((b) => (b.textContent ?? '').includes(t.exportCsv));
      const pdfButton = buttons.find((b) => (b.textContent ?? '').includes(t.exportPdf));
      assert.ok(csvButton && pdfButton, 'les deux exports sont proposés');
      assert.equal(csvButton.disabled, true, 'rien à emporter : le bouton le dit au lieu de produire un fichier vide');
      assert.equal(pdfButton.disabled, true, 'idem pour le PDF');
    } finally {
      h.cleanup();
    }
  });
});

// ─── Les gestes de correction ────────────────────────────────────────────────
// Le bloc se prouve sur ses CELLULES, pas sur la page entière : les phrases du
// journal contiennent les mêmes mots que les colonnes, donc un cas qui lirait
// `textContent` sans choisir sa cellule pourrait être vert pour la mauvaise
// raison (le montant lu dans la phrase au lieu de la colonne MONTANT).

describe('PaymentHistoryView — les gestes de correction', () => {
  /** Les cellules d'une ligne, dans l'ordre des colonnes du bloc. */
  const cellsOf = (row: HTMLTableRowElement) => [...row.querySelectorAll('td')];
  const rowWith = (rows: HTMLTableRowElement[], label: string) =>
    rows.find((row) => (row.textContent ?? '').includes(label));
  const restoreButtons = (table: HTMLElement | null) =>
    [...(table?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

  it('trace un salaire RETIRÉ : membre, montant chiffré et signé, auteur du geste', () => {
    const h = mount({ auditLogs: [...logs, salaryDeleted] });
    try {
      const table = h.correctionsTable();
      assert.ok(table, 'le bloc des corrections est rendu');
      const row = rowWith(h.correctionsRows(), t.auditActionDeleteSalaryPayment);
      assert.ok(row, 'le retrait y est listé sous son libellé');
      const cells = cellsOf(row!);
      assert.equal(cells[2]!.textContent, 'Awa Cissé', 'la colonne Membre / sujet nomme qui a perdu la paie');
      // Le signe moins est celui de l'écran (U+2212) : un montant retiré est une
      // SORTIE, et sa colonne le dit au lieu d'un chiffre nu qui aurait l'air d'un
      // encaissement.
      assert.equal(cells[3]!.textContent, '\u2212 175000 XOF', 'le montant retiré est chiffré et signé');
      assert.match(cells[4]!.textContent ?? '', /Salif Dembélé/, 'l’auteur du geste est nommé');
      assert.match(cells[4]!.textContent ?? '', /salif@mama.test/, 'et son compte aussi');
      assert.match(cells[5]!.textContent ?? '', /175000 FCFA/, 'le détail reste la phrase du journal');
      assert.equal(h.text().includes(t.paymentHistoryCorrectionsNote.replace('{count}', '1')), true, 'le bloc dit combien de corrections il montre');

      // Ce n'est PAS un encaissement : la ligne n'entre pas dans le tableau des
      // reçus, qui garde ses trois gestes de caisse.
      assert.doesNotMatch(h.body(), /Awa Cissé/, 'une correction n’est pas une ligne d’encaissement');
      assert.doesNotMatch(h.body(), new RegExp(t.auditActionDeleteSalaryPayment));
      // Et le net affiché reste celui de la CAISSE : un salaire retiré n'a jamais
      // été encaissé, donc il ne peut pas en sortir.
      assert.equal(
        h.text().includes(t.paymentHistoryTotals
          .replace('{count}', '3')
          .replace('{collected}', '10000 XOF')
          .replace('{cancelled}', '4000 XOF')
          .replace('{net}', '6000 XOF')),
        true,
        'le net encaissé ne bouge pas : une correction vit hors de lui',
      );
    } finally {
      h.cleanup();
    }
  });

  it('ne devine pas un montant pour une correction d’avant l’instantané', () => {
    const h = mount({ auditLogs: [...logs, salaryDeletedLegacy] });
    try {
      const row = rowWith(h.correctionsRows(), t.auditActionDeleteSalaryPayment);
      assert.ok(row, 'le geste d’avant la colonne reste lisible');
      const cells = cellsOf(row!);
      assert.equal(cells[2]!.textContent, '—', 'aucun membre inventé : le sujet se lit d’un tiret');
      // La colonne le DIT (« voir le détail ») au lieu d'afficher un zéro, qui
      // aurait l'air d'un montant — et le montant de ce geste n'existe que dans sa
      // phrase, où il ne s'additionne pas.
      assert.equal(cells[3]!.textContent, t.paymentHistoryAmountInDetails, 'aucun montant inventé');
      // Et pas de rétablissement : on ne réinsère pas la ligne qu'on n'a pas gardée.
      assert.equal(restoreButtons(h.correctionsTable()).length, 0, 'rien à rétablir sans instantané');
    } finally {
      h.cleanup();
    }
  });

  it('offre « rétablir » sur la seule suppression encore réversible, et l’appelle', async () => {
    const calls: ArchivedSalaryPayment[] = [];
    // Le succès relit le JOURNAL : c'est la seule façon de voir apparaître l'entrée
    // `RESTORE_SALARY_PAYMENT` qui retire l'offre. Un rétablissement qui ne
    // relirait rien laisserait le bouton en place après un succès.
    const refreshes: number[] = [];
    const h = mount({
      auditLogs: [...logs, salaryDeleted],
      restoreSalaryPayment: async (archived) => { calls.push(archived); return true; },
      fetchAuditLogs: async () => { refreshes.push(1); },
    });
    try {
      const button = restoreButtons(h.correctionsTable()).find((b) => (b.textContent ?? '').includes(t.restoreSalaryPayment));
      assert.ok(button, 'la suppression est réversible : l’offre est là');
      assert.equal(button.title, t.restoreSalaryPaymentHint, 'et elle dit ce qu’elle réinsère');

      await act(async () => { button.click(); });
      assert.equal(calls.length, 1, 'un clic, une restauration');
      // C'est la LIGNE de salaire qui revient, à l'identique : son id, son membre,
      // son montant, sa date — c'est tout ce que l'instantané a gardé.
      assert.equal(calls[0]!.salaryPaymentId, SALARY.id);
      assert.equal(calls[0]!.staffId, SALARY.staffId);
      assert.equal(calls[0]!.amount, SALARY.amount);
      assert.equal(calls[0]!.date, SALARY.date);
      assert.equal(refreshes.length, 1, 'et le succès relit le journal');
    } finally {
      h.cleanup();
    }
  });

  it('ne laisse plus rétablir une suppression DÉJÀ rétablie, et garde les deux gestes lisibles', () => {
    const h = mount({ auditLogs: [...logs, salaryDeleted, salaryRestored] });
    try {
      const rows = h.correctionsRows();
      const restored = rowWith(rows, t.auditActionRestoreSalaryPayment);
      assert.ok(restored, 'le rétablissement est listé');
      assert.ok(rowWith(rows, t.auditActionDeleteSalaryPayment), 'et la suppression qu’il répare reste lisible : le journal ne se réécrit pas');
      // Un rétablissement REND le montant : sa colonne est positive, sans le signe
      // de sortie du retrait.
      assert.equal(cellsOf(restored!)[3]!.textContent, '175000 XOF');
      assert.equal(
        restoreButtons(h.correctionsTable()).length,
        0,
        'une seconde restauration écraserait un geste réel : l’offre se retire',
      );
    } finally {
      h.cleanup();
    }
  });

  it('dit qu’il n’y a AUCUNE correction quand rien n’a été retiré du registre', () => {
    const h = mount();
    try {
      assert.match(h.text(), new RegExp(t.paymentHistoryCorrections), 'le bloc est annoncé');
      assert.equal(h.text().includes(t.paymentHistoryCorrectionsNote.replace('{count}', '0')), true, 'et il compte zéro geste');
      assert.equal(h.text().includes(t.paymentHistoryCorrectionsEmpty), true, 'la phrase d’absence est rendue');
      assert.equal(h.correctionsTable(), null, 'aucun tableau vide n’est rendu à la place');
    } finally {
      h.cleanup();
    }
  });
});
