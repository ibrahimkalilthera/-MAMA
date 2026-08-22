import React, { useState, useMemo } from 'react';
import { Student } from '../lib/useSupabaseData';
import { X, ArrowRight, CheckCircle2, GraduationCap, AlertCircle, RefreshCw, Layers, Users } from 'lucide-react';

interface PromotionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  availableAcademicYears: string[];
  currentAcademicYear: string;
  onPromote: (
    promotions: Array<{
      studentId: string;
      action: 'promote' | 'repeat' | 'graduate' | 'leave';
      targetGrade?: string;
      targetAcademicYear: string;
      newTotalDue?: number;
    }>
  ) => Promise<boolean>;
  language?: 'fr' | 'en';
}

const DEFAULT_GRADE_PROGRESSION: Record<string, string> = {
  'Maternelle Petite Section': 'Maternelle Moyenne Section',
  'Maternelle Moyenne Section': 'Maternelle Grande Section',
  'Maternelle Grande Section': '1ère Année',
  '1ère Année': '2ème Année',
  '2ème Année': '3ème Année',
  '3ème Année': '4ème Année',
  '4ème Année': '5ème Année',
  '5ème Année': '6ème Année',
  '6ème Année': '7ème Année',
  '7ème Année': '8ème Année',
  '8ème Année': '9ème Année',
  '9ème Année': 'Seconde',
  'Seconde': 'Première',
  'Première': 'Terminales',
  'Terminales': 'Diplômé',
};

export const PromotionWizardModal: React.FC<PromotionWizardModalProps> = ({
  isOpen,
  onClose,
  students,
  availableAcademicYears,
  currentAcademicYear,
  onPromote,
  language = 'fr',
}) => {
  const isFr = language === 'fr';

  // Step 1: Configuration
  const [sourceYear, setSourceYear] = useState<string>(currentAcademicYear || '2025-2026');
  const [targetYear, setTargetYear] = useState<string>('2026-2027');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [targetGrade, setTargetGrade] = useState<string>('');
  const [newTuitionFee, setNewTuitionFee] = useState<string>('150000');

  // Step 2: Student Actions state { [studentId]: 'promote' | 'repeat' | 'graduate' | 'leave' }
  const [studentActions, setStudentActions] = useState<Record<string, 'promote' | 'repeat' | 'graduate' | 'leave'>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Available grades present in the selected source year
  const availableGrades = useMemo(() => {
    const gradesSet = new Set<string>();
    students.forEach(s => {
      if (s.grade && (s.academicYear === sourceYear || !s.academicYear)) {
        gradesSet.add(s.grade);
      }
    });
    return Array.from(gradesSet).sort();
  }, [students, sourceYear]);

  // Students in selected grade and source year
  const filteredStudents = useMemo(() => {
    if (!selectedGrade) return [];
    return students.filter(
      s => s.grade === selectedGrade && (s.academicYear === sourceYear || !s.academicYear) && s.status !== 'Graduated' && s.status !== 'Left'
    );
  }, [students, selectedGrade, sourceYear]);

  // Handle grade selection & auto-suggest target grade
  const handleGradeChange = (grade: string) => {
    setSelectedGrade(grade);
    const suggested = DEFAULT_GRADE_PROGRESSION[grade] || grade;
    setTargetGrade(suggested);
    
    // Initialize student actions to default 'promote' (or 'graduate' if Terminales)
    const initialActions: Record<string, 'promote' | 'repeat' | 'graduate' | 'leave'> = {};
    students.filter(s => s.grade === grade && (s.academicYear === sourceYear || !s.academicYear)).forEach(s => {
      initialActions[s.id] = grade === 'Terminales' ? 'graduate' : 'promote';
    });
    setStudentActions(initialActions);
  };

  const handleSelectAllAction = (action: 'promote' | 'repeat' | 'graduate' | 'leave') => {
    const updated: Record<string, 'promote' | 'repeat' | 'graduate' | 'leave'> = {};
    filteredStudents.forEach(s => {
      updated[s.id] = action;
    });
    setStudentActions(updated);
  };

  const handleSubmit = async () => {
    if (!targetYear || !selectedGrade) return;
    setIsSubmitting(true);
    setSuccessMessage(null);

    const promotionsList = filteredStudents.map(s => {
      const action = studentActions[s.id] || 'promote';
      return {
        studentId: s.id,
        action: action,
        targetGrade: action === 'repeat' ? selectedGrade : targetGrade,
        targetAcademicYear: targetYear,
        newTotalDue: action === 'promote' || action === 'repeat' ? Number(newTuitionFee) || s.totalDue : undefined,
      };
    });

    const ok = await onPromote(promotionsList);
    setIsSubmitting(false);

    if (ok) {
      setSuccessMessage(
        isFr
          ? `Passage de classe effectué avec succès pour ${promotionsList.length} élève(s) !`
          : `Class promotion completed successfully for ${promotionsList.length} student(s)!`
      );
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden transition-all my-8">
        
        {/* Header */}
        <div className="p-6 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-xl">
              <GraduationCap className="w-7 h-7 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {isFr ? "Passage de Classe & Réinscription" : "Class Promotion & Re-enrollment Wizard"}
              </h2>
              <p className="text-xs text-emerald-100">
                {isFr ? "Complexe Scolaire MAMA THERA — Transition d'Année Scolaire" : "MAMA THERA School — Academic Year Transition"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-full transition-colors text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">

          {successMessage && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-xl text-emerald-800 dark:text-emerald-200 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold text-sm">{successMessage}</span>
            </div>
          )}

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            
            {/* Source Year */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isFr ? "Année d'Origine" : "Source Academic Year"}
              </label>
              <select
                value={sourceYear}
                onChange={e => setSourceYear(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
              >
                {availableAcademicYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>

            {/* Select Grade to Promote */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isFr ? "Classe à Promouvoir" : "Class to Promote"}
              </label>
              <select
                value={selectedGrade}
                onChange={e => handleGradeChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-emerald-500 font-medium text-emerald-700 dark:text-emerald-400"
              >
                <option value="">{isFr ? "-- Sélectionner la Classe --" : "-- Select Grade --"}</option>
                {availableGrades.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Target Year */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isFr ? "Nouvelle Année Scolaire" : "Target Academic Year"}
              </label>
              <select
                value={targetYear}
                onChange={e => setTargetYear(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
              >
                {availableAcademicYears.concat(['2026-2027', '2027-2028']).filter((v, i, a) => a.indexOf(v) === i).map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>

          </div>

          {selectedGrade && (
            <div className="space-y-4">
              
              {/* Promotion Mapping Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-emerald-50 dark:bg-slate-800 border border-emerald-200 dark:border-slate-700 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-emerald-700 text-white text-xs font-bold rounded-full">
                    {selectedGrade}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {isFr ? "Cible :" : "Target:"}
                    </span>
                    <input
                      type="text"
                      value={targetGrade}
                      onChange={e => setTargetGrade(e.target.value)}
                      className="px-2 py-1 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded font-semibold text-emerald-700 dark:text-emerald-400"
                      placeholder="Nouvelle classe"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {isFr ? "Frais Scolarité (FCFA) :" : "New Tuition (FCFA):"}
                  </label>
                  <input
                    type="number"
                    value={newTuitionFee}
                    onChange={e => setNewTuitionFee(e.target.value)}
                    className="w-32 px-2 py-1 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded font-mono text-slate-800 dark:text-slate-200"
                    placeholder="e.g. 150000"
                  />
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {filteredStudents.length} {isFr ? "Élève(s) dans la classe" : "Student(s) in class"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{isFr ? "Appliquer à tous :" : "Apply to all:"}</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAllAction('promote')}
                    className="px-2 py-1 text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded font-medium hover:bg-emerald-200 transition-colors"
                  >
                    🟢 {isFr ? "Promouvoir Tous" : "Promote All"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllAction('repeat')}
                    className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded font-medium hover:bg-amber-200 transition-colors"
                  >
                    🟠 {isFr ? "Redoubler Tous" : "Repeat All"}
                  </button>
                </div>
              </div>

              {/* Student Roster Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold sticky top-0">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">{isFr ? "Nom de l'Élève" : "Student Name"}</th>
                      <th className="p-3">{isFr ? "Parent / Contact" : "Parent / Contact"}</th>
                      <th className="p-3">{isFr ? "Paiement (Origine)" : "Source Payment"}</th>
                      <th className="p-3 text-right">{isFr ? "Décision du Conseil" : "Action Decision"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {filteredStudents.map((st, idx) => {
                      const isPaidFull = st.amountPaid >= st.totalDue && st.totalDue > 0;
                      const action = studentActions[st.id] || 'promote';

                      return (
                        <tr key={st.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="p-3 font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-3 font-medium text-slate-800 dark:text-slate-100">{st.name}</td>
                          <td className="p-3 text-slate-500">{st.parentName || st.parentPhone || 'N/A'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                              isPaidFull ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}>
                              {st.amountPaid.toLocaleString()} / {st.totalDue.toLocaleString()} FCFA
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <select
                              value={action}
                              onChange={e => setStudentActions(prev => ({ ...prev, [st.id]: e.target.value as any }))}
                              className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded font-semibold focus:ring-2 focus:ring-emerald-500"
                            >
                              <option value="promote">🟢 {isFr ? "Promouvoir" : "Promote"}</option>
                              <option value="repeat">🟠 {isFr ? "Redoubler" : "Repeat"}</option>
                              <option value="graduate">🎓 {isFr ? "Diplômé" : "Graduate"}</option>
                              <option value="leave">🔴 {isFr ? "Quitter l'École" : "Left"}</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-6 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 transition-colors"
          >
            {isFr ? "Annuler" : "Cancel"}
          </button>

          <button
            type="button"
            disabled={!selectedGrade || filteredStudents.length === 0 || isSubmitting}
            onClick={handleSubmit}
            className="px-6 py-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-lg transition-all flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {isFr ? "Traitement..." : "Processing..."}
              </>
            ) : (
              <>
                <GraduationCap className="w-4 h-4" />
                {isFr ? "Appliquer le Passage de Classe" : "Process Batch Promotion"}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
