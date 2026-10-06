// Suite for `src/lib/studentMerge.ts` — trancher entre deux fiches homonymes,
// sans base et sans écran.
//
// Ce qui se joue ici n'est pas la mise en forme d'un écran : c'est ce qu'une
// fusion FAIT des données d'un élève. Trois choses peuvent mal tourner en
// silence, et chacune coûte de l'argent ou une information :
//
//   • un reçu compté DEUX fois (il figure sur les deux fiches — c'est même la
//     forme typique d'une double inscription) gonfle le montant payé d'une
//     famille et fausse le solde que l'école réclame ;
//   • un versement ENREGISTRÉ mais sans ligne de reçu, effacé par un recalcul
//     « propre » depuis les lignes : la fiche est ce que l'école a validé, elle
//     est la source du montant payé ;
//   • une note perdue avec la fiche retirée — personne n'a décidé de la perdre.
//
// Et le dernier cas est celui qui a motivé tout l'outil : deux fiches portant le
// MÊME nom doivent produire deux phrases de journal DIFFÉRENTES. Un journal qui
// écrit « Safiatou COULIBALY » deux fois ne dit pas laquelle est partie.
//
// Les fixtures sont le cas réel mesuré le 2026-10-06 sur la base partagée : deux
// « Safiatou COULIBALY » en 5A, `MT-2026-252` (parent « Tuteur », 76313228) et
// `MT-2026-415` (parent « Fanta BAH », 71121470), 36000 de total dû chacune.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Payment, Student } from '../src/lib/domainTypes';
import {
  STUDENT_MERGE_KIND,
  STUDENT_SNAPSHOT_KIND,
  deleteAuditDetails,
  mergeAuditDetails,
  mergeSnapshotMetadata,
  mergedLedger,
  mergedNotes,
  studentLabel,
  studentSnapshot,
  studentSnapshotMetadata,
} from '../src/lib/studentMerge';

// ─── Une fiche du registre, telle que le domaine la porte ────────────────────
// Les montants sont des NOMBRES (le type du domaine), les dates des chaînes
// `YYYY-MM-DD` : le test garde les types réels, sinon il validerait une forme
// que l'application ne produit jamais.
function student(over: Partial<Student> & { id: string; name: string }): Student {
  return {
    parentName: 'Tuteur',
    parentEmail: '',
    parentPhone: '76313228',
    totalDue: 36000,
    amountPaid: 0,
    dueDate: '2026-12-31',
    payments: [],
    notes: '',
    grade: '5A',
    ...over,
  };
}

const payment = (over: Partial<Payment> & { date: string; amount: number }): Payment => ({ ...over });

/** MT-2026-252 — la fiche du 24/09, « Tuteur ». */
const safiatou252 = student({
  id: 'd9cac5c6-5eec-4527-867b-b7856d3de339',
  name: 'Safiatou COULIBALY',
  studentId: 'MT-2026-252',
  enrollmentDate: '2026-09-24',
  academicYear: '2026-2027',
  status: 'Active',
});

/** MT-2026-415 — la fiche du 05/10, « Fanta BAH ». */
const safiatou415 = student({
  id: 'de38b4eb-2265-4d33-814d-83683edd53e4',
  name: 'Safiatou COULIBALY',
  studentId: 'MT-2026-415',
  parentName: 'Fanta BAH',
  parentPhone: '71121470',
  enrollmentDate: '2026-10-05',
  academicYear: '2026-2027',
  status: 'Active',
});

// ─── 1. L'instantané d'une fiche ─────────────────────────────────────────────
describe('l’instantané d’une fiche', () => {
  it('porte les champs qui DISCRIMINENT deux homonymes, pas seulement le nom', () => {
    const withReceipt = { ...safiatou415, amountPaid: 10000, payments: [payment({ id: 'p1', date: '2026-10-05', amount: 10000 })], notes: 'Mère passée' };
    const snap = studentSnapshot(withReceipt);

    assert.equal(snap.matricule, 'MT-2026-415');
    assert.equal(snap.grade, '5A');
    assert.equal(snap.parent_name, 'Fanta BAH');
    assert.equal(snap.parent_phone, '71121470');
    assert.equal(snap.total_due, 36000);
    assert.equal(snap.amount_paid, 10000);
    assert.equal(snap.receipts, 1, 'un COMPTE de reçus, pas les lignes : l’instantané reste court');
    assert.equal(snap.status, 'Active');
    assert.equal(snap.academic_year, '2026-2027');
    assert.equal(snap.enrollment_date, '2026-10-05');
    assert.equal(snap.notes, 'Mère passée');
  });

  it('n’invente rien pour une fiche sans classe ni matricule', () => {
    // Beaucoup de fiches anciennes n'ont ni l'un ni l'autre : un instantané qui
    // écrirait `''` (ou pire, un matricule fabriqué) ferait croire à une valeur
    // que la base ne porte pas.
    const bare = student({ id: 'x1', name: 'Ali Diallo', grade: '', studentId: '   ', parentEmail: '' });
    const snap = studentSnapshot(bare);

    assert.equal(snap.grade, undefined);
    assert.equal(snap.matricule, undefined);
    assert.equal(snap.parent_email, '');
  });

  it('se déclare dans le metadata — un autre instantané n’est pas celui-ci', () => {
    const meta = studentSnapshotMetadata(safiatou252);
    assert.equal(meta.kind, STUDENT_SNAPSHOT_KIND);
    assert.equal(meta.name, 'Safiatou COULIBALY');
    assert.equal(meta.matricule, 'MT-2026-252');
  });
});

// ─── 2. Le libellé qui distingue deux homonymes ──────────────────────────────
describe('le libellé d’une fiche', () => {
  it('ajoute le matricule ET la classe — ce que le nom seul ne dit pas', () => {
    assert.equal(studentLabel(safiatou252), 'Safiatou COULIBALY (MT-2026-252, 5A)');
    assert.equal(studentLabel(safiatou415), 'Safiatou COULIBALY (MT-2026-415, 5A)');
  });

  it('retombe sur le nom seul quand il n’y a ni matricule ni classe', () => {
    assert.equal(studentLabel({ name: 'Ali Diallo', studentId: undefined, grade: '' }), 'Ali Diallo');
  });

  it('n’écrit que le matricule quand la classe manque', () => {
    assert.equal(studentLabel({ name: 'Ali Diallo', studentId: 'MT-2026-001', grade: '' }), 'Ali Diallo (MT-2026-001)');
  });
});

// ─── 3. Le grand livre consolidé ────────────────────────────────────────────
describe('le grand livre consolidé', () => {
  it('ne compte qu’UNE fois un reçu présent sur les deux fiches', () => {
    // La forme même d'une double inscription : le même versement a été saisi sur
    // les deux fiches. Le compter deux fois doublerait l'argent reçu.
    const survivor = { ...safiatou252, payments: [payment({ id: 'p1', date: '2026-09-10', amount: 5000 })] };
    const removed = { ...safiatou415, payments: [payment({ id: 'p1', date: '2026-09-10', amount: 5000 }), payment({ id: 'p2', date: '2026-09-20', amount: 7000 })] };

    const ledger = mergedLedger(survivor, [removed]);
    assert.deepEqual(ledger.payments.map((p) => p.id), ['p1', 'p2'], 'chaque reçu une seule fois');
  });

  it('additionne les montants ENREGISTRÉS au lieu de les recalculer depuis les reçus', () => {
    // Un import historique peut laisser un montant payé sans ligne de reçu. Un
    // recalcul « propre » effacerait ce versement de la fiche gardée.
    const survivor = { ...safiatou252, amountPaid: 20000, payments: [] };
    const removed = { ...safiatou415, amountPaid: 10000, payments: [] };

    assert.equal(mergedLedger(survivor, [removed]).amountPaid, 30000);
  });

  it('garde la date de paiement la PLUS RÉCENTE, lignes et dates enregistrées confondues', () => {
    const survivor = { ...safiatou252, lastPaymentDate: '2026-10-01', payments: [payment({ id: 'p1', date: '2026-09-10', amount: 5000 })] };
    const removed = { ...safiatou415, lastPaymentDate: '2026-09-24', payments: [payment({ id: 'p2', date: '2026-10-05', amount: 7000 })] };

    assert.equal(mergedLedger(survivor, [removed]).lastPaymentDate, '2026-10-05');
  });

  it('ne recule pas : une date enregistrée sans ligne de reçu compte aussi', () => {
    // La fiche peut porter une date de dernier paiement sans ligne (reprise,
    // import) : reculer cette date ferait disparaître un paiement de l'écran.
    const survivor = { ...safiatou252, lastPaymentDate: '2026-11-02', payments: [] };
    const removed = { ...safiatou415, lastPaymentDate: '2026-09-24', payments: [payment({ id: 'p2', date: '2026-10-05', amount: 7000 })] };

    assert.equal(mergedLedger(survivor, [removed]).lastPaymentDate, '2026-11-02');
  });

  it('ordonne l’historique par date : deux exécutions ne le réordonnent pas', () => {
    const survivor = { ...safiatou252, payments: [payment({ id: 'p-late', date: '2026-10-05', amount: 1 })] };
    const removed = { ...safiatou415, payments: [payment({ id: 'p-early', date: '2026-09-10', amount: 1 })] };

    assert.deepEqual(mergedLedger(survivor, [removed]).payments.map((p) => p.id), ['p-early', 'p-late']);
  });

  it('garde un reçu SANS id — il ne peut pas être dédupliqué, donc il n’est pas écarté', () => {
    const survivor = { ...safiatou252, payments: [payment({ date: '2026-09-10', amount: 5000 })] };
    const ledger = mergedLedger(survivor, [safiatou415]);
    assert.equal(ledger.payments.length, 1);
  });

  it('ne rend jamais un montant payé négatif', () => {
    const survivor = { ...safiatou252, amountPaid: -5000 };
    assert.equal(mergedLedger(survivor, [safiatou415]).amountPaid, 0);
  });

  it('n’a pas de date de dernier paiement quand aucune fiche n’en porte', () => {
    assert.equal(mergedLedger(safiatou252, [safiatou415]).lastPaymentDate, undefined);
  });
});

// ─── 4. Les notes recopiées ─────────────────────────────────────────────────
describe('les notes recopiées sur la fiche gardée', () => {
  it('garde la note de la fiche gardée en tête et date chaque note recopiée', () => {
    const survivor = { ...safiatou252, notes: 'Père est venu' };
    const removed = { ...safiatou415, notes: 'Mère passée payer' };

    assert.equal(
      mergedNotes(survivor, [removed], '2026-10-06'),
      'Père est venu\n\n[fusion 2026-10-06 · MT-2026-415] Mère passée payer',
    );
  });

  it('se rabat sur l’id quand la fiche recopiée n’a pas de matricule', () => {
    const removed = { ...safiatou415, studentId: undefined, notes: 'Note' };
    assert.match(mergedNotes({ ...safiatou252, notes: '' }, [removed], '2026-10-06'), /\[fusion 2026-10-06 · de38b4eb\] Note/);
  });

  it('n’écrit pas de bloc vide : note blanche ou absente n’ajoute rien', () => {
    assert.equal(mergedNotes({ ...safiatou252, notes: '' }, [{ ...safiatou415, notes: '   ' }], '2026-10-06'), '');
    assert.equal(mergedNotes({ ...safiatou252, notes: '  Gardée  ' }, [safiatou415], '2026-10-06'), 'Gardée');
  });
});

// ─── 5. La phrase du journal d'une fusion ───────────────────────────────────
describe('la phrase du journal d’une fusion', () => {
  it('nomme ce qui est retiré, ce qui est gardé, et combien de reçus suivent', () => {
    const details = mergeAuditDetails(safiatou252, [safiatou415], 2);
    assert.ok(details.includes('MT-2026-415'), 'la fiche retirée est nommée par son matricule');
    assert.ok(details.includes('gardée Safiatou COULIBALY (MT-2026-252, 5A)'), 'la fiche gardée est nommée aussi');
    assert.ok(details.includes('2 reçus rattachés'));
  });

  it('accorde le compte au singulier quand un seul reçu suit', () => {
    assert.ok(mergeAuditDetails(safiatou252, [safiatou415], 1).includes('1 reçu rattaché'));
    assert.ok(mergeAuditDetails(safiatou252, [safiatou415], 0).includes('0 reçus rattachés'));
  });
});

// ─── 6. L'instantané d'une fusion ───────────────────────────────────────────
describe('l’instantané d’une fusion', () => {
  it('porte la fiche gardée, chaque fiche retirée et les reçus déplacés', () => {
    const moved = [payment({ id: 'p1', date: '2026-10-05', amount: 7000 }), payment({ date: '2026-10-06', amount: 1 })];
    const meta = mergeSnapshotMetadata(safiatou252, [safiatou415], moved);

    assert.equal(meta.kind, STUDENT_MERGE_KIND);
    assert.deepEqual((meta.kept as { id: string }).id, safiatou252.id);
    assert.deepEqual((meta.removed as { id: string }[]).map((s) => s.id), [safiatou415.id]);
    // Un reçu sans id ne laisse pas de trou dans la liste : il est simplement
    // absent de la trace des identifiants déplacés.
    assert.deepEqual(meta.moved_payment_ids, ['p1']);
  });
});

// ─── 7. La phrase du journal d'une suppression ──────────────────────────────
describe('la phrase du journal d’une suppression', () => {
  it('nomme la fiche avec ce qui la distingue : matricule, classe, parent, montants, reçus', () => {
    const withReceipt = { ...safiatou415, amountPaid: 10000, payments: [payment({ id: 'p1', date: '2026-10-05', amount: 10000 })] };
    const details = deleteAuditDetails(withReceipt);

    assert.ok(details.includes('Safiatou COULIBALY (MT-2026-415, 5A)'));
    assert.ok(details.includes('parent Fanta BAH'));
    assert.ok(details.includes('tél. 71121470'));
    assert.ok(details.includes('total dû 36000'));
    assert.ok(details.includes('déjà payé 10000'));
    assert.ok(details.includes('1 reçu'));
  });

  it('accorde le compte des reçus au pluriel', () => {
    const two = { ...safiatou415, payments: [payment({ id: 'p1', date: '2026-10-05', amount: 1 }), payment({ id: 'p2', date: '2026-10-06', amount: 1 })] };
    assert.ok(deleteAuditDetails(two).includes('2 reçus'));
    assert.ok(deleteAuditDetails(safiatou415).includes('0 reçus'));
  });

  it('rend DEUX phrases différentes pour deux fiches homonymes', () => {
    // Le cas qui a motivé l'outil : avant, le journal n'écrivait que le nom, donc
    // deux suppressions de « Safiatou COULIBALY » étaient indiscernables — on ne
    // pouvait pas dire LAQUELLE des deux fiches avait disparu.
    const first = deleteAuditDetails(safiatou252);
    const second = deleteAuditDetails(safiatou415);

    assert.notEqual(first, second);
    assert.ok(first.includes('MT-2026-252') && first.includes('Tuteur'));
    assert.ok(second.includes('MT-2026-415') && second.includes('Fanta BAH'));
  });
});
