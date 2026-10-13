/**
 * Offline queue replay — one item at a time.
 *
 * The per-action narrowing lives here as a pure function so it can be unit
 * tested with *each* `OfflineActionType` without needing a real Supabase
 * connection, React rendering, or a DOM. `useSupabaseData`'s `syncOfflineQueue`
 * drives the same function with the real client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DbUpdate, Json } from './database.types';
import type { QueueItem } from './offlineQueue';
import type { Parent, Student, Staff } from '../app/types';
import { studentMatricule } from './studentIdentifiers';
import { isUuid } from './rowMappers';
import { paymentSnapshotMetadata } from './paymentUndo';
import type { LogAuditParams } from './auditLogger';

/** The surface of the Supabase client that replay touches. */
export type ReplayDb = Pick<SupabaseClient<Database>, 'from'>;

/**
 * The `id` to send for a row that was created while the station was offline.
 *
 * A pupil enrolled offline already carries a client-generated UUID (createRowId)
 * — the SAME id their receipt, their queued payment and every later edit point
 * at. Sending it is what makes the replay land on one row instead of creating a
 * second one and orphaning the rest.
 *
 * No UUID (WebCrypto missing, or an item queued by an older build): the column
 * is simply omitted and the database generates the id, exactly as before.
 */
export function rowIdColumn(localId: string | undefined): { id?: string } {
  return isUuid(localId) ? { id: localId } : {};
}

// ─── App type → Supabase insert mappers ──────────────────────────────────────

export function parentToRow(parent: Omit<Parent, 'id'>) {
  return {
    full_name: parent.fullName,
    phones: parent.phones,
    email: parent.email || null,
    address: parent.address,
    occupation: parent.occupation,
    relationship: parent.relationship,
    notes: parent.notes || null,
  };
}

export function studentToRow(student: Omit<Student, 'id' | 'payments'>) {
  return {
    parent_id: student.parentId || null,
    student_id: studentMatricule(student.studentId) ?? null,
    name: student.name,
    parent_name: student.parentName,
    parent_email: student.parentEmail || null,
    parent_phone: student.parentPhone,
    total_due: student.totalDue,
    amount_paid: student.amountPaid,
    scholarship_discount: student.scholarshipDiscount || 0,
    due_date: student.dueDate || null,
    last_payment_date: student.lastPaymentDate || null,
    notes: student.notes || null,
    last_note_date: student.lastNoteDate || null,
    note_entries: (student.noteEntries || []) as unknown as Json,
    flagged: student.flagged || false,
    academic_year: student.academicYear || null,
    grade: student.grade || null,
    photo: student.photo || null,
    emergency_contact_name: student.emergencyContactName || null,
    emergency_contact_relation: student.emergencyContactRelation || null,
    emergency_contact_phone: student.emergencyContactPhone || null,
    medical_notes: student.medicalNotes || null,
    enrollment_date: student.enrollmentDate || null,
    previous_school: student.previousSchool || null,
    status: student.status || 'Active',
  };
}

export function staffToRow(s: Omit<Staff, 'id'>) {
  return {
    name: s.name,
    position: s.position,
    salary: s.salary,
    email: s.email || null,
    phone: s.phone || null,
    bank_details: s.bankDetails || null,
    emergency_contact: s.emergencyContact || null,
    academic_year: s.academicYear || null,
    inps_number: s.inpsNumber || null,
    hire_date: s.hireDate || null,
    family_status: s.familyStatus || null,
    children_count: s.childrenCount ?? 0,
    travel_allowance: s.travelAllowance ?? 0,
    communication_allowance: s.communicationAllowance ?? 0,
    housing_allowance: s.housingAllowance ?? 0,
    // NOT NULL in the schema: a member queued offline before the category
    // existed is an employee, the same kind the app showed for them.
    category: s.category ?? 'employee',
  };
}

export function studentUpdatesToRow(updates: Partial<Student>): DbUpdate<'students'> {
  const row: DbUpdate<'students'> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if ('parentId' in updates) row.parent_id = updates.parentId || null;
  if (updates.parentName !== undefined) row.parent_name = updates.parentName;
  if (updates.parentEmail !== undefined) row.parent_email = updates.parentEmail;
  if (updates.parentPhone !== undefined) row.parent_phone = updates.parentPhone;
  if (updates.totalDue !== undefined) row.total_due = updates.totalDue;
  if (updates.amountPaid !== undefined) row.amount_paid = updates.amountPaid;
  if (updates.scholarshipDiscount !== undefined) row.scholarship_discount = updates.scholarshipDiscount;
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate;
  if (updates.lastPaymentDate !== undefined) row.last_payment_date = updates.lastPaymentDate;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.lastNoteDate !== undefined) row.last_note_date = updates.lastNoteDate;
  if (updates.noteEntries !== undefined) row.note_entries = updates.noteEntries as unknown as Json;
  if (updates.flagged !== undefined) row.flagged = updates.flagged;
  if (updates.academicYear !== undefined) row.academic_year = updates.academicYear;
  if (updates.grade !== undefined) row.grade = updates.grade;
  // Le matricule ne se VIDE plus et ne dépend plus de la classe : il est attribué
  // une fois par la base (migration 20261006000000) et il vit avec l'élève. Un
  // champ laissé vide dans le formulaire ne l'efface donc pas — un identifiant
  // que les familles lisent sur un reçu ne s'efface pas par accident.
  if (updates.studentId !== undefined) {
    const matricule = studentMatricule(updates.studentId);
    if (matricule) row.student_id = matricule;
  }
  if (updates.photo !== undefined) row.photo = updates.photo;
  if (updates.emergencyContactName !== undefined) row.emergency_contact_name = updates.emergencyContactName;
  if (updates.emergencyContactRelation !== undefined) row.emergency_contact_relation = updates.emergencyContactRelation;
  if (updates.emergencyContactPhone !== undefined) row.emergency_contact_phone = updates.emergencyContactPhone;
  if (updates.medicalNotes !== undefined) row.medical_notes = updates.medicalNotes;
  if (updates.enrollmentDate !== undefined) row.enrollment_date = updates.enrollmentDate;
  if (updates.previousSchool !== undefined) row.previous_school = updates.previousSchool;
  if (updates.status !== undefined) row.status = updates.status;
  return row;
}

// ─── Réconcilier le solde d'un élève ─────────────────────────────────────────
// Le rejeu d'un paiement ne pouvait jusqu'ici qu'écrire la DATE du dernier
// paiement sur l'élève, jamais son SOLDE : après un drainage, `amount_paid`
// restait en arrière du montant réellement encaissé, et l'écart ne se corrigeait
// qu'au prochain rechargement complet des élèves. Cette fonction ferme ce trou :
// elle relit le solde de la base (jamais une copie locale, que le rejeu n'a pas)
// et l'avance/recule du montant du geste.
//
// Pourquoi un DELTA et pas un recalcul depuis la somme des `payments` : le solde
// d'un élève peut avoir été posé par un IMPORT (`Montant Payé` d'un tableur,
// voir batchImport.ts) sans qu'une ligne `payments` n'existe. Recalculer
// écraserait ces soldes importés. Le delta préserve l'origine du chiffre.

/** Ce qu'un geste rejoué change au solde d'un élève. */
export interface BalanceChange {
  /** Montant ajouté au solde : positif pour un paiement, négatif pour une annulation. */
  delta: number;
  /** Date du paiement ajouté — repointe `last_payment_date` s'il est plus récent. */
  paymentDate?: string;
  /**
   * Recaler `last_payment_date` sur le paiement le plus récent QUI RESTE, au lieu
   * de la repousser. Vrai après une SUPPRESSION : la date du paiement retiré ne
   * doit plus compter, et il faut relire ce qui reste plutôt que le deviner.
   */
  recomputeLastDate?: boolean;
}

/**
 * Écrire sur l'élève le solde et la date que le geste rejoué vient de changer.
 *
 * Rend `false` si la lecture ou l'écriture est refusée : l'item reste alors en
 * file et sera rejoué — c'est ce qui rend la réconciliation IDEMPOTENTE, car un
 * paiement n'est retiré de la file qu'une fois son solde écrit. Le montant n'est
 * donc jamais compté deux fois, et jamais perdu.
 */
export async function reconcileStudentBalance(
  db: ReplayDb,
  studentId: string,
  change: BalanceChange,
): Promise<boolean> {
  const read = await db.from('students').select('amount_paid, last_payment_date').eq('id', studentId);
  if (read.error) {
    console.error('reconcileStudentBalance: lecture du solde refusée —', read.error.message);
    return false;
  }
  const row = (read.data ?? [])[0] as { amount_paid?: unknown; last_payment_date?: unknown } | undefined;
  const current = Number(row?.amount_paid) || 0;

  // Un solde payé ne peut pas être négatif : on borne à 0 plutôt que d'écrire
  // une dette qui n'existe pas (même règle que le chemin en ligne).
  const update: DbUpdate<'students'> = { amount_paid: Math.max(0, current + change.delta) };

  if (change.recomputeLastDate) {
    const rest = await db.from('payments').select('date').eq('student_id', studentId);
    const dates = ((rest.data ?? []) as unknown as { date?: unknown }[])
      .map(r => (typeof r.date === 'string' && r.date ? r.date : null))
      .filter((d): d is string => d !== null)
      .sort();
    update.last_payment_date = dates.length ? dates[dates.length - 1] : null;
  } else if (change.paymentDate) {
    const currentDate = typeof row?.last_payment_date === 'string' && row.last_payment_date ? row.last_payment_date : null;
    // La date ne RECULE pas : un paiement plus ancien rejoué après coup (saisie
    // dans le désordre) ne doit pas reprendre la dernière date à un reçu plus récent.
    update.last_payment_date = !currentDate || change.paymentDate > currentDate ? change.paymentDate : currentDate;
  }

  const written = await db.from('students').update(update).eq('id', studentId);
  if (written.error) {
    console.error('reconcileStudentBalance: écriture du solde refusée —', written.error.message);
    return false;
  }
  return true;
}

// ─── Replay ──────────────────────────────────────────────────────────────────
// Mirrors the `if/else` chain previously inlined in useSupabaseData's
// `syncOfflineQueue`. Returns true when the action was applied without error.

export async function replayOfflineItem(db: ReplayDb, item: QueueItem): Promise<boolean> {
  let success = false;
  if (item.type === 'addPayment') {
    const { studentId, payment } = item.payload;
    // L'id du GESTE part aussi au rejeu (même règle que les autres tables) :
    // un drainage qui repasserait sur le même item retombe sur la même clé.
    const { error } = await db.from('payments').insert({
      ...rowIdColumn(item.localId),
      student_id: studentId,
      date: payment.date,
      amount: payment.amount,
      academic_year: payment.academicYear || null,
      receipt_number: payment.receiptNumber || null,
      // Les mois choisis voyagent avec le geste : un paiement rejoué sans eux
      // rendrait un reçu qui ne dit plus ce que la famille a payé.
      months: payment.months ?? [],
    });
    // `23505` : ce geste est DÉJÀ en base. On réconcilie quand même le solde —
    // le seul chemin qui mène ici est une première tentative qui a inséré la ligne
    // puis n'a PAS terminé la mise à jour du solde. Comme l'item n'est retiré de
    // la file qu'une fois cette mise à jour écrite, le montant n'est jamais
    // compté deux fois, et il finit toujours par l'être une fois.
    if (!error || error.code === '23505') {
      success = await reconcileStudentBalance(db, studentId, {
        delta: payment.amount,
        paymentDate: payment.date,
      });
    }
  } else if (item.type === 'addExpense') {
    const { error } = await db.from('expenses').insert({
      ...rowIdColumn(item.localId),
      category: item.payload.category,
      description: item.payload.description,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'updateExpense') {
    // Symétrique de `updateVendorExpense` : la modification d'une dépense
    // existante (import Excel en stratégie « mettre à jour ») devait pouvoir
    // attendre la ligne comme les autres écritures.
    const row: DbUpdate<'expenses'> = {};
    const u = item.payload.updates;
    if (u.category !== undefined) row.category = u.category;
    if (u.description !== undefined) row.description = u.description;
    if (u.amount !== undefined) row.amount = u.amount;
    if (u.date !== undefined) row.date = u.date;
    if (u.academicYear !== undefined) row.academic_year = u.academicYear;
    const { error } = await db.from('expenses').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteExpense') {
    const { error } = await db.from('expenses').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addVendorExpense') {
    const { error } = await db.from('vendor_expenses').insert({
      ...rowIdColumn(item.localId),
      vendor_name: item.payload.vendorName,
      category: item.payload.category,
      amount: item.payload.amount,
      due_date: item.payload.dueDate,
      payment_status: item.payload.paymentStatus,
      amount_paid: item.payload.amountPaid,
      description: item.payload.description || null,
      academic_year: item.payload.academicYear || null,
      aid_type: item.payload.aidType || null,
      beneficiary_student_name: item.payload.beneficiaryStudentName || null,
      beneficiary_student_grade: item.payload.beneficiaryStudentGrade || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addStudent') {
    const { error, data } = await db
      .from('students')
      .insert({ ...rowIdColumn(item.localId), ...studentToRow(item.payload) })
      .select()
      .single();
    if (!error && data) success = true;
  } else if (item.type === 'updateStudent') {
    const row = studentUpdatesToRow(item.payload.updates);
    const { error } = await db.from('students').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteStudent') {
    const { error } = await db.from('students').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deletePayment') {
    // La suppression mise en file : on retire la SEULE ligne de `payments`, PUIS
    // on réconcilie le solde de l'élève — le montant retiré redescend de
    // `amount_paid` (borné à 0) et `last_payment_date` est recalée sur le paiement
    // le plus récent QUI RESTE. Sans cela, la colonne restait en avance après un
    // drainage et le solde de l'école ne se corrigeait qu'au rechargement.
    const { studentId, paymentId, amount } = item.payload;
    const { error } = await db.from('payments').delete().eq('id', paymentId);
    if (!error) {
      success = await reconcileStudentBalance(db, studentId, { delta: -amount, recomputeLastDate: true });
    }
  } else if (item.type === 'updatePaymentMonths') {
    // Renseigner les mois d'un reçu ANTÉRIEUR à la colonne `months` : la seule
    // colonne écrite est `months` — le montant, la date et le reçu ne bougent pas
    // (une correction de mois ne peut pas changer ce qui a été encaissé).
    //
    // Zéro ligne rendue n'est donc PAS un succès : la même lecture que le chemin
    // en ligne (`.select('id')`, voir dataOps/payments.ts). C'est la policy
    // « Admin update payments » (`public.is_admin()`) qui refuse — la ligne
    // reste en file, l'écran le dit, et rien n'est annoncé comme écrit.
    const { data, error } = await db
      .from('payments')
      .update({ months: item.payload.months })
      .eq('id', item.payload.paymentId)
      .select('id');
    if (error) {
      console.error('updatePaymentMonths: écriture refusée au rejeu —', error.message);
    } else if (!data || data.length === 0) {
      console.error('updatePaymentMonths: aucune ligne modifiée au rejeu — cible filtrée par la policy RLS');
    } else {
      success = true;
    }
  } else if (item.type === 'addStaff') {
    const { error } = await db.from('staff').insert({ ...rowIdColumn(item.localId), ...staffToRow(item.payload) });
    if (!error) success = true;
  } else if (item.type === 'updateStaff') {
    const row: DbUpdate<'staff'> = {};
    const u = item.payload.updates;
    if (u.name !== undefined) row.name = u.name;
    if (u.position !== undefined) row.position = u.position;
    if (u.salary !== undefined) row.salary = u.salary;
    if ('email' in u) row.email = u.email || null;
    if (u.phone !== undefined) row.phone = u.phone;
    if (u.bankDetails !== undefined) row.bank_details = u.bankDetails;
    if (u.emergencyContact !== undefined) row.emergency_contact = u.emergencyContact;
    const { error } = await db.from('staff').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteStaff') {
    const { error } = await db.from('staff').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addSalaryPayment') {
    const { error } = await db.from('salary_payments').insert({
      ...rowIdColumn(item.localId),
      staff_id: item.payload.staffId,
      amount: item.payload.amount,
      date: item.payload.date,
      academic_year: item.payload.academicYear || null,
    });
    if (!error) success = true;
  } else if (item.type === 'addParent') {
    const { data, error } = await db
      .from('parents')
      .insert({ ...rowIdColumn(item.localId), ...parentToRow(item.payload) })
      .select()
      .single();
    if (!error && data) success = true;
  } else if (item.type === 'updateParent') {
    const row: DbUpdate<'parents'> = {};
    const u = item.payload.updates;
    if (u.fullName !== undefined) row.full_name = u.fullName;
    if (u.phones !== undefined) row.phones = u.phones;
    if ('email' in u) row.email = u.email || null;
    if (u.address !== undefined) row.address = u.address;
    if (u.occupation !== undefined) row.occupation = u.occupation;
    if (u.relationship !== undefined) row.relationship = u.relationship;
    if (u.notes !== undefined) row.notes = u.notes;
    const { error } = await db.from('parents').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteParent') {
    const { error } = await db.from('parents').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addTodo') {
    const { error } = await db.from('todos').insert({
      ...rowIdColumn(item.localId),
      text: item.payload.text,
      completed: item.payload.completed,
      student_id: item.payload.studentId || null,
      due_date: item.payload.date || null,
    });
    if (!error) success = true;
  } else if (item.type === 'updateTodo') {
    const row: DbUpdate<'todos'> = {};
    if (item.payload.updates.text !== undefined) row.text = item.payload.updates.text;
    if (item.payload.updates.completed !== undefined) row.completed = item.payload.updates.completed;
    if (item.payload.updates.date !== undefined) row.due_date = item.payload.updates.date;
    const { error } = await db.from('todos').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteTodo') {
    const { error } = await db.from('todos').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'updateVendorExpense') {
    const row: DbUpdate<'vendor_expenses'> = {};
    const u = item.payload.updates;
    if (u.vendorName !== undefined) row.vendor_name = u.vendorName;
    if (u.category !== undefined) row.category = u.category;
    if (u.amount !== undefined) row.amount = u.amount;
    if (u.dueDate !== undefined) row.due_date = u.dueDate;
    if (u.paymentStatus !== undefined) row.payment_status = u.paymentStatus;
    if (u.amountPaid !== undefined) row.amount_paid = u.amountPaid;
    if (u.description !== undefined) row.description = u.description;
    if (u.aidType !== undefined) row.aid_type = u.aidType;
    if (u.beneficiaryStudentName !== undefined) row.beneficiary_student_name = u.beneficiaryStudentName;
    if (u.beneficiaryStudentGrade !== undefined) row.beneficiary_student_grade = u.beneficiaryStudentGrade;
    const { error } = await db.from('vendor_expenses').update(row).eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'deleteVendorExpense') {
    const { error } = await db.from('vendor_expenses').delete().eq('id', item.payload.id);
    if (!error) success = true;
  } else if (item.type === 'addClass') {
    const { error } = await db.from('custom_classes').insert({
      ...rowIdColumn(item.localId),
      code: item.payload.code,
      cycle: item.payload.cycle,
      year: item.payload.year,
      section: item.payload.section,
      name_fr: item.payload.nameFr,
      name_en: item.payload.nameEn,
    });
    // `23505` : le code (unique, insensible à la casse) est déjà dans la table —
    // la classe que l'école voulait créer EXISTE. La garder en file pour
    // toujours serait le mensonge inverse de celui qu'on répare ici, et le
    // chemin en ligne la traite déjà ainsi (il adopte la ligne existante).
    if (!error || error.code === '23505') success = true;
  } else if (item.type === 'updateClass') {
    // `.select('id')` + le contrôle de longueur : la MÊME règle honnête que le
    // chemin en ligne — une modification filtrée par la RLS revient en 200 avec
    // un corps vide, et la compter comme réussie ferait disparaître de la file
    // une modification que la base n'a jamais reçue.
    const { data, error } = await db.from('custom_classes').update({
      code: item.payload.updates.code,
      cycle: item.payload.updates.cycle,
      year: item.payload.updates.year,
      section: item.payload.updates.section,
      name_fr: item.payload.updates.nameFr,
      name_en: item.payload.updates.nameEn,
    }).eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'deleteClass') {
    const { data, error } = await db.from('custom_classes').delete().eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'addNote') {
    const { error } = await db.from('calendar_notes').insert({
      ...rowIdColumn(item.localId),
      note_date: item.payload.date,
      text: item.payload.text,
    });
    if (!error) success = true;
  } else if (item.type === 'deleteNote') {
    const { data, error } = await db.from('calendar_notes').delete().eq('id', item.payload.id).select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'setCurrentYear') {
    // Même ordre que `keepAcademicYearCurrent` (la version en ligne) : la ligne
    // de l'année existe (ou est créée), puis le drapeau est déplacé dessus — et
    // l'ancienne le perd, sinon deux lignes se diraient courantes.
    const year = item.payload.year;
    const inserted = await db.from('academic_years').insert({ year_name: year, is_current: true });
    const existingRow = inserted.error?.code === '23505';
    if (!inserted.error || existingRow) {
      const cleared = await db.from('academic_years').update({ is_current: false }).neq('year_name', year);
      const flagged = await db.from('academic_years').update({ is_current: true }).eq('year_name', year);
      if (!cleared.error && !flagged.error) success = true;
    }
  } else if (item.type === 'updateUserRole') {
    // Le rôle d'un compte : la policy réserve la modification aux admins, et une
    // requête retirée par la RLS revient en 200 SANS ligne — d'où le
    // `.select('id')`, comme pour les classes et les notes. Sans lui, un rôle
    // refusé aurait disparu de la file en laissant croire qu'il était appliqué.
    const { data, error } = await db.from('user_profiles')
      .update({ role: item.payload.role })
      .eq('id', item.payload.id)
      .select('id');
    if (!error && data && data.length > 0) success = true;
  } else if (item.type === 'addAuditLog') {
    // L'entrée de journal écrite pendant la coupure : elle part telle quelle,
    // avec l'acteur FIGÉ au moment du geste (voir QueuedAuditEntry).
    //
    // `created_at` est celui du GESTE, pas celui du câble retrouvé : c'est lui
    // qui décide de la semaine d'archive, et un geste du dimanche soir écrit le
    // lundi matin ne doit pas changer de semaine. `recorded_offline` le DIT, au
    // lieu de le laisser deviner (l'écran et le PDF lisent ce drapeau pour
    // écrire la ligne en rouge).
    const { error } = await db.from('audit_logs').insert({
      user_id: item.payload.userId || null,
      user_email: item.payload.userEmail || 'system',
      user_name: item.payload.userName || item.payload.userEmail || 'System Staff',
      user_role: item.payload.userRole || 'staff',
      action: item.payload.action,
      target_type: item.payload.targetType || null,
      target_id: item.payload.targetId || null,
      details: item.payload.details || null,
      // L'instantané structuré part avec l'entrée : une suppression faite hors
      // ligne doit être annulable comme une suppression en ligne.
      metadata: (item.payload.metadata ?? null) as Json,
      created_at: item.createdAt,
      recorded_offline: true,
    });
    if (!error) success = true;
  }
  return success;
}

/**
 * Une raison COURTE et sûre pour un objet d'erreur PostgREST/GoTrue.
 *
 * La bannière doit pouvoir la nommer ; on garde donc le message et le code,
 * jamais l'objet entier (ni un `String(error)` qui, sur un objet sans
 * conversion, lèverait — le piège déjà payé par `errorText`).
 */
export function describeReplayError(error: unknown): string {
  if (!error) return 'écriture refusée par la base (aucune ligne touchée)';
  const e = (typeof error === 'object' && error !== null ? error : {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : 'refus sans message';
  const code = typeof e.code === 'string' && e.code.trim() ? ` [${e.code.trim()}]` : '';
  return `${message}${code}`.slice(0, 300);
}

/**
 * Enregistre la PREMIÈRE erreur rendue par la base pendant un rejeu.
 *
 * On n'ajoute pas une raison à chacune des 28 branches : on enveloppe la seule
 * surface que le rejeu utilise (`from()`, puis des builders thenables). Le
 * contrat tenu est donc celui d'un THENABLE — celui du client Supabase comme du
 * faux des tests. L'erreur lue est celle du premier résultat en échec, ce qui
 * suffit : un refus interrompt la branche et le rejeu s'arrête là.
 */
function recordingDb(db: ReplayDb, sink: { error: unknown }): ReplayDb {
  type Builder = { then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => unknown };
  const wrap = (builder: unknown): unknown =>
    new Proxy(builder as object, {
      get(target, prop) {
        if (prop === 'then') {
          return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            (target as Builder).then((value) => {
              const error = (value as { error?: unknown } | null)?.error;
              if (error && sink.error === null) sink.error = error;
              return onFulfilled ? onFulfilled(value) : value;
            }, onRejected);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function'
          ? (...args: unknown[]) => wrap((value as (...a: unknown[]) => unknown).apply(target, args))
          : value;
      },
    });
  return {
    from: (table: string) => wrap(db.from(table)),
  } as unknown as ReplayDb;
}

/**
 * Le rejeu AVEC sa raison : `ok` (comme `replayOfflineItem`) et, en cas de
 * refus, la cause lisible qui sera inscrite sur l'entrée de file. C'est ce que
 * le drainage utilise pour que l'école sache POURQUOI une saisie ne part pas.
 */
export async function replayOfflineItemDetailed(
  db: ReplayDb,
  item: QueueItem,
): Promise<{ ok: boolean; reason: string | null }> {
  const sink: { error: unknown } = { error: null };
  const ok = await replayOfflineItem(recordingDb(db, sink), item);
  return { ok, reason: ok ? null : describeReplayError(sink.error) };
}

// ─── Audit mapping for replayed actions ─────────────────────────────────────
// Pure mapping from a queued item to the audit entry it should produce once
// replayed, so it can be unit tested like replayOfflineItem itself. Returns
// null for actions whose online equivalent is not audited (todos), keeping
// the replay trail consistent with the online one. Details carry a [replay]
// tag so AuditView can tell offline materialization from live actions.

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
        details: `Paiement de ${item.payload.payment.amount} FCFA (reçu ${item.payload.payment.receiptNumber || 'N/A'})${tag}`,
        metadata: paymentSnapshotMetadata({
          paymentId: item.payload.payment.id ?? item.localId ?? '',
          studentId: item.payload.studentId,
          date: item.payload.payment.date,
          amount: item.payload.payment.amount,
          academicYear: item.payload.payment.academicYear,
          receiptNumber: item.payload.payment.receiptNumber,
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
      return { action: 'RECORD_SALARY_PAYMENT', targetType: 'salary_payment', targetId: null, details: `${item.payload.amount} FCFA (${item.payload.date})${tag}` };
    case 'addParent':
      return { action: 'ADD_PARENT', targetType: 'parent', targetId: null, details: `${item.payload.fullName}${tag}` };
    case 'updateParent':
      return { action: 'UPDATE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `mise à jour parent${tag}` };
    case 'deleteParent':
      return { action: 'DELETE_PARENT', targetType: 'parent', targetId: item.payload.id, details: `suppression parent${tag}` };
    default:
      // Geste dont l'équivalent EN LIGNE n'est pas audité — tâches, classes
      // personnalisées, notes du calendrier, déclaration d'année — donc le rejeu
      // ne l'est pas non plus : un même fait ne doit pas se lire de deux façons
      // selon qu'il a été rejoué ou non. Les entrées `addAuditLog` sont, elles,
      // le journal lui-même : les auditer bouclerait.
      return null;
  }
}