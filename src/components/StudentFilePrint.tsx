/**
 * StudentFilePrint — the hidden-until-printed student academic file.
 * Extracted from AppModals.tsx during the per-domain split (MainViews model):
 * receives only the props it needs and renders the print-only block.
 */
import { Users } from 'lucide-react';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { Student } from '../lib/useSupabaseData';
import type { TranslationDict } from '../i18n/translations';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';

interface StudentFilePrintProps {
  t: TranslationDict;
  student: Student;
  currentUser: { name?: string } | null;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  formatCurrency: (n: number) => string;
  tokens: { paperFillLight: string; paperFillMid: string; paperFillAlert: string };
}

export function StudentFilePrint({ t, student, currentUser, getGradeDisplay, formatCurrency, tokens }: StudentFilePrintProps) {
  return (
    <div className="hidden print:block print-student-file-container bg-white text-black font-sans p-12 space-y-8">
      {/* Header / Logo banner */}
      <div className="flex justify-between items-start border-b-2 border-black pb-6">
        <div>
          <h1 className="font-black text-2xl tracking-tight text-slate-900">COMPLEXE SCOLAIRE MAMA THERA</h1>
          <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mt-1">{t.officialStudentProfileAcademicFile}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t.phone2}: +223 70 00 00 00 | {t.email2} contact@mamathera.edu.ml</p>
        </div>
        {visibleStudentIdentifier(student.grade, student.studentId) && (
          <div className={`border border-slate-300 px-4 py-2 text-center rounded-xl ${tokens.paperFillLight}`}>
            <span className="text-[9px] font-black uppercase tracking-widest block text-slate-400">{t.studentId}</span>
            <span className="font-mono font-bold text-sm text-slate-800">
              {visibleStudentIdentifier(student.grade, student.studentId)}
            </span>
          </div>
        )}
      </div>

      {/* Profile Grid: Photo and Details */}
      <div className="grid grid-cols-4 gap-8">
        {/* Photo placeholder on Left */}
        <div className={`col-span-1 border-2 border-slate-300 rounded-[2rem] h-40 overflow-hidden ${tokens.paperFillLight} flex items-center justify-center relative shadow-inner`}>
          {student.photo ? (
            <img
              src={student.photo}
              alt={student.name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="text-center">
              <Users size={32} className="text-slate-400 mx-auto mb-1" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PASSPORT</span>
            </div>
          )}
        </div>

        {/* Main Info */}
        <div className="col-span-3 space-y-4">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">{student.name}</h2>
            <div className="flex gap-4 mt-2">
              <span className={`${tokens.paperFillMid} px-3 py-1 rounded-lg text-xs font-bold uppercase`}>
                {t.class} {getGradeDisplay(student.grade, 'fr')}
              </span>
              <span className={`${tokens.paperFillMid} px-3 py-1 rounded-lg text-xs font-bold uppercase`}>
                {t.status2} {student.status || 'Active'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="font-bold text-slate-400 block uppercase tracking-wide">{t.enrollmentDate2}</span>
              <span className="font-semibold text-slate-800">{student.enrollmentDate || '2026-07-16'}</span>
            </div>
            <div>
              <span className="font-bold text-slate-400 block uppercase tracking-wide">{t.academicYear2}</span>
              <span className="font-semibold text-slate-800">{student.academicYear || '2025-2026'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* General Info & Financial Ledger Section */}
      <div className="border border-slate-300 rounded-[2rem] p-6 space-y-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.financialStatusLedger}</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className={`${tokens.paperFillLight} p-4 rounded-xl border border-slate-100`}>
            <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.totalTuitionDue}</span>
            <span className="text-lg font-black text-slate-800">{formatCurrency(student.totalDue)}</span>
          </div>
          <div className={`${tokens.paperFillLight} p-4 rounded-xl border border-slate-100`}>
            <span className="text-[10px] font-bold text-slate-400 block uppercase">{t.paidTuition}</span>
            <span className="text-lg font-black text-emerald-600">+{formatCurrency(student.amountPaid)}</span>
          </div>
          <div className={`${tokens.paperFillAlert} p-4 rounded-xl border border-rose-100`}>
            <span className="text-[10px] font-bold text-rose-500 block uppercase">{t.remainingBalance2}</span>
            <span className="text-lg font-black text-rose-600">{formatCurrency(student.totalDue * (1 - (student.scholarshipDiscount || 0) / 100) - student.amountPaid)}</span>
          </div>
        </div>
      </div>

      {/* Parent & Emergency Info */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.guardianTitle}</h3>
          <div className="space-y-1.5 text-xs">
            <p><strong className="text-slate-400">{t.name}</strong> <span className="font-bold text-slate-800">{student.parentName}</span></p>
            <p><strong className="text-slate-400">{t.phone3}</strong> <span className="font-semibold text-slate-800">{student.parentPhone}</span></p>
            <p><strong className="text-slate-400">{t.email2}</strong> <span className="font-semibold text-blue-600">{student.parentEmail}</span></p>
          </div>
        </div>

        <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 border-b pb-2">{t.emergencyContact2}</h3>
          <div className="space-y-1.5 text-xs">
            <p><strong className="text-slate-400">{t.contactPerson}</strong> <span className="font-bold text-slate-800">{student.emergencyContactName || 'N/A'}</span></p>
            <p><strong className="text-slate-400">{t.relationship3}</strong> <span className="font-semibold text-slate-800">{student.emergencyContactRelation || 'N/A'}</span></p>
            <p><strong className="text-slate-400">{t.phoneNumber}</strong> <span className="font-black text-rose-600">{student.emergencyContactPhone || 'N/A'}</span></p>
          </div>
        </div>
      </div>

      {/* History & Medical Records */}
      <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{t.medicalHistoryFile}</h3>
        <div className="grid grid-cols-2 gap-6 text-xs">
          <div>
            <span className="font-bold text-slate-400 block uppercase">{t.previousSchoolTransferHistory}</span>
            <p className="font-semibold text-slate-800 mt-1">{student.previousSchool || (t.noneDirectAdmissionEntry)}</p>
          </div>
          <div>
            <span className="font-bold text-slate-400 block uppercase">{t.allergiesMedicalNotesConditions}</span>
            <p className="font-semibold text-slate-800 mt-1">{student.medicalNotes || (t.noneClearProfile)}</p>
          </div>
        </div>
      </div>

      {/* Signature Area */}
      <div className="flex justify-between items-center pt-12 border-t border-slate-200 text-xs">
        <div>
          <p className="font-bold">{t.generatedAndVerifiedSincerelyBy}</p>
          <p className="font-black mt-1 text-slate-900">{currentUser?.name || 'Direction Complexe Scolaire MAMA THERA'}</p>
          <p className="text-slate-500 text-[10px]">{t.complexeScolaireMamaTheraAdministration}</p>
        </div>
        <div className="text-right">
          <p className="font-bold">{t.officialSealSignature}</p>
          <div className="h-12 w-48 border-b border-dashed border-slate-400 mt-2 ml-auto" />
          <p className="text-[8px] text-slate-400 mt-1">{t.officialBoardRepresentative}</p>
        </div>
      </div>
    </div>
  );
}