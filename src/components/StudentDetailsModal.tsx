import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Calendar, Copy, FileText, Printer, Receipt, StickyNote, Trash2, Users, X } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';

/**
 * Student details fiche — extracted verbatim from AppModals.
 *
 * The view-only modal behind "view student record": profile card, the
 * general/parent/medical tab bar, the mini payment ledger with per-receipt
 * PDF download, the accounting sticky note (Notes ⇄ Calendar bridge: the date
 * picker is module-local state) and the edit / print / delete / close action
 * bar. Setters arrive as narrow callbacks (onClose/onEdit/onPrint/
 * onDeleteRequest) so this component stays presentational; the overlay root
 * ref (focus trap + escape stack) is injected as overlayRef.
 */
export interface StudentDetailsModalProps {
  student: Student;
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
  currentUser: { name?: string; role?: string; username?: string } | null;
  copyToClipboard: (text: string) => void;
  handleSaveNote: (studentId: string, note: string, noteDate?: string) => Promise<void>;
  studentDetailTab: 'general' | 'parent' | 'medical';
  setStudentDetailTab: Dispatch<SetStateAction<'general' | 'parent' | 'medical'>>;
  /** The dialog root — registered in AppModals' overlay refs for the focus trap. */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onDeleteRequest: () => void;
}

export function StudentDetailsModal(props: StudentDetailsModalProps) {
  const {
    student: selectedStudent, t, lang, currentTheme, formatDate, formatCurrency,
    getGradeDisplay, generatePaymentReceiptPdf, currentUser, copyToClipboard,
    handleSaveNote, studentDetailTab, setStudentDetailTab, overlayRef,
    onClose, onEdit, onPrint, onDeleteRequest,
  } = props;
  // Notes ⇄ Calendar bridge: optional date picked next to the sticky note.
  const [noteDateInput, setNoteDateInput] = useState('');
  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" aria-label={t.studentDetails} aria-labelledby="modal-title-student-details" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className={`relative ${currentTheme.card} w-full max-w-xl rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
      >
        {/* Header Banner */}
        <div className="h-24 relative" style={{ backgroundColor: currentTheme.header }}>
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Content */}
        <div className="px-10 pb-10 pt-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {/* --- Student Card Layout --- */}
          <div className={`flex flex-col sm:flex-row items-center gap-6 p-6 rounded-[2.5rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/5' : 'bg-slate-50/50'}`}>
            {/* Photo Placeholder / Image */}
            <div className={`w-28 h-28 flex-shrink-0 border-2 ${currentTheme.border} rounded-[2rem] overflow-hidden ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} flex items-center justify-center relative shadow-inner`}>
              {selectedStudent.photo ? (
                <img
                  src={selectedStudent.photo}
                  alt={selectedStudent.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="text-center">
                  <Users size={32} className="mx-auto mb-1" />
                  <span className="text-[9px] font-black uppercase tracking-widest">PHOTO</span>
                </div>
              )}
            </div>

            {/* Student Essential Text Details */}
            <div className="flex-1 text-center sm:text-left space-y-2">
              <div>
                {visibleStudentIdentifier(selectedStudent.grade, selectedStudent.studentId) && (
                  <span className={`text-[10px] ${currentTheme.muted} font-black uppercase tracking-widest font-mono`}>
                    {t.studentId}: {visibleStudentIdentifier(selectedStudent.grade, selectedStudent.studentId)}
                  </span>
                )}
                <h3 id="modal-title-student-details" className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
                  {selectedStudent.name}
                </h3>
              </div>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <span className="inline-block px-3 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 rounded-xl text-xs font-black uppercase tracking-wider">
                  {getGradeDisplay(selectedStudent.grade, lang)}
                </span>

                {/* Status badge: Green for Active, Blue for Graduated, Grey for Left */}
                {(() => {
                  const statusVal = selectedStudent.status || 'Active';
                  let badgeColors = 'text-emerald-700 bg-emerald-50 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60';
                  if (statusVal === 'Graduated') badgeColors = 'text-blue-700 bg-blue-50 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60';
                  if (statusVal === 'Left') badgeColors = 'text-slate-500 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
                  return (
                    <span className={`inline-block px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border ${badgeColors}`}>
                      {statusVal}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* --- Custom Tab Bar --- */}
          <div className="flex border-b border-slate-100 no-print gap-2">
            <button
              onClick={() => setStudentDetailTab('general')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'general'
                  ? 'border-blue-600 text-blue-600'
                  : `${currentTheme.muted} border-transparent hover:text-slate-600`
              }`}
            >
              {t.generalInfo}
            </button>
            <button
              onClick={() => setStudentDetailTab('parent')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'parent'
                  ? 'border-blue-600 text-blue-600'
                  : `${currentTheme.muted} border-transparent hover:text-slate-600`
              }`}
            >
              {t.parentEmergency}
            </button>
            <button
              onClick={() => setStudentDetailTab('medical')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'medical'
                  ? 'border-blue-600 text-blue-600'
                  : `${currentTheme.muted} border-transparent hover:text-slate-600`
              }`}
            >
              {t.medicalHistory}
            </button>
          </div>

          {/* --- Tab Panel Contents --- */}
          <div className="space-y-4">
            {studentDetailTab === 'general' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.enrollmentDate}</span>
                    <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                      {selectedStudent.enrollmentDate || '2026-07-16'}
                    </p>
                  </div>
                  <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.academicYear}</span>
                    <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                      {selectedStudent.academicYear || '2025-2026'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.totalDue}</span>
                    <p className={`text-xs font-extrabold ${currentTheme.muted} mt-1`}>
                      {formatCurrency(selectedStudent.totalDue)}
                    </p>
                  </div>
                  <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paid}</span>
                    <p className="text-xs font-extrabold text-emerald-600 mt-1">
                      {formatCurrency(selectedStudent.amountPaid)}
                    </p>
                  </div>
                  <div className={`p-4 bg-rose-50 dark:bg-rose-950/30 rounded-2xl text-center`}>
                    <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">{t.balance}</span>
                    <p className="text-xs font-black text-rose-600 mt-1">
                      {formatCurrency(selectedStudent.totalDue * (1 - (selectedStudent.scholarshipDiscount || 0) / 100) - selectedStudent.amountPaid)}
                    </p>
                  </div>
                </div>

                {/* Mini Payment Ledger */}
                <div className="space-y-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paymentHistoryLedger}</span>
                  <div className="space-y-2 max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                    {selectedStudent.payments.length > 0 ? (
                      [...selectedStudent.payments].reverse().map((p, idx) => (
                        <div key={`${p.date}-${p.amount}-${idx}`} className={`flex items-center justify-between p-3 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-xl text-xs`}>
                          <div className="flex flex-col">
                            <span className={currentTheme.muted}>{formatDate(p.date)}</span>
                            {p.receiptNumber && <span className="text-[10px] text-slate-400 font-mono">{t.receiptNoShort} {p.receiptNumber}</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-emerald-600">+{formatCurrency(p.amount)}</span>
                            <button
                              onClick={() => generatePaymentReceiptPdf({
                                student: selectedStudent,
                                payment: p,
                                lang,
                                cashierName: currentUser?.name || 'Administration'
                              })}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-1"
                              title={t.downloadReceiptPdf}
                            >
                              <Receipt size={12} /> {t.receipt2}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className={`text-xs ${currentTheme.muted} italic p-2`}>{t.noPayments}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {studentDetailTab === 'parent' && (
              <div className="space-y-4">
                {/* Guardian Info Card */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.guardianTitle}</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className={currentTheme.muted}>{t.parentName}</span>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentName}</p>
                    </div>
                    <div>
                      <span className={currentTheme.muted}>{t.phone}</span>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentPhone}</p>
                    </div>
                    <div className="col-span-2 border-t border-slate-100 pt-2 flex justify-between items-center">
                      <div>
                        <span className={currentTheme.muted}>{t.email}</span>
                        <p className={`font-semibold ${selectedStudent.parentEmail ? 'text-blue-600' : 'text-slate-400 italic text-xs'}`}>
                          {selectedStudent.parentEmail || (t.notProvided)}
                        </p>
                      </div>
                      {selectedStudent.parentEmail && (
                        <button
                          onClick={() => copyToClipboard(selectedStudent.parentEmail)}
                          className="p-2 hover:bg-blue-50 text-blue-500 rounded-lg transition-all"
                          title={t.copyEmail}
                        >
                          <Copy size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Emergency Contact Card */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                  <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{t.emergencyTitle}</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className={currentTheme.muted}>{t.contactName}</span>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                        {selectedStudent.emergencyContactName || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <span className={currentTheme.muted}>{t.relationshipLabel}</span>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                        {selectedStudent.emergencyContactRelation || 'N/A'}
                      </p>
                    </div>
                    <div className="col-span-2 border-t border-slate-100 pt-2">
                      <span className={currentTheme.muted}>{t.emergencyPhoneLabel}</span>
                      <p className="font-black text-rose-600 text-sm">
                        {selectedStudent.emergencyContactPhone || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {studentDetailTab === 'medical' && (
              <div className="space-y-4">
                {/* Previous School */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.previousSchoolHistory}</span>
                  <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                    {selectedStudent.previousSchool || (t.noneFirstEnrollmentEntry)}
                  </p>
                </div>

                {/* Medical Notes */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-rose-500">{t.medicalNotesTitle}</span>
                  <p className={`text-xs font-semibold ${currentTheme.isDark ? 'text-emerald-400/80' : 'text-slate-700'} mt-1 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700`}>
                    {selectedStudent.medicalNotes || 'None'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* --- Accounting Notes (Sticky Note) --- */}
          <div className="pt-2">
            <div className="bg-[#FEF9C3] p-6 rounded-[2rem] shadow-inner border border-yellow-200/50 relative transform rotate-1">
              <div className="absolute top-5 right-6 text-yellow-600/30">
                <StickyNote size={24} />
              </div>
              <h4 className="text-[9px] font-black text-yellow-900 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <FileText size={12} />
                {t.accountingNotes}
              </h4>
              <textarea
                defaultValue={selectedStudent.notes}
                onBlur={(e) => {
                  const d = noteDateInput || undefined;
                  void handleSaveNote(selectedStudent.id, e.target.value, d);
                  setNoteDateInput('');
                }}
                placeholder={t.notesPlaceholder}
                className="w-full bg-transparent border-none focus:ring-0 text-xs font-bold text-yellow-900 placeholder-yellow-700/40 resize-none min-h-[80px] custom-scrollbar"
              />
              <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-[9px] font-black text-yellow-800 uppercase tracking-widest">
                  <Calendar size={12} />
                  {t.alsoShowOnCalendar}
                  <input
                    type="date"
                    value={noteDateInput}
                    onChange={(e) => setNoteDateInput(e.target.value)}
                    className="ml-1 px-2 py-1 rounded-lg border border-yellow-300 dark:border-yellow-900/60 bg-white/80 dark:bg-slate-800 text-[10px] font-bold text-yellow-900 dark:text-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  />
                </label>
                <span className="text-[9px] font-black text-yellow-800/70 uppercase tracking-widest">
                  {selectedStudent.lastNoteDate ? `${t.lastUpdated}: ${formatDate(selectedStudent.lastNoteDate)}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* --- Bottom Actions Bar --- */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={onEdit}
              className="h-11 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <FileText size={16} className="flex-shrink-0" />
              <span className="truncate">{t.editProfile}</span>
            </button>

            <button
              onClick={onPrint}
              className="h-11 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Printer size={16} className="flex-shrink-0" />
              <span className="truncate">{t.printStudentFile}</span>
            </button>

            <button
              onClick={onDeleteRequest}
              className="h-11 px-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Trash2 size={16} className="flex-shrink-0" />
              <span className="truncate">{t.deleteStudent}</span>
            </button>

            <button
              onClick={onClose}
              className={`h-11 px-3 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-xs transition-all flex items-center justify-center whitespace-nowrap`}
            >
              {t.close}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
