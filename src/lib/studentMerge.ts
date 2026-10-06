/**
 * ─── Trancher entre deux fiches homonymes : ce qui se calcule SANS base ───────
 *
 * L'écran de comparaison et la fusion parlent de la même chose : deux fiches du
 * registre qui portent le même nom ET la même classe (le critère du contrôle,
 * voir `duplicateStudents.ts`). Ce module tient la partie PURE de la décision —
 * ce qu'on montre et ce qu'on écrit — pour que la règle soit testable sans
 * réseau et qu'une seule définition serve l'affichage et le journal.
 *
 * ─── Ce que « fusionner » veut dire, exactement ──────────────────────────────
 * Une fiche est GARDÉE (l'école la désigne : c'est celle dont les données sont
 * justes), les autres sont fusionnées dedans puis retirées. Trois choses suivent,
 * et aucune n'est cosmétique :
 *
 *   • les REÇUS des fiches fusionnées sont RATTACHÉS à la fiche gardée
 *     (`payments.student_id`) — jamais réécrits en lignes neuves : un reçu porte
 *     un numéro que la famille a peut-être déjà dans la main, et le réémettre
 *     ferait deux papiers pour un seul versement ;
 *   • le montant payé de la fiche gardée est la SOMME des montants ENREGISTRÉS
 *     sur les fiches. On ne le recalcule PAS depuis les lignes de reçus : un
 *     import historique peut avoir laissé un solde sans ligne, et la fiche est ce
 *     que l'école a validé — le geste ne doit pas effacer un versement ;
 *   • les NOTES des fiches retirées sont RECOPIÉES sur la fiche gardée, derrière
 *     un repère daté. Une note dit « la mère est passée payer vendredi » : la
 *     perdre avec la fiche serait perdre une information que personne n'a
 *     décidé de perdre.
 *
 * ─── Et ce que la fusion n'invente PAS ──────────────────────────────────────
 * Aucune donnée de la fiche gardée n'est écrasée par celle d'une autre : ni son
 * nom, ni sa classe, ni son total dû, ni son parent. C'est justement la raison
 * d'être du choix « quelle fiche garder ». Un outil qui moyenne deux fiches
 * fabriquerait un élève qui n'existe dans aucun des deux papiers.
 */
import type { Payment, Student } from './domainTypes';
import { studentMatricule } from './studentIdentifiers';

/** La forme d'un `metadata` qui décrit UNE fiche — un autre `metadata` n'en est pas un. */
export const STUDENT_SNAPSHOT_KIND = 'student_row';
/** La forme d'un `metadata` qui décrit une FUSION (la fiche gardée + celles retirées). */
export const STUDENT_MERGE_KIND = 'student_merge';

/** Une fiche, réduite à ce qui permet de la reconnaître plus tard. */
export interface StudentSnapshot {
  id: string;
  name: string;
  matricule?: string;
  grade?: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  total_due: number;
  amount_paid: number;
  status?: string;
  academic_year?: string;
  enrollment_date?: string;
  receipts: number;
  notes: string;
}

/**
 * Une fiche telle qu'elle est au moment du geste.
 *
 * Les clés sont en snake_case (celles des lignes) : le journal stocke ce JSON, et
 * le relire avec les noms des colonnes évite une table de correspondance de plus.
 * `receipts` est un COMPTE, `payments` un tableau : l'instantané reste court et
 * lisible dans le journal, et les reçus eux-mêmes gardent leur propre trace.
 */
export function studentSnapshot(student: Student): StudentSnapshot {
  return {
    id: student.id,
    name: student.name,
    matricule: studentMatricule(student.studentId),
    grade: student.grade || undefined,
    parent_name: student.parentName,
    parent_phone: student.parentPhone,
    parent_email: student.parentEmail,
    total_due: student.totalDue,
    amount_paid: student.amountPaid,
    status: student.status,
    academic_year: student.academicYear,
    enrollment_date: student.enrollmentDate,
    receipts: student.payments.length,
    notes: student.notes,
  };
}

/** L'instantané rangé dans un `metadata` prêt à écrire. */
export function studentSnapshotMetadata(student: Student): Record<string, unknown> {
  return { kind: STUDENT_SNAPSHOT_KIND, ...studentSnapshot(student) };
}

/**
 * « Safiatou COULIBALY (MT-2026-252, 5A) » — de quoi NOMMER une fiche dans une
 * phrase sans confondre deux homonymes. C'est exactement ce que le matricule
 * seul, ou le nom seul, ne permet pas.
 */
export function studentLabel(student: Pick<Student, 'name' | 'studentId' | 'grade'>): string {
  const facts = [studentMatricule(student.studentId), student.grade].filter(Boolean);
  return facts.length ? `${student.name} (${facts.join(', ')})` : student.name;
}

/**
 * Le grand livre consolidé : la fiche gardée reçoit les reçus des fiches
 * fusionnées, leur solde s'additionne, et la date du dernier paiement devient la
 * plus récente de toutes — y compris les dates DÉJÀ enregistrées sur les fiches,
 * pour ne jamais reculer (une fiche peut porter une date sans ligne de reçu).
 *
 * L'ordre de `payments` est stable (dates croissantes, puis ordre d'origine) :
 * deux exécutions du même geste ne réordonnent pas l'historique de l'écran.
 */
export interface MergedLedger {
  payments: Payment[];
  amountPaid: number;
  lastPaymentDate?: string;
}

export function mergedLedger(survivor: Student, merged: Student[]): MergedLedger {
  const seen = new Set<string>();
  const payments: Payment[] = [];
  for (const payment of [survivor, ...merged].flatMap((student) => student.payments)) {
    // Un reçu sans id (jamais écrit en base) ne peut pas être dédupliqué : on le
    // garde. Un reçu AVEC id ne passe qu'une fois — le même reçu déplacé deux
    // fois ne doit pas être compté deux fois.
    if (payment.id === undefined) {
      payments.push(payment);
      continue;
    }
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    payments.push(payment);
  }
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const recorded = [survivor, ...merged].reduce(
    (sum, student) => sum + (Number.isFinite(student.amountPaid) ? student.amountPaid : 0),
    0,
  );
  const dates = [
    ...sorted.map((payment) => payment.date),
    survivor.lastPaymentDate,
    ...merged.map((student) => student.lastPaymentDate),
  ].filter((date): date is string => Boolean(date)).sort();

  return {
    payments: sorted,
    amountPaid: Math.max(0, recorded),
    lastPaymentDate: dates.length ? dates[dates.length - 1] : undefined,
  };
}

/**
 * Les notes de la fiche gardée, suivies de celles des fiches retirées.
 *
 * Chaque note recopiée est précédée d'un repère sans phrase à traduire —
 * `[fusion 2026-10-06 · MT-2026-415]` : la date du geste et la fiche d'origine.
 * Un repère plutôt qu'une phrase parce que ce texte est une DONNÉE (la colonne
 * `notes`), relue et imprimée comme telle, dans l'une ou l'autre langue.
 *
 * Une fiche sans note n'ajoute rien : la fusion n'écrit pas de vide.
 */
export function mergedNotes(survivor: Student, merged: Student[], day: string): string {
  const parts: string[] = [];
  const kept = survivor.notes.trim();
  if (kept) parts.push(kept);
  for (const student of merged) {
    const text = student.notes.trim();
    if (!text) continue;
    const origin = studentMatricule(student.studentId) || student.id.slice(0, 8);
    parts.push(`[fusion ${day} · ${origin}] ${text}`);
  }
  return parts.join('\n\n');
}

/** La phrase du journal pour une fusion — française, comme le reste de ce domaine. */
export function mergeAuditDetails(survivor: Student, merged: Student[], movedReceipts: number): string {
  const removed = merged.map((student) => studentLabel(student)).join(', ');
  const receipts = movedReceipts === 1 ? '1 reçu rattaché' : `${movedReceipts} reçus rattachés`;
  return `Fiches fusionnées : ${removed} → gardée ${studentLabel(survivor)} — ${receipts}`;
}

/**
 * L'instantané COMPLET d'une fusion : la fiche gardée, chaque fiche retirée, et
 * les reçus déplacés. C'est la trace qui permet à l'école de relire — et à un
 * humain de refaire le geste à la main — même si l'écran a changé depuis.
 */
export function mergeSnapshotMetadata(
  survivor: Student,
  merged: Student[],
  movedReceipts: Payment[],
): Record<string, unknown> {
  return {
    kind: STUDENT_MERGE_KIND,
    kept: studentSnapshot(survivor),
    removed: merged.map(studentSnapshot),
    moved_payment_ids: movedReceipts.map((payment) => payment.id).filter(Boolean),
  };
}

/**
 * La phrase du journal pour une SUPPRESSION de fiche.
 *
 * Elle nomme la fiche AVEC ce qui la distingue — matricule, classe, parent,
 * montants, nombre de reçus — parce que la suppression d'un homonyme écrivait
 * jusqu'ici le seul NOM : deux fiches « Safiatou COULIBALY » produisaient deux
 * entrées identiques, et le journal ne disait pas laquelle était partie. Un
 * journal d'audit qui ne distingue pas deux fiches que l'outil sert à distinguer
 * ne sert à rien.
 */
export function deleteAuditDetails(student: Student): string {
  const facts = [
    student.parentName ? `parent ${student.parentName}` : '',
    student.parentPhone ? `tél. ${student.parentPhone}` : '',
    `total dû ${student.totalDue}`,
    `déjà payé ${student.amountPaid}`,
    student.payments.length === 1 ? '1 reçu' : `${student.payments.length} reçus`,
  ].filter(Boolean);
  return `Fiche supprimée : ${studentLabel(student)} — ${facts.join(', ')}`;
}
