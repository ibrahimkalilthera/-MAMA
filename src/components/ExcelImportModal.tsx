/**
 * ExcelImportModal — 4-Step Interactive Import Wizard
 * 
 * Step 1: Upload & Auto-Detection
 * Step 2: Column Mapping & Preview
 * Step 3: Validation & Settings
 * Step 4: Execution & Summary
 */

import React, { useState, useCallback, useRef } from 'react';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useFocusTrap } from '../lib/focusStack';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import {
  parseFile,
  detectCategory,
  autoMapColumns,
  validateRows,
  CATEGORY_LABELS,
  TARGET_FIELDS,
  type ParsedSheet,
  type DetectionResult,
  type ColumnMapping,
  type ValidationResult,
  type ImportCategory,
} from '../lib/excelImporter';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'en' | 'fr';
  t: Record<string, string>;
  academicYears: string[];
  selectedYear: string;
  onImportComplete: (category: ImportCategory, records: Record<string, unknown>[], options: ImportOptions) => Promise<{ inserted: number; updated: number; errors: number }>;
  themeCard?: string;
  themeBorder?: string;
  themeMuted?: string;
  themeIsDark?: boolean;
}

export interface ImportOptions {
  academicYear: string;
  duplicateStrategy: 'skip' | 'update';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExcelImportModal({
  isOpen,
  onClose,
  lang,
  t: globalT,
  academicYears,
  selectedYear,
  onImportComplete,
  themeCard = 'bg-white',
  themeBorder = 'border-slate-200',
  themeMuted = 'text-slate-400',
  themeIsDark = false,
}: ExcelImportModalProps) {
  // Escape behaves like the cancel button (mounted only while open).
  useEscapeToClose(isOpen, onClose);
  // Tab is confined to the wizard; focus returns to the trigger on close.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(isOpen, () => rootRef.current);

  // ── Wizard state ──
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [selectedSheetIdx, setSelectedSheetIdx] = useState(0);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [category, setCategory] = useState<ImportCategory>('students');
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    academicYear: selectedYear,
    duplicateStrategy: 'skip',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; errors: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Reset wizard ──
  const resetWizard = useCallback(() => {
    setStep(1);
    setFile(null);
    setSheets([]);
    setSelectedSheetIdx(0);
    setDetection(null);
    setCategory('students');
    setMappings([]);
    setValidation(null);
    setImportResult(null);
    setIsProcessing(false);
    setIsParsing(false);
  }, []);

  // ── Step 1: File Processing ──
  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setIsParsing(true);

    try {
      const parsed = await parseFile(f);
      setSheets(parsed);

      if (parsed.length > 0) {
        const firstSheet = parsed[0];
        const result = detectCategory(firstSheet);
        setDetection(result);
        setCategory(result.category);
        setSelectedSheetIdx(0);
      }
    } catch (err) {
      console.error('File parse error:', err);
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };

  const handleSheetChange = (idx: number) => {
    setSelectedSheetIdx(idx);
    if (sheets[idx]) {
      const result = detectCategory(sheets[idx]);
      setDetection(result);
      setCategory(result.category);
    }
  };

  // ── Step 2: Column Mapping ──
  const proceedToMapping = () => {
    if (!sheets[selectedSheetIdx]) return;
    const sheet = sheets[selectedSheetIdx];
    const autoMapped = autoMapColumns(sheet.headers, category, sheet.rows.slice(0, 5));
    setMappings(autoMapped);
    setStep(2);
  };

  const updateMappingTarget = (excelColumn: string, newTarget: string) => {
    setMappings((prev) =>
      prev.map((m) => {
        if (m.excelColumn === excelColumn) {
          const fieldDef = TARGET_FIELDS[category].find((f) => f.field === newTarget);
          return {
            ...m,
            targetField: newTarget,
            fieldType: fieldDef?.type || 'text',
            required: fieldDef?.required || false,
          };
        }
        return m;
      })
    );
  };

  // ── Step 3: Validation ──
  const proceedToValidation = () => {
    const sheet = sheets[selectedSheetIdx];
    if (!sheet) return;
    const result = validateRows(sheet.rows, mappings, category);
    setValidation(result);
    setStep(3);
  };

  // ── Step 4: Execute Import ──
  const executeImport = async () => {
    if (!validation) return;
    setIsProcessing(true);
    setStep(4);

    try {
      const result = await onImportComplete(category, validation.validRows, importOptions);
      setImportResult(result);
    } catch (err) {
      setImportResult({ inserted: 0, updated: 0, errors: validation.validRows.length });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const t = {
    title: globalT.smartExcelImport,
    subtitle: globalT.autoDetectMapValidateImportYourData,
    step1: globalT.uploadDetect,
    step2: globalT.columnMapping,
    step3: globalT.validateSettings,
    step4: globalT.importResults,
    dragDrop: globalT.dragDropYourExcelOrCsvFileHere,
    browse: globalT.browseFiles,
    detected: globalT.autoDetectedCategory,
    confidence: globalT.confidence,
    sheet: globalT.sheet,
    rows: globalT.rows,
    next: globalT.next,
    back: globalT.back,
    import: globalT.startImport,
    close: globalT.close,
    cancel: globalT.cancel,
    excelCol: globalT.excelColumn,
    targetField: globalT.targetField,
    sample: globalT.sample,
    skip: globalT.skip,
    academicYear: globalT.academicYear2,
    duplicates: globalT.duplicateHandling,
    skipDuplicates: globalT.skipDuplicatesInsertNewOnly,
    updateExisting: globalT.updateExistingRecords,
    validRows: globalT.validRows,
    invalidRows: globalT.invalidRows,
    readyToImport: globalT.readyToImport,
    importing: globalT.importingData,
    success: globalT.importComplete,
    inserted: globalT.recordsInserted,
    updated: globalT.recordsUpdated,
    errors: globalT.errors,
    done: globalT.done,
    newImport: globalT.newImport,
    overrideCategory: globalT.overrideCategory,
    columns: globalT.columns,
    warnings: globalT.warnings,
    supportsXlsxXlsCsv: globalT.supportsXlsxXlsCsv,
    analyzingFileStructure: globalT.analyzingFileStructure,
    selectSheet: globalT.selectSheet,
    mappingColumnsFor: globalT.mappingColumnsFor,
    reviewTheAutoMappedColumnsBelowAdjustAnyMismatchedFieldsUsingTheDropdown: globalT.reviewTheAutoMappedColumnsBelowAdjustAnyMismatchedFieldsUsingTheDropdown,
    row: globalT.row,
  };

  const stepLabels = [t.step1, t.step2, t.step3, t.step4];

  const bgCard = themeIsDark ? 'bg-slate-900' : 'bg-white';
  const bgMuted = themeIsDark ? 'bg-white/5' : 'bg-slate-50';
  const textPrimary = themeIsDark ? 'text-white' : 'text-slate-900';
  const textSecondary = themeIsDark ? 'text-white/60' : 'text-slate-500';

  return (
    <div ref={rootRef} className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`relative w-full max-w-3xl ${bgCard} rounded-3xl border ${themeBorder} shadow-2xl overflow-hidden max-h-[90vh] flex flex-col`}
      >
        {/* Header */}
        <div className="p-6 bg-[#0F172A] text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <FileSpreadsheet size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">{t.title}</h3>
              <p className="text-[11px] text-white/50">{t.subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => { resetWizard(); onClose(); }}
            className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 bg-[#0F172A]/80 border-b border-white/5 flex items-center gap-1 flex-shrink-0">
          {stepLabels.map((label, i) => (
            <React.Fragment key={i}>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                step === i + 1
                  ? 'bg-blue-600 text-white shadow-sm'
                  : step > i + 1
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-white/30'
              }`}>
                {step > i + 1 ? <Check size={10} /> : <span>{i + 1}</span>}
                <span className="hidden sm:inline">{label}</span>
              </div>
              {i < 3 && <ArrowRight size={12} className="text-white/20 mx-0.5" />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <AnimatePresence mode="wait">
            {/* ─── STEP 1: Upload & Detect ─── */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                {/* Upload Zone */}
                {!file && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                      dragOver
                        ? 'border-blue-500 bg-blue-500/10'
                        : `${themeBorder} hover:border-blue-400 ${bgMuted}`
                    }`}
                  >
                    <Upload size={40} className={`mx-auto mb-4 ${dragOver ? 'text-blue-500' : themeMuted}`} />
                    <p className={`text-sm font-bold ${textPrimary} mb-2`}>{t.dragDrop}</p>
                    <p className={`text-xs ${textSecondary} mb-4`}>
                      {t.supportsXlsxXlsCsv}
                    </p>
                    <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all shadow-lg shadow-blue-600/20">
                      {t.browse}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                )}

                {/* Parsing indicator */}
                {isParsing && (
                  <div className={`${bgMuted} rounded-2xl p-8 text-center border ${themeBorder}`}>
                    <div className="w-8 h-8 border-3 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
                    <p className={`text-sm font-bold ${textPrimary}`}>
                      {t.analyzingFileStructure}
                    </p>
                  </div>
                )}

                {/* Detection Results */}
                {file && !isParsing && detection && (
                  <div className="space-y-4">
                    {/* File info */}
                    <div className={`flex items-center gap-3 p-4 ${bgMuted} rounded-2xl border ${themeBorder}`}>
                      <FileSpreadsheet size={24} className="text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold ${textPrimary} truncate`}>{file.name}</p>
                        <p className={`text-xs ${textSecondary}`}>
                          {sheets.length} {t.sheet}{sheets.length > 1 ? 's' : ''} • {detection.rowCount} {t.rows} • {detection.headers.length} {t.columns}
                        </p>
                      </div>
                      <button
                        onClick={() => { setFile(null); setSheets([]); setDetection(null); }}
                        className="p-2 hover:bg-white/10 rounded-lg text-rose-500 text-xs font-bold"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Sheet selector (if multiple) */}
                    {sheets.length > 1 && (
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                          {t.selectSheet}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {sheets.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => handleSheetChange(i)}
                              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                                selectedSheetIdx === i
                                  ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                                  : `${themeBorder} ${textSecondary} hover:bg-white/5`
                              }`}
                            >
                              {s.name} ({s.rows.length} {t.rows})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Auto-detection result */}
                    <div className={`p-5 rounded-2xl border-2 ${
                      detection.confidence >= 60 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{CATEGORY_LABELS[category].icon}</span>
                          <div>
                            <p className={`text-sm font-bold ${textPrimary}`}>{t.detected}</p>
                            <p className="text-xs font-bold text-emerald-500">
                              {CATEGORY_LABELS[category][lang]} — {t.confidence}: {detection.confidence}%
                            </p>
                          </div>
                        </div>
                        {detection.confidence >= 60 ? (
                          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <Check size={16} className="text-emerald-500" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                            <AlertCircle size={16} className="text-amber-500" />
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-3">
                        <div
                          className={`h-full rounded-full transition-all ${detection.confidence >= 60 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          style={{ width: `${detection.confidence}%` }}
                        />
                      </div>
                    </div>

                    {/* Category override */}
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
                        {t.overrideCategory}
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {(Object.keys(CATEGORY_LABELS) as ImportCategory[]).map((cat) => (
                          <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={`p-2.5 rounded-xl text-center border transition-all ${
                              category === cat
                                ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                                : `${themeBorder} hover:bg-white/5`
                            }`}
                          >
                            <span className="text-lg block">{CATEGORY_LABELS[cat].icon}</span>
                            <span className={`text-[10px] font-bold block mt-1 ${category === cat ? 'text-blue-500' : textSecondary}`}>
                              {CATEGORY_LABELS[cat][lang].split(' ')[0]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── STEP 2: Column Mapping ─── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className={`p-4 ${bgMuted} rounded-2xl border ${themeBorder}`}>
                  <p className={`text-xs font-bold ${textPrimary} mb-1`}>
                    {CATEGORY_LABELS[category].icon} {t.mappingColumnsFor} {CATEGORY_LABELS[category][lang]}
                  </p>
                  <p className={`text-[11px] ${textSecondary}`}>
                    {t.reviewTheAutoMappedColumnsBelowAdjustAnyMismatchedFieldsUsingTheDropdown}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`border-b ${themeBorder}`}>
                        <th className={`text-left py-2 px-3 font-black uppercase tracking-wider ${themeMuted} text-[10px]`}>{t.excelCol}</th>
                        <th className={`text-left py-2 px-3 font-black uppercase tracking-wider ${themeMuted} text-[10px]`}>{t.targetField}</th>
                        <th className={`text-left py-2 px-3 font-black uppercase tracking-wider ${themeMuted} text-[10px]`}>{t.sample}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m, i) => {
                        const fields = TARGET_FIELDS[category];
                        return (
                          <tr key={i} className={`border-b ${themeBorder} hover:${bgMuted}`}>
                            <td className={`py-2.5 px-3 font-bold ${textPrimary}`}>
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet size={14} className="text-blue-500 flex-shrink-0" />
                                <span className="truncate max-w-[140px]">{m.excelColumn}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <select
                                value={m.targetField}
                                onChange={(e) => updateMappingTarget(m.excelColumn, e.target.value)}
                                className={`w-full px-3 py-1.5 rounded-lg border ${themeBorder} text-xs font-bold ${
                                  m.targetField === '__skip__'
                                    ? 'text-slate-400 bg-white/5'
                                    : 'text-emerald-500 bg-emerald-500/5'
                                } focus:outline-none focus:ring-1 focus:ring-blue-500/30`}
                              >
                                <option value="__skip__">{t.skip}</option>
                                {fields.map((f) => (
                                  <option key={f.field} value={f.field}>
                                    {f.required ? '★ ' : ''}{f.label[lang]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={`py-2.5 px-3 ${textSecondary}`}>
                              <span className="truncate block max-w-[160px]">
                                {m.sampleValues.join(', ') || '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* ─── STEP 3: Validation & Settings ─── */}
            {step === 3 && validation && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* Validation Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-4 rounded-2xl border ${themeBorder} ${bgMuted}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-black uppercase tracking-wider ${themeMuted}`}>{t.validRows}</span>
                      <span className="text-xl font-black text-emerald-500">{validation.validRows.length}</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/10 rounded-full mt-2">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${(validation.validRows.length / Math.max(validation.totalRows, 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className={`p-4 rounded-2xl border ${themeBorder} ${bgMuted}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-black uppercase tracking-wider ${themeMuted}`}>{t.invalidRows}</span>
                      <span className={`text-xl font-black ${validation.invalidRows.length > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {validation.invalidRows.length}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/10 rounded-full mt-2">
                      <div
                        className="h-full bg-rose-500 rounded-full"
                        style={{ width: `${(validation.invalidRows.length / Math.max(validation.totalRows, 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {validation.warnings.length > 0 && (
                  <div className={`p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5`}>
                    <p className="text-xs font-bold text-amber-500 mb-2 flex items-center gap-1.5">
                      <AlertCircle size={14} /> {t.warnings} ({validation.warnings.length})
                    </p>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {validation.warnings.slice(0, 10).map((w, i) => (
                        <p key={i} className="text-[11px] text-amber-400/80">{w}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Invalid rows preview */}
                {validation.invalidRows.length > 0 && (
                  <div className={`p-4 rounded-2xl border border-rose-500/30 bg-rose-500/5`}>
                    <p className="text-xs font-bold text-rose-500 mb-2 flex items-center gap-1.5">
                      <AlertCircle size={14} /> {t.invalidRows} ({validation.invalidRows.length})
                    </p>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {validation.invalidRows.slice(0, 5).map((r) => (
                        <p key={r.rowIndex} className="text-[11px] text-rose-400/80">
                          {t.row} {r.rowIndex}: {r.errors.join(', ')}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.academicYear}</label>
                    <select
                      value={importOptions.academicYear}
                      onChange={(e) => setImportOptions((p) => ({ ...p, academicYear: e.target.value }))}
                      className={`w-full px-4 py-2.5 rounded-xl border ${themeBorder} ${bgMuted} text-xs font-bold ${textPrimary} focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
                    >
                      {academicYears.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>{t.duplicates}</label>
                    <select
                      value={importOptions.duplicateStrategy}
                      onChange={(e) => setImportOptions((p) => ({ ...p, duplicateStrategy: e.target.value as 'skip' | 'update' }))}
                      className={`w-full px-4 py-2.5 rounded-xl border ${themeBorder} ${bgMuted} text-xs font-bold ${textPrimary} focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
                    >
                      <option value="skip">{t.skipDuplicates}</option>
                      <option value="update">{t.updateExisting}</option>
                    </select>
                  </div>
                </div>

                {/* Ready banner */}
                {validation.validRows.length > 0 && (
                  <div className={`p-5 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 text-center`}>
                    <ShieldCheck size={24} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-black text-emerald-500">
                      {t.readyToImport}: {validation.validRows.length} {CATEGORY_LABELS[category][lang].toLowerCase()}
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── STEP 4: Execution & Results ─── */}
            {step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                {isProcessing ? (
                  <div className={`${bgMuted} rounded-2xl p-10 text-center border ${themeBorder}`}>
                    <div className="w-12 h-12 border-4 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto mb-5" />
                    <p className={`text-base font-black ${textPrimary} mb-2`}>{t.importing}</p>
                    <p className={`text-xs ${textSecondary}`}>
                      {CATEGORY_LABELS[category].icon} {validation?.validRows.length} {CATEGORY_LABELS[category][lang].toLowerCase()}
                    </p>
                  </div>
                ) : importResult ? (
                  <div className="space-y-5">
                    <div className={`p-8 rounded-2xl border-2 ${
                      importResult.errors === 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
                    } text-center`}>
                      <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg ${
                        importResult.errors === 0 ? 'bg-emerald-600 shadow-emerald-500/30' : 'bg-amber-600 shadow-amber-500/30'
                      }`}>
                        {importResult.errors === 0 ? <Check size={32} className="text-white" /> : <AlertCircle size={32} className="text-white" />}
                      </div>
                      <p className={`text-xl font-black ${importResult.errors === 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {t.success}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className={`p-4 ${bgMuted} rounded-2xl border ${themeBorder} text-center`}>
                        <p className="text-2xl font-black text-emerald-500">{importResult.inserted}</p>
                        <p className={`text-[10px] font-bold ${themeMuted} uppercase tracking-wider mt-1`}>{t.inserted}</p>
                      </div>
                      <div className={`p-4 ${bgMuted} rounded-2xl border ${themeBorder} text-center`}>
                        <p className="text-2xl font-black text-blue-500">{importResult.updated}</p>
                        <p className={`text-[10px] font-bold ${themeMuted} uppercase tracking-wider mt-1`}>{t.updated}</p>
                      </div>
                      <div className={`p-4 ${bgMuted} rounded-2xl border ${themeBorder} text-center`}>
                        <p className={`text-2xl font-black ${importResult.errors > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{importResult.errors}</p>
                        <p className={`text-[10px] font-bold ${themeMuted} uppercase tracking-wider mt-1`}>{t.errors}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t ${themeBorder} flex items-center justify-between flex-shrink-0 ${bgMuted}`}>
          <div>
            {step > 1 && step < 4 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className={`px-4 py-2 rounded-xl text-xs font-bold ${textSecondary} hover:${textPrimary} transition-all flex items-center gap-1.5`}
              >
                <ChevronLeft size={14} />
                {t.back}
              </button>
            )}
            {step === 4 && !isProcessing && (
              <button
                onClick={() => resetWizard()}
                className="px-4 py-2 rounded-xl text-xs font-bold text-blue-500 hover:text-blue-400 transition-all flex items-center gap-1.5"
              >
                <RefreshCw size={14} />
                {t.newImport}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step < 4 && (
              <button
                onClick={() => { resetWizard(); onClose(); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold ${textSecondary} hover:${textPrimary} transition-all`}
              >
                {t.cancel}
              </button>
            )}

            {step === 1 && file && !isParsing && (
              <button
                onClick={proceedToMapping}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95"
              >
                {t.next}
                <ChevronRight size={14} />
              </button>
            )}

            {step === 2 && (
              <button
                onClick={proceedToValidation}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95"
              >
                {t.next}
                <ChevronRight size={14} />
              </button>
            )}

            {step === 3 && validation && validation.validRows.length > 0 && (
              <button
                onClick={executeImport}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
              >
                <Upload size={14} />
                {t.import} ({validation.validRows.length})
              </button>
            )}

            {step === 4 && !isProcessing && (
              <button
                onClick={() => { resetWizard(); onClose(); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
              >
                <Check size={14} />
                {t.done}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
