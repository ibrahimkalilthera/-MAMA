/**
 * Smart Excel Ingestion (extracted from useSupabaseData.ts): per-category
 * insert/update logic honouring the duplicateStrategy, with typed reads over
 * the untrusted Record<string, unknown> input.
 */
import { supabase } from './supabaseClient';
import { logAuditEvent } from './auditLogger';
import { isNinthGradeClass, visibleStudentIdentifier } from './studentIdentifiers';
import type { DbInsert } from './database.types';
import type { Expense, Parent, Staff, Student } from './domainTypes';

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

type ImportableRow =
  | DbInsert<'students'>
  | DbInsert<'parents'>
  | DbInsert<'staff'>
  | DbInsert<'expenses'>;

/** Loose query-builder shape names the dynamic `from(table).insert(rows)` path. */
export interface InsertableBuilder {
  insert: (rows: ImportableRow[]) => {
    select: () => Promise<{
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    }>;
  };
}


export interface BatchImportDeps {
  students: Student[];
  parents: Parent[];
  staff: Staff[];
  expenses: Expense[];
  fetchAll: () => Promise<void>;
  notifySuccess: (operation: string) => void;
  notifyError: (operation: string, message: string) => void;
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

  const processBatch = async (
    table: ImportTable,
    rows: ImportableRow[]
  ): Promise<{ ok: number; err: number }> => {
    let ok = 0;
    let err = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { data, error } = await (supabase.from(table) as unknown as InsertableBuilder).insert(chunk).select();
      if (error) {
        console.error(`[MAMA THERA] batchImport ${table} error:`, error.message);
        err += chunk.length;
      } else {
        ok += data?.length ?? chunk.length;
      }
    }

    return { ok, err };
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

      const rows: DbInsert<'students'>[] = [];
      for (const r of records as StudentRec[]) {
        const importedStudentId = visibleStudentIdentifier(r.grade, r.studentId);
        const existing = (importedStudentId ? byStudentId.get(importedStudentId.toLowerCase()) : undefined)
          || byNameGrade.get(`${String(r.name || '').toLowerCase().trim()}|${String(r.grade || '').toLowerCase().trim()}`);

        if (existing) {
          if (strategy === 'update') {
            const { error } = await supabase.from('students').update({
              grade: r.grade ?? existing.grade ?? null,
              student_id: isNinthGradeClass(r.grade ?? existing.grade ?? undefined)
                ? (visibleStudentIdentifier(r.grade ?? existing.grade ?? undefined, r.studentId ?? existing.studentId) ?? null)
                : null,
              parent_name: r.parentName ?? existing.parentName ?? '',
              parent_phone: r.parentPhone ?? existing.parentPhone ?? '',
              parent_email: r.parentEmail ?? existing.parentEmail ?? null,
              total_due: r.totalDue ?? existing.totalDue,
              // never decrease the amount already paid
              amount_paid: Math.max(existing.amountPaid, Number(r.amountPaid) || 0),
              scholarship_discount: r.scholarshipDiscount ?? existing.scholarshipDiscount ?? 0,
              due_date: r.dueDate ?? existing.dueDate ?? null,
              academic_year: options.academicYear || existing.academicYear || null,
              notes: r.notes ?? existing.notes ?? null,
            }).eq('id', existing.id);
            if (error) { errors++; console.error('[MAMA THERA] student import update error:', error.message); }
            else updated++;
          } else {
            updated++; // duplicate present → skipped (already in DB)
          }
        } else {
          rows.push({
            name: r.name || '',
            grade: r.grade || null,
            student_id: visibleStudentIdentifier(r.grade ?? undefined, r.studentId ?? undefined) ?? null,
            parent_name: r.parentName || '',
            parent_phone: r.parentPhone || '',
            parent_email: r.parentEmail || '',
            total_due: r.totalDue || 0,
            amount_paid: r.amountPaid || 0,
            scholarship_discount: r.scholarshipDiscount || 0,
            due_date: r.dueDate || null,
            academic_year: options.academicYear || null,
            notes: r.notes || null,
            status: 'Active',
          });
        }
      }
      const result = await processBatch('students', rows);
      inserted += result.ok;
      errors += result.err;

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
        const { error } = await supabase.from('payments').insert({
          student_id: matchedStudent.id,
          amount,
          date,
          academic_year: options.academicYear || null,
          receipt_number: r.receiptNumber || null,
        });
        if (error) {
          console.error('[MAMA THERA] payment import error:', error.message);
          errors++;
        } else {
          inserted++;
          // Also update student's amount_paid
          await supabase.from('students').update({
            amount_paid: matchedStudent.amountPaid + amount,
            last_payment_date: date,
          }).eq('id', matchedStudent.id);
        }
      }

    } else if (category === 'parents') {
      const byKey = new Map<string, Parent>();
      deps.parents.forEach(p => byKey.set(p.fullName.toLowerCase().trim(), p));
      const rows: DbInsert<'parents'>[] = [];
      for (const r of records as ParentRec[]) {
        const key = String(r.fullName || '').toLowerCase().trim();
        const existing = key ? byKey.get(key) : undefined;
        if (existing) {
          if (strategy === 'update') {
            const { error } = await supabase.from('parents').update({
              phones: [r.phone1, r.phone2, ...(existing.phones || [])].filter((p): p is string => Boolean(p)).slice(0, 2),
              email: r.email ?? existing.email ?? null,
              address: r.address ?? existing.address ?? '',
              occupation: r.occupation ?? existing.occupation ?? '',
              relationship: r.relationship ?? existing.relationship ?? '',
              notes: r.notes ?? existing.notes ?? null,
            }).eq('id', existing.id);
            if (error) { errors++; console.error('[MAMA THERA] parent import update error:', error.message); }
            else updated++;
          } else {
            updated++;
          }
        } else {
          rows.push({
            full_name: r.fullName || '',
            phones: [r.phone1, r.phone2].filter((p): p is string => Boolean(p)),
            email: r.email || null,
            address: r.address || '',
            occupation: r.occupation || '',
            relationship: r.relationship || '',
          });
        }
      }
      const result = await processBatch('parents', rows);
      inserted += result.ok;
      errors += result.err;

    } else if (category === 'staff') {
      const byKey = new Map<string, Staff>();
      deps.staff.forEach(s => byKey.set(s.name.toLowerCase().trim(), s));
      const rows: DbInsert<'staff'>[] = [];
      for (const r of records as StaffRec[]) {
        const key = String(r.name || '').toLowerCase().trim();
        const existing = key ? byKey.get(key) : undefined;
        if (existing) {
          if (strategy === 'update') {
            const { error } = await supabase.from('staff').update({
              position: r.position ?? existing.position ?? '',
              salary: r.salary ?? existing.salary,
              email: r.email ?? existing.email ?? null,
              phone: r.phone ?? existing.phone ?? '',
              bank_details: r.bankDetails ?? existing.bankDetails ?? null,
              emergency_contact: r.emergencyContact ?? existing.emergencyContact ?? null,
              academic_year: options.academicYear || existing.academicYear || null,
            }).eq('id', existing.id);
            if (error) { errors++; console.error('[MAMA THERA] staff import update error:', error.message); }
            else updated++;
          } else {
            updated++;
          }
        } else {
          rows.push({
            name: r.name || '',
            position: r.position || '',
            salary: r.salary || 0,
            email: r.email || null,
            phone: r.phone || '',
            bank_details: r.bankDetails || null,
            emergency_contact: r.emergencyContact || null,
            academic_year: options.academicYear || null,
          });
        }
      }
      const result = await processBatch('staff', rows);
      inserted += result.ok;
      errors += result.err;

    } else if (category === 'expenses') {
      const byKey = new Map<string, Expense>();
      deps.expenses.forEach(e => byKey.set(`${e.description.toLowerCase().trim()}|${e.date}|${e.amount}`, e));
      const rows: DbInsert<'expenses'>[] = [];
      for (const r of records as ExpenseRec[]) {
        const description = String(r.description || '').toLowerCase().trim();
        const amount = Number(r.amount) || 0;
        const date = r.date || todayStr;
        const existing = byKey.get(`${description}|${date}|${amount}`);
        if (existing) {
          if (strategy === 'update') {
            const { error } = await supabase.from('expenses').update({
              category: r.category ?? existing.category,
              description: r.description ?? existing.description,
              amount: r.amount ?? existing.amount,
              academic_year: options.academicYear || existing.academicYear || null,
            }).eq('id', existing.id);
            if (error) { errors++; console.error('[MAMA THERA] expense import update error:', error.message); }
            else updated++;
          } else {
            updated++;
          }
        } else {
          rows.push({
            category: r.category || 'stationery',
            description: r.description || '',
            amount,
            date,
            academic_year: options.academicYear || null,
          });
        }
      }
      const result = await processBatch('expenses', rows);
      inserted += result.ok;
      errors += result.err;
    }

    logAuditEvent({
      action: 'BATCH_IMPORT',
      targetType: category,
      details: `Imported ${inserted} ${category} record(s) via Excel (${updated} updated, ${errors} errors)`,
    });

    // Refresh data to reflect newly imported records
    await deps.fetchAll();

    deps.notifySuccess(`batchImport_${category}`);
    return { inserted, updated, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Import failed';
    console.error('[MAMA THERA] batchImportData error:', err);
    deps.notifyError('batchImportData', msg);
    return { inserted, updated, errors: errors || records.length };
  }
};
