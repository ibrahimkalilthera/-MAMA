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
import { clientWritesAmountPaid } from './vendorExpensePaid';
import { replayAddSalaryPayment, replayDeleteSalaryPayment } from './offlineReplayPayroll';
import { replayDisplayPreference } from './offlineReplaySettings';
import { replaySchoolName } from './offlineReplaySchoolName';

/** The surface of the Supabase client that replay touches. */
export type ReplayDb = Pick<SupabaseClient<Database>, 'from' | 'rpc'>;

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
    // `amount_paid` et `last_payment_date` ne partent PLUS : la base les dérive
    // de `payments` (déclencheurs `students_balance_derived` et
    // `payments_sync_student_balance`, migration 20261107000000). Un solde
    // envoyé à l'insertion serait remplacé de toute façon — l'envoyer ne ferait
    // qu'entretenir l'idée qu'il vient d'ici.
    scholarship_discount: student.scholarshipDiscount || 0,
    due_date: student.dueDate || null,
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
  // `amountPaid` et `lastPaymentDate` sont DÉRIVÉS par la base : les mapper ici
  // ferait partir un `UPDATE` que le déclencheur remplacerait aussitôt. La
  // fonction ne les nomme donc pas — même à la fusion, où c'est le rattachement
  // des reçus qui produit le nouveau solde.
  if (updates.scholarshipDiscount !== undefined) row.scholarship_discount = updates.scholarshipDiscount;
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate;
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

// ─── Le solde n'est PLUS réconcilié par le rejeu ─────────────────────────────
// Le rejeu a longtemps relu `amount_paid`/`last_payment_date` pour les avancer
// lui-même d'un DELTA après chaque geste. Depuis la migration 20261107000000,
// c'est la BASE qui les dérive de `payments` : insérer ou supprimer un reçu
// déclenche le recalcul de la fiche, et le rejeu n'a plus rien à écrire. Ce
// détour avait deux défauts que le déclencheur supprime : il écrivait une valeur
// dérivée depuis le client, et une réconciliation refusée gardait l'item en file
// pour un montant que la base avait déjà compté.

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
      // Le motif aussi — `null` quand il n'est pas déclaré (le CHECK de
      // `payments.motif` l'accepte, et le reçu lit « non renseigné »).
      motif: payment.motif ?? null,
      // Le montant ATTENDU du geste voyage avec lui : un versement partiel
      // rejoué sans lui reviendrait « soldé » et fermerait le mois que la
      // famille n'a pas fini de payer. `null` = non déclaré.
      due_amount: payment.dueAmount ?? null,
    });
    // `23505` : ce geste est DÉJÀ en base — la ligne existe, donc le déclencheur
    // a déjà recalculé la fiche. Rien d'autre à écrire : c'est ce qui rend le
    // rejeu idempotent sans relire un solde.
    if (!error || error.code === '23505') success = true;
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
      // Même règle qu'en ligne (src/lib/vendorExpensePaid.ts) : la colonne
      // n'est écrite que pour un partiel. Un rejeu qui l'écrirait pour un
      // « payé » ferait diverger le chemin hors ligne du chemin direct.
      ...(clientWritesAmountPaid(item.payload.paymentStatus) ? { amount_paid: item.payload.amountPaid } : {}),
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
    // La suppression mise en file : on retire la SEULE ligne de `payments`. Le
    // déclencheur de la base recalcule la fiche (montant retiré, date du reçu le
    // plus récent qui reste) — le rejeu n'écrit rien sur `students`.
    const { paymentId } = item.payload;
    const { error } = await db.from('payments').delete().eq('id', paymentId);
    // Le DELETE déclenche le recalcul de la fiche : le montant retiré redescend
    // et la date repart sur le reçu le plus récent QUI RESTE, sans que le rejeu
    // n'écrive rien sur `students`.
    if (!error) success = true;
  } else if (item.type === 'updatePaymentMonths') {
    // Renseigner les mois d’un reçu ANTÉRIEUR à la colonne `months` : la seule
    // colonne écrite est `months` — le montant, la date et le reçu ne bougent pas
    // (une correction de mois ne peut pas changer ce qui a été encaissé).
    //
    // Ce n’est plus un UPDATE du client, mais la FONCTION de la base
    // (`public.set_payment_months`, 20261013000000_econome_payment_months.sql) : une
    // policy RLS borne des LIGNES, pas des colonnes — l’ouvrir à l’économe lui
    // aurait donc ouvert le MONTANT avec. La fonction, elle, ne nomme que `months`
    // et vérifie le rôle de l’appelant elle-même (`public.is_payment_month_editor()`).
    //
    // Elle rend le NOMBRE de lignes écrites : zéro n’est PAS un succès — l’item
    // reste en file et le dira, au lieu d’être avalé avec une entrée de journal
    // qui annoncerait des mois renseignés sur rien.
    const { data, error } = await db.rpc('set_payment_months', {
      p_payment_id: item.payload.paymentId,
      p_months: item.payload.months,
    });
    if (error) {
      console.error('updatePaymentMonths: écriture refusée au rejeu —', error.message);
    } else if (typeof data !== 'number' || data === 0) {
      console.error('updatePaymentMonths: aucune ligne écrite au rejeu — reçu introuvable, ou refusé par la base');
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
    if (await replayAddSalaryPayment(db, item.localId, item.payload)) success = true;
  } else if (item.type === 'deleteSalaryPayment') {
    if (await replayDeleteSalaryPayment(db, item.payload)) success = true;
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
    // Le statut effectif vient de CE geste — le rejeu ne relit pas la ligne
    // (il peut avoir été mis en file hors ligne, sans lecture préalable).
    if (u.amountPaid !== undefined && clientWritesAmountPaid(u.paymentStatus)) {
      row.amount_paid = u.amountPaid;
    }
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
  } else if (item.type === 'setDisplayPreference') {
    // Réglage d'affichage changé hors ligne — écriture dans son module.
    success = await replayDisplayPreference(db, item.payload);
  } else if (item.type === 'setSchoolName') {
    // Le nom de l'école déclaré hors ligne — un fait d'établissement, écrit dans
    // son module (même ligne d'`app_settings` que le chemin en ligne).
    success = await replaySchoolName(db, item.payload);
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
    // `rpc` est le chemin des écritures BORNÉES (les mois d'un reçu,
    // `public.set_payment_months`). Sans lui ici, `replayOfflineItemDetailed`
    // lèverait un TypeError au lieu de rendre sa raison — et le drainage
    // s'arrêterait net sur cet item, la bannière muette.
    rpc: (fn: string, args?: Record<string, unknown>) =>
      wrap((db.rpc as (f: string, a?: Record<string, unknown>) => unknown)(fn, args)),
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
