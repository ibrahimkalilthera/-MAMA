/**
 * Smart Excel Ingestion (extracted from useSupabaseData.ts): per-category
 * insert/update logic honouring the duplicateStrategy, with typed reads over
 * the untrusted Record<string, unknown> input.
 *
 * ── Hors ligne ───────────────────────────────────────────────────────────────
 * Un import ne doit pas être le seul geste qui exige la ligne : c'est justement
 * en début d'année, quand la connexion est la plus sollicitée (et la plus
 * capricieuse), qu'une école saisit ses listes. Deux chemins, donc, et une
 * seule frontière :
 *
 *   • les NOUVELLES lignes partent en ligne par paquets de 50 — l'import d'une
 *     école entière ne peut pas faire 800 allers-retours — et hors ligne une
 *     par une, par les fonctions d'écriture du domaine (`deps.write`), donc
 *     mises en file exactement comme une saisie à l'écran ;
 *   • les MISES À JOUR passent toujours par ces mêmes fonctions : elles se
 *     faisaient déjà ligne par ligne, et c'est ce qui les rend aptes à attendre
 *     la connexion (et à respecter la policy RLS, qui répond 200 avec un corps
 *     vide plutôt qu'une erreur).
 *
 * Les lignes de la base sont dérivées des objets du domaine par les mappers
 * partagés (`studentToRow`, `parentToRow`, `staffToRow`) : une seule table de
 * correspondance pour l'import, la file et les écrans.
 */
import { supabase } from './supabaseClient';
import { logAuditEvent } from './auditLogger';
import { isNinthGradeClass, visibleStudentIdentifier } from './studentIdentifiers';
import { parentToRow, staffToRow, studentToRow } from './offlineReplay';
import type { DbInsert } from './database.types';
import type { Expense, Parent, Payment, Staff, Student } from './domainTypes';

// ─── Excel Import typed reads ────────────────────────────────────────────────
// Excel data arrives as `Record<string, unknown>` (untrusted). These interfaces
// form a typed boundary so the coercion (String()/Number()/??) is explicit.

export interface StudentRec {
  studentId?: string | null;
  name?: string | null;
  grade?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  totalDue?: number | null;
  amountPaid?: number | null;
  scholarshipDiscount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface PaymentRec {
  studentName?: string | null;
  amount?: number | null;
  date?: string | null;
  receiptNumber?: string | null;
}

export interface ParentRec {
  fullName?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  occupation?: string | null;
  relationship?: string | null;
  notes?: string | null;
}

export interface StaffRec {
  name?: string | null;
  position?: string | null;
  salary?: number | null;
  email?: string | null;
  phone?: string | null;
  bankDetails?: string | null;
  emergencyContact?: string | null;
}

export interface ExpenseRec {
  description?: string | null;
  amount?: number | null;
  date?: string | null;
  category?: string | null;
}

type ImportTable = 'students' | 'parents' | 'staff' | 'expenses';

type BatchInsertRow =
  | DbInsert<'students'>
  | DbInsert<'parents'>
  | DbInsert<'staff'>
  | DbInsert<'expenses'>;

/** Loose query-builder shape names the dynamic `from(table).insert(rows)` path. */
export interface InsertableBuilder {
  insert: (rows: BatchInsertRow[]) => {
    select: () => Promise<{
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    }>;
  };
}

/**
 * Les écritures du domaine, telles que les écrans les utilisent : mêmes
 * fonctions, donc même file d'attente hors ligne, même audit, même honnêteté
 * sur une ligne filtrée par la RLS.
 */
export interface BatchImportWriters {
  addStudent: (student: Omit<Student, 'id' | 'payments'>) => Promise<Student | null>;
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
  addParent: (parent: Omit<Parent, 'id'>) => Promise<Parent | null>;
  updateParent: (id: string, updates: Partial<Parent>) => Promise<boolean>;
  addStaff: (staff: Omit<Staff, 'id'>) => Promise<Staff | null>;
  updateStaff: (id: string, updates: Partial<Staff>) => Promise<boolean>;
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<Expense | null>;
  updateExpense: (id: string, updates: Partial<Expense>) => Promise<boolean>;
  addPayment: (
    studentId: string,
    payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string }
  ) => Promise<boolean>;
}

export interface BatchImportDeps {
  students: Student[];
  parents: Parent[];
  staff: Staff[];
  expenses: Expense[];
  fetchAll: () => Promise<void>;
  notifySuccess: (operation: string) => void;
  notifyError: (operation: string, message: string) => void;
  /** Vrai quand un aller-retour serveur est impossible (réseau, ou session sans jeton). */
  isOffline: () => boolean;
  /** Les écritures par domaine — la même voie que la saisie à l'écran. */
  write: BatchImportWriters;
}

export async function importBatchData(
category: 'students' | 'payments' | 'parents' | 'staff' | 'expenses',
records: Record<string, unknown>[],
options: { academicYear: string; duplicateStrategy: 'skip' | 'update' },
deps: BatchImportDeps
): Promise<{ inserted: number; updated: number; errors: number }> {
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const BATCH_SIZE = 50;
  const strategy = options.duplicateStrategy === 'update' ? 'update' : 'skip';
  const todayStr = new Date().toISOString().split('T')[0];
  const offline = deps.isOffline();

  /**
   * Écrit les NOUVELLES lignes : une requête groupée par 50 en ligne, élément
   * par élément hors ligne (chaque élément part alors dans la file d'attente, et
   * compte comme « inséré » du point de vue de l'utilisateur — c'est la même
   * promesse qu'à l'écran, et le bandeau dit ce qui attend).
   */
  const writeNewRows = async <T>(
    table: ImportTable,
    domainRows: T[],
    toRow: (row: T) => BatchInsertRow,
    enqueueRow: (row: T) => Promise<unknown>,
  ): Promise<void> => {
    if (offline) {
      for (const row of domainRows) {
        if (await enqueueRow(row)) inserted++;
        else errors++;
      }
      return;
    }
    for (let i = 0; i < domainRows.length; i += BATCH_SIZE) {
      const chunk = domainRows.slice(i, i + BATCH_SIZE).map(toRow);
      const { data, error } = await (supabase.from(table) as unknown as InsertableBuilder).insert(chunk).select();
      if (error) {
        console.error(`[MAMA THERA] batchImport ${table} error:`, error.message);
        errors += chunk.length;
      } else {
        inserted += data?.length ?? chunk.length;
      }
    }
  };

  /** Écrit les lignes DÉJÀ connues, une par une, par la voie du domaine. */
  const writeUpdates = async <U>(
    targets: Array<{ id: string; updates: U }>,
    write: (id: string, updates: U) => Promise<boolean>,
  ): Promise<void> => {
    for (const target of targets) {
      if (await write(target.id, target.updates)) updated++;
      else errors++;
    }
  };

  try {
    if (category === 'students') {
      // Index existing students by student_id, then by name+grade, so the
      // duplicateStrategy ('skip' | 'update') can be honoured.
      const byStudentId = new Map<string, Student>();
      const byNameGrade = new Map<string, Student>();
      deps.students.forEach(s => {
        if (s.studentId) byStudentId.set(String(s.studentId).toLowerCase().trim(), s);
        byNameGrade.set(`${s.name.toLowerCase().trim()}|${(s.grade || '').toLowerCase().trim()}`, s);
      });

      const newStudents: Array<Omit<Student, 'id' | 'payments'>> = [];
      const studentUpdates: Array<{ id: string; updates: Partial<Student> }> = [];
      for (const r of records as StudentRec[]) {
        const importedStudentId = visibleStudentIdentifier(r.grade, r.studentId);
        const existing = (importedStudentId ? byStudentId.get(importedStudentId.toLowerCase()) : undefined)
          || byNameGrade.get(`${String(r.name || '').toLowerCase().trim()}|${String(r.grade || '').toLowerCase().trim()}`);

        if (existing) {
          if (strategy === 'update') {
            studentUpdates.push({
              id: existing.id,
              updates: {
                grade: r.grade ?? existing.grade,
                studentId: isNinthGradeClass(r.grade ?? existing.grade ?? undefined)
                  ? (visibleStudentIdentifier(r.grade ?? existing.grade ?? undefined, r.studentId ?? existing.studentId) ?? '')
                  : '',
                parentName: r.parentName ?? existing.parentName ?? '',
                parentPhone: r.parentPhone ?? existing.parentPhone ?? '',
                parentEmail: r.parentEmail ?? existing.parentEmail ?? '',
                totalDue: r.totalDue ?? existing.totalDue,
                // never decrease the amount already paid
                amountPaid: Math.max(existing.amountPaid, Number(r.amountPaid) || 0),
                scholarshipDiscount: r.scholarshipDiscount ?? existing.scholarshipDiscount ?? 0,
                dueDate: r.dueDate ?? existing.dueDate ?? '',
                academicYear: options.academicYear || existing.academicYear,
                notes: (r.notes ?? existing.notes) || '',
              },
            });
          } else {
            updated++; // duplicate present → skipped (already in DB)
          }
        } else {
          newStudents.push({
            name: r.name || '',
            grade: r.grade || undefined,
            studentId: visibleStudentIdentifier(r.grade ?? undefined, r.studentId ?? undefined),
            parentName: r.parentName || '',
            parentPhone: r.parentPhone || '',
            parentEmail: r.parentEmail || '',
            totalDue: r.totalDue || 0,
            amountPaid: r.amountPaid || 0,
            scholarshipDiscount: r.scholarshipDiscount || 0,
            dueDate: r.dueDate || '',
            academicYear: options.academicYear || undefined,
            notes: r.notes || '',
            status: 'Active',
          });
        }
      }
      await writeNewRows('students', newStudents, studentToRow, deps.write.addStudent);
      await writeUpdates(studentUpdates, deps.write.updateStudent);

    } else if (category === 'payments') {
      // For payments, we need to match student names to IDs
      for (const r of records as PaymentRec[]) {
        const studentName = String(r.studentName || '');
        const matchedStudent = deps.students.find(
          (s) => s.name.toLowerCase().trim() === studentName.toLowerCase().trim()
        );
        if (!matchedStudent) {
          errors++;
          continue;
        }
        const amount = Number(r.amount) || 0;
        const date = r.date || todayStr;
        // Exact duplicate (same student, date and amount) → never double-count
        const alreadyExists = matchedStudent.payments.some(
          (p) => p.date === date && Number(p.amount) === amount
        );
        if (alreadyExists) {
          updated++;
          continue;
        }
        // La voie du domaine : elle insère le paiement ET met à jour l'élève
        // (montant payé, date du dernier paiement), et elle sait attendre la
        // ligne — un import de règlements n'exige plus le réseau.
        const ok = await deps.write.addPayment(matchedStudent.id, {
          date,
          amount,
          academicYear: options.academicYear || undefined,
          receiptNumber: r.receiptNumber || undefined,
        });
        if (ok) inserted++; else errors++;
      }

    } else if (category === 'parents') {
      const byKey = new Map<string, Parent>();
      deps.parents.forEach(p => byKey.set(p.fullName.toLowerCase().trim(), p));
      const newParents: Array<Omit<Parent, 'id'>> = [];
      const parentUpdates: Array<{ id: string; updates: Partial<Parent> }> = [];
      for (const r of records as ParentRec[]) {
        const key = String(r.fullName || '').toLowerCase().trim();
        const existing = key ? byKey.get(key) : undefined;
        if (existing) {
          if (strategy === 'update') {
            parentUpdates.push({
              id: existing.id,
              updates: {
                phones: [r.phone1 || '', r.phone2 || '', ...(existing.phones || [])].filter((p): p is string => Boolean(p)).slice(0, 2),
                email: r.email ?? existing.email,
                address: r.address ?? existing.address ?? '',
                occupation: r.occupation ?? existing.occupation ?? '',
                relationship: r.relationship ?? existing.relationship ?? '',
                notes: r.notes ?? existing.notes,
              },
            });
          } else {
            updated++;
          }
        } else {
          newParents.push({
            fullName: r.fullName || '',
            phones: [r.phone1 || '', r.phone2 || ''].filter((p): p is string => Boolean(p)),
            email: r.email || undefined,
            address: r.address || '',
            occupation: r.occupation || '',
            relationship: r.relationship || '',
          });
        }
      }
      await writeNewRows('parents', newParents, parentToRow, deps.write.addParent);
      await writeUpdates(parentUpdates, deps.write.updateParent);

    } else if (category === 'staff') {
      const byKey = new Map<string, Staff>();
      deps.staff.forEach(s => byKey.set(s.name.toLowerCase().trim(), s));
      const newStaff: Array<Omit<Staff, 'id'>> = [];
      const staffUpdates: Array<{ id: string; updates: Partial<Staff> }> = [];
      for (const r of records as StaffRec[]) {
        const key = String(r.name || '').toLowerCase().trim();
        const existing = key ? byKey.get(key) : undefined;
        if (existing) {
          if (strategy === 'update') {
            staffUpdates.push({
              id: existing.id,
              updates: {
                position: r.position ?? existing.position ?? '',
                salary: r.salary ?? existing.salary,
                email: r.email ?? existing.email,
                phone: r.phone ?? existing.phone ?? '',
                bankDetails: r.bankDetails ?? existing.bankDetails,
                emergencyContact: r.emergencyContact ?? existing.emergencyContact,
                academicYear: options.academicYear || existing.academicYear,
              },
            });
          } else {
            updated++;
          }
        } else {
          newStaff.push({
            name: r.name || '',
            position: r.position || '',
            salary: r.salary || 0,
            email: r.email || '',
            phone: r.phone || '',
            bankDetails: r.bankDetails || '',
            emergencyContact: r.emergencyContact || '',
            academicYear: options.academicYear || undefined,
          });
        }
      }
      await writeNewRows('staff', newStaff, staffToRow, deps.write.addStaff);
      await writeUpdates(staffUpdates, deps.write.updateStaff);

    } else if (category === 'expenses') {
      const byKey = new Map<string, Expense>();
      deps.expenses.forEach(e => byKey.set(`${e.description.toLowerCase().trim()}|${e.date}|${e.amount}`, e));
      const newExpenses: Array<Omit<Expense, 'id'>> = [];
      const expenseUpdates: Array<{ id: string; updates: Partial<Expense> }> = [];
      for (const r of records as ExpenseRec[]) {
        const description = String(r.description || '').toLowerCase().trim();
        const amount = Number(r.amount) || 0;
        const date = r.date || todayStr;
        const existing = byKey.get(`${description}|${date}|${amount}`);
        if (existing) {
          if (strategy === 'update') {
            expenseUpdates.push({
              id: existing.id,
              updates: {
                category: r.category ?? existing.category,
                description: r.description ?? existing.description,
                amount: r.amount ?? existing.amount,
                academicYear: options.academicYear || existing.academicYear,
              },
            });
          } else {
            updated++;
          }
        } else {
          newExpenses.push({
            category: r.category || 'stationery',
            description: r.description || '',
            amount,
            date,
            academicYear: options.academicYear || undefined,
          });
        }
      }
      await writeNewRows(
        'expenses',
        newExpenses,
        (e) => ({
          category: e.category,
          description: e.description,
          amount: e.amount,
          date: e.date,
          academic_year: e.academicYear || null,
        }),
        deps.write.addExpense,
      );
      await writeUpdates(expenseUpdates, deps.write.updateExpense);
    }

    // Hors ligne, cet envoi ne peut pas aboutir (aucun jeton, aucun réseau) : le
    // résumé du lot est alors porté par les entrées [replay] de chaque ligne, qui
    // partent au moment où l'écriture arrive réellement en base — c'est-à-dire au
    // bon moment, plutôt qu'à celui de la saisie.
    if (!offline) {
      logAuditEvent({
        action: 'BATCH_IMPORT',
        targetType: category,
        details: `Import Excel : ${inserted} ${category}, ${updated} mis à jour, ${errors} erreur(s)`,
      });
    }

    // Hors ligne, l'état optimiste EST ce que l'utilisateur vient de saisir :
    // relire la base (ou son instantané) effacerait de l'écran les lignes qui
    // viennent d'y entrer et qui attendent leur envoi.
    if (!offline) await deps.fetchAll();

    deps.notifySuccess(`batchImport_${category}`);
    return { inserted, updated, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Import failed';
    console.error('[MAMA THERA] batchImportData error:', err);
    deps.notifyError('batchImportData', msg);
    return { inserted, updated, errors: errors || records.length };
  }
};
