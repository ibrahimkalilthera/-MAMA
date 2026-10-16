/**
 * ─── Ce qu'un geste REJOUÉ inscrit au journal d'audit ───────────────────────
 *
 * Le rejeu hors ligne (`src/lib/offlineReplay.ts`) applique le geste ; ce module
 * dit ce que ce geste LAISSE dans `audit_logs` une fois arrivé. Les deux étaient
 * dans le même fichier jusqu'au 2026-10-16 : `offlineReplay.ts` a franchi le
 * budget de 700 lignes de la campagne de scission en accueillant le rejeu du nom
 * d'école, et cette moitié-là est la seule qui soit PURE — elle ne touche aucune
 * base, elle traduit un `QueueItem` en une entrée de journal —, donc c'est elle
 * qui part.
 *
 * L'API ne bouge pas pour l'appelant : `offlineSync` l'appelle au drainage,
 * `offlineAuditJournal` la relit pour dire ce qu'un poste a fait sans réseau, et
 * `tests/offline-replay.test.ts` l'éprouve sans base — la fonction est la même,
 * elle vit simplement dans son module.
 *
 * DEUX RÈGLES, et chacune paie un défaut précis :
 *
 *   • **un même fait ne se lit pas de deux façons.** Chaque geste audité reprend
 *     la forme EXACTE de son équivalent en ligne (mêmes actions, mêmes cibles) :
 *     l'instantané structuré d'un paiement (`paymentSnapshotMetadata`), le motif
 *     d'une inscription, la clé publiée d'un réglage. Un rejeu qui inventerait sa
 *     propre forme ferait lire deux fois le même fait, autrement.
 *   • **ce qui n'est pas audité en ligne ne l'est pas ici.** Les tâches, les
 *     classes personnalisées, les notes du calendrier et la déclaration d'année
 *     rendent `null` — et les entrées `addAuditLog` aussi, sinon le journal
 *     s'auditerait lui-même. Le silence est une décision, pas un oubli.
 *
 * Le suffixe ` [replay]` distingue ce qui vient d'un rejeu de ce qui a été écrit
 * en direct : l'écran du journal d'audit s'en sert pour le dire.
 */
import type { QueueItem } from './offlineQueue';
import type { LogAuditParams } from './auditLogger';
import { paymentSnapshotMetadata } from './paymentUndo';
import { paymentMotifAuditTag } from './paymentMotifs';
import { salaryAddAuditInfo, salaryDeleteAuditInfo } from './offlineReplayPayroll';
import { displayPreferenceAuditInfo } from './offlineReplaySettings';
import { schoolNameAuditInfo } from './offlineReplaySchoolName';

export function offlineAuditInfo(item: QueueItem): Omit<LogAuditParams, 'user'> | null {
  const tag = ' [replay]';
  switch (item.type) {
    case 'addPayment':
      // Même forme que le chemin en ligne (dataOps/payments.ts) : un même fait
      // ne doit pas se lire de deux façons selon qu'il a été rejoué ou non —
      // instantané STRUCTURÉ compris (l'Historique des paiements y lit un montant
      // chiffré, jamais une phrase à découper). `localId` porte l'id minté pour ce
      // geste quand le paiement lui-même ne le porte pas (voir QueueItemBase).
      return {
        action: 'RECORD_PAYMENT',
        targetType: 'payment',
        targetId: item.payload.studentId,
        // La mention du motif (clé stockée, rien pour le geste ordinaire) vient
        // de `paymentMotifs.ts`, comme le chemin en ligne : un même fait ne se
        // lit pas de deux façons selon qu'il a été rejoué ou non.
        details: `Paiement de ${item.payload.payment.amount} FCFA (reçu ${item.payload.payment.receiptNumber || 'N/A'})${paymentMotifAuditTag(item.payload.payment.motif)}${tag}`,
        metadata: paymentSnapshotMetadata({
          paymentId: item.payload.payment.id ?? item.localId ?? '',
          studentId: item.payload.studentId,
          date: item.payload.payment.date,
          amount: item.payload.payment.amount,
          academicYear: item.payload.payment.academicYear,
          receiptNumber: item.payload.payment.receiptNumber,
          motif: item.payload.payment.motif,
        }),
      };
    case 'deletePayment':
      // Même forme que le chemin en ligne (dataOps/payments.ts) : montant, reçu,
      // date, élève, PLUS l'instantané qui rend le geste annulable — un même fait
      // ne se lit pas de deux façons selon qu'il a été rejoué ou non.
      return {
        action: 'DELETE_PAYMENT',
        targetType: 'payment',
        targetId: item.payload.paymentId,
        details: `Paiement de ${item.payload.amount} FCFA (reçu ${item.payload.receiptNumber || 'N/A'}) du ${item.payload.date} supprimé — élève ${item.payload.studentName ?? item.payload.studentId}${tag}`,
        metadata: paymentSnapshotMetadata({
          paymentId: item.payload.paymentId,
          studentId: item.payload.studentId,
          studentName: item.payload.studentName,
          date: item.payload.date,
          amount: item.payload.amount,
          academicYear: item.payload.academicYear,
          receiptNumber: item.payload.receiptNumber,
          motif: item.payload.motif,
        }),
      };
    case 'updatePaymentMonths':
      // Même forme que le chemin en ligne (dataOps/payments.ts) : les mois sont
      // écrits tels qu'ils sont STOCKÉS (`2026-09`), donc la ligne reste juste
      // dans une école qui lit le journal en anglais — le libellé traduit
      // (« Septembre ») appartient au reçu, pas au journal.
      return {
        action: 'UPDATE_PAYMENT_MONTHS',
        targetType: 'payment',
        targetId: item.payload.paymentId,
        details: `Paiement de ${item.payload.amount} FCFA (reçu ${item.payload.receiptNumber || 'N/A'}) du ${item.payload.date} : mois renseignés — ${item.payload.months.join(', ')} — élève ${item.payload.studentName ?? item.payload.studentId}${tag}`,
      };
    case 'addExpense':
      return { action: 'ADD_EXPENSE', targetType: 'expense', targetId: null, details: `${item.payload.description} (${item.payload.category}) — ${item.payload.amount} FCFA${tag}` };
    case 'updateExpense':
      return { action: 'UPDATE_EXPENSE', targetType: 'expense', targetId: item.payload.id, details: `mise à jour dépense${tag}` };
    case 'deleteExpense':
      return { action: 'DELETE_EXPENSE', targetType: 'expense', targetId: item.payload.id, details: `suppression dépense${tag}` };
    case 'addVendorExpense':
      return { action: 'ADD_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: null, details: `${item.payload.vendorName} — ${item.payload.category} — ${item.payload.amount} FCFA${tag}` };
    case 'updateVendorExpense':
      return { action: 'UPDATE_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: item.payload.id, details: `mise à jour dépense fournisseur${tag}` };
    case 'deleteVendorExpense':
      return { action: 'DELETE_VENDOR_EXPENSE', targetType: 'vendor_expense', targetId: item.payload.id, details: `suppression dépense fournisseur${tag}` };
    case 'addStudent':
      return { action: 'ADD_STUDENT', targetType: 'student', targetId: null, details: `${item.payload.name}${tag}` };
    case 'updateStudent':
      return { action: 'UPDATE_STUDENT', targetType: 'student', targetId: item.payload.id, details: `mise à jour élève${tag}` };
    case 'deleteStudent':
      return { action: 'DELETE_STUDENT', targetType: 'student', targetId: item.payload.id, details: `suppression élève${tag}` };
    case 'addStaff':
      return { action: 'ADD_STAFF', targetType: 'staff', targetId: null, details: item.payload.position ? `${item.payload.name} (${item.payload.position})${tag}` : `${item.payload.name}${tag}` };
    case 'updateStaff':
      return { action: 'UPDATE_STAFF', targetType: 'staff', targetId: item.payload.id, details: `mise à jour membre${tag}` };
    case 'deleteStaff':
      return { action: 'DELETE_STAFF', targetType: 'staff', targetId: item.payload.id, details: `suppression membre${tag}` };
    case 'addSalaryPayment':
      return salaryAddAuditInfo(item.payload, tag);
    case 'deleteSalaryPayment':
      return salaryDeleteAuditInfo(item.payload, tag);
    case 'addParent':
      return { action: 'ADD_PARENT', targetType: 'parent', targetId: null, details: `${item.payload.fullName}${tag}` };
    case 'updateParent':
      return { action: 'UPDATE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `mise à jour parent${tag}` };
    case 'deleteParent':
      return { action: 'DELETE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `suppression parent${tag}` };
    case 'setDisplayPreference':
      return displayPreferenceAuditInfo(item.payload, tag);
    case 'setSchoolName':
      // Le nom de l'école est audité EN LIGNE aussi (`UPDATE_SETTING`, voir
      // dataOps/settings.ts) : le rejeu doit s'y lire de la même façon.
      return schoolNameAuditInfo(item.payload, tag);
    default:
      // Geste dont l'équivalent EN LIGNE n'est pas audité — tâches, classes
      // personnalisées, notes du calendrier, déclaration d'année — donc le rejeu
      // ne l'est pas non plus : un même fait ne doit pas se lire de deux façons
      // selon qu'il a été rejoué ou non. Les entrées `addAuditLog` sont, elles,
      // le journal lui-même : les auditer bouclerait.
      return null;
  }
}
