/**
 * useExcelImportWizard — state + handlers of the 4-step Excel import wizard.
 *
 * Extracted verbatim from ExcelImportModal (split campaign, no behavior
 * change): the modal keeps its rendering, this hook owns the wizard logic —
 * file parsing, category detection, column mapping, validation and the final
 * import execution.
 */
import { useCallback, useRef, useState } from 'react';
import {
  parseFile,
  detectCategory,
  autoMapColumns,
  validateRows,
  TARGET_FIELDS,
  type ParsedSheet,
  type DetectionResult,
  type ColumnMapping,
  type ValidationResult,
  type ImportCategory,
} from '../lib/excelImporter';

/** Duplicate/update strategy chosen on the validation step. */
export interface ImportOptions {
  academicYear: string;
  duplicateStrategy: 'skip' | 'update';
}

export interface UseExcelImportWizardDeps {
  selectedYear: string;
  onImportComplete: (
    category: ImportCategory,
    records: Record<string, unknown>[],
    options: ImportOptions,
  ) => Promise<{ inserted: number; updated: number; errors: number }>;
}

export function useExcelImportWizard({ selectedYear, onImportComplete }: UseExcelImportWizardDeps) {
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

  const proceedToValidation = () => {
    const sheet = sheets[selectedSheetIdx];
    if (!sheet) return;
    const result = validateRows(sheet.rows, mappings, category);
    setValidation(result);
    setStep(3);
  };

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

  return {
    step,
    setStep,
    file,
    setFile,
    sheets,
    setSheets,
    selectedSheetIdx,
    setSelectedSheetIdx,
    detection,
    setDetection,
    category,
    setCategory,
    mappings,
    setMappings,
    validation,
    setValidation,
    importOptions,
    setImportOptions,
    isProcessing,
    isParsing,
    importResult,
    setImportResult,
    dragOver,
    setDragOver,
    fileInputRef,
    resetWizard,
    processFile,
    handleFileChange,
    handleDrop,
    handleSheetChange,
    proceedToMapping,
    updateMappingTarget,
    proceedToValidation,
    executeImport,
  };
}