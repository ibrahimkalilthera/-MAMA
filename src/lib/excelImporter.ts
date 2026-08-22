/**
 * Smart Excel Importer — Detection, Parsing, Normalization & Validation Engine
 * 
 * Analyzes uploaded Excel/CSV files to auto-detect data category
 * (Students, Payments, Parents, Staff, Expenses), maps columns to
 * database fields, normalizes values (FCFA, dates, phones), and
 * validates records before batch Supabase insertion.
 */

import * as XLSX from 'xlsx';

// ─── Data Categories ─────────────────────────────────────────────────────────

export type ImportCategory = 'students' | 'payments' | 'parents' | 'staff' | 'expenses';

export interface DetectionResult {
  category: ImportCategory;
  confidence: number; // 0–100
  sheetName: string;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, any>[];
}

export interface ColumnMapping {
  excelColumn: string;
  targetField: string;
  fieldType: 'text' | 'number' | 'date' | 'phone' | 'currency';
  required: boolean;
  sampleValues: string[];
}

export interface ValidationResult {
  validRows: Record<string, any>[];
  invalidRows: { rowIndex: number; row: Record<string, any>; errors: string[] }[];
  totalRows: number;
  warnings: string[];
}

export interface ImportRecord {
  [key: string]: any;
}

// ─── Category Detection Keywords (French + English) ──────────────────────────

const CATEGORY_KEYWORDS: Record<ImportCategory, { keywords: string[]; weight: number }[]> = {
  students: [
    { keywords: ['eleve', 'élève', 'student', 'apprenant'], weight: 10 },
    { keywords: ['classe', 'grade', 'niveau', 'class'], weight: 8 },
    { keywords: ['matricule', 'student_id', 'numero'], weight: 7 },
    { keywords: ['scolarite', 'scolarité', 'tuition', 'frais'], weight: 9 },
    { keywords: ['reduction', 'réduction', 'bourse', 'scholarship', 'discount'], weight: 6 },
    { keywords: ['nom_parent', 'parent_name', 'nom_pere', 'nom_mere'], weight: 5 },
    { keywords: ['inscription', 'enrollment', 'enregistrement'], weight: 5 },
  ],
  payments: [
    { keywords: ['paiement', 'payment', 'versement', 'reglement', 'règlement'], weight: 10 },
    { keywords: ['recu', 'reçu', 'receipt', 'numero_recu'], weight: 9 },
    { keywords: ['montant', 'amount', 'somme'], weight: 7 },
    { keywords: ['date_paiement', 'payment_date', 'date_versement'], weight: 8 },
    { keywords: ['solde', 'reste', 'balance', 'outstanding'], weight: 6 },
  ],
  parents: [
    { keywords: ['parent', 'tuteur', 'guardian', 'pere', 'père', 'mere', 'mère'], weight: 10 },
    { keywords: ['telephone', 'téléphone', 'phone', 'tel', 'mobile', 'contact'], weight: 7 },
    { keywords: ['adresse', 'address', 'quartier', 'commune'], weight: 6 },
    { keywords: ['profession', 'occupation', 'emploi', 'metier', 'métier'], weight: 6 },
    { keywords: ['relation', 'lien', 'relationship', 'parente', 'parenté'], weight: 5 },
  ],
  staff: [
    { keywords: ['personnel', 'employe', 'employé', 'employee', 'enseignant', 'professeur', 'teacher'], weight: 10 },
    { keywords: ['salaire', 'salary', 'remuneration', 'rémunération', 'paie'], weight: 9 },
    { keywords: ['poste', 'position', 'fonction', 'function', 'titre'], weight: 7 },
    { keywords: ['banque', 'bank', 'rib', 'compte'], weight: 5 },
    { keywords: ['urgence', 'emergency', 'contact_urgence'], weight: 4 },
  ],
  expenses: [
    { keywords: ['depense', 'dépense', 'expense', 'charge', 'cout', 'coût'], weight: 10 },
    { keywords: ['fournisseur', 'vendor', 'prestataire', 'supplier'], weight: 8 },
    { keywords: ['facture', 'invoice', 'bon'], weight: 7 },
    { keywords: ['categorie', 'catégorie', 'category', 'type_depense'], weight: 6 },
    { keywords: ['motif', 'description', 'objet', 'libelle', 'libellé'], weight: 5 },
  ],
};

// ─── Target Field Definitions ────────────────────────────────────────────────

export interface TargetFieldDef {
  field: string;
  label: { en: string; fr: string };
  type: 'text' | 'number' | 'date' | 'phone' | 'currency';
  required: boolean;
  aliases: string[]; // lowercase column names that map to this field
}

export const TARGET_FIELDS: Record<ImportCategory, TargetFieldDef[]> = {
  students: [
    { field: 'name', label: { en: 'Student Name', fr: 'Nom de l\'Élève' }, type: 'text', required: true, aliases: ['nom', 'name', 'eleve', 'élève', 'student', 'nom_eleve', 'nom_complet', 'full_name', 'apprenant', 'nom_prenom', 'nom et prenom', 'nom et prénom'] },
    { field: 'grade', label: { en: 'Grade / Class', fr: 'Classe / Niveau' }, type: 'text', required: false, aliases: ['classe', 'grade', 'class', 'niveau', 'section'] },
    { field: 'studentId', label: { en: 'Student ID', fr: 'Matricule' }, type: 'text', required: false, aliases: ['matricule', 'student_id', 'numero', 'id_eleve', 'identifiant'] },
    { field: 'parentName', label: { en: 'Parent Name', fr: 'Nom du Parent' }, type: 'text', required: false, aliases: ['parent', 'nom_parent', 'parent_name', 'pere', 'père', 'mere', 'mère', 'tuteur'] },
    { field: 'parentPhone', label: { en: 'Parent Phone', fr: 'Tél. Parent' }, type: 'phone', required: false, aliases: ['telephone', 'téléphone', 'phone', 'tel', 'mobile', 'tel_parent', 'contact', 'phone_parent'] },
    { field: 'parentEmail', label: { en: 'Parent Email', fr: 'Email Parent' }, type: 'text', required: false, aliases: ['email', 'e-mail', 'courriel', 'email_parent'] },
    { field: 'totalDue', label: { en: 'Total Tuition (XOF)', fr: 'Scolarité Totale (FCFA)' }, type: 'currency', required: false, aliases: ['scolarite', 'scolarité', 'tuition', 'frais', 'total_due', 'montant_total', 'frais_scolarite', 'total'] },
    { field: 'amountPaid', label: { en: 'Amount Paid', fr: 'Montant Payé' }, type: 'currency', required: false, aliases: ['paye', 'payé', 'paid', 'amount_paid', 'montant_paye', 'verse', 'versé'] },
    { field: 'scholarshipDiscount', label: { en: 'Scholarship %', fr: 'Bourse %' }, type: 'number', required: false, aliases: ['bourse', 'scholarship', 'reduction', 'réduction', 'discount', 'remise'] },
    { field: 'dueDate', label: { en: 'Due Date', fr: 'Date d\'Échéance' }, type: 'date', required: false, aliases: ['echeance', 'échéance', 'due_date', 'date_limite'] },
    { field: 'academicYear', label: { en: 'Academic Year', fr: 'Année Scolaire' }, type: 'text', required: false, aliases: ['annee', 'année', 'annee_scolaire', 'academic_year', 'year'] },
    { field: 'notes', label: { en: 'Notes', fr: 'Notes' }, type: 'text', required: false, aliases: ['notes', 'remarques', 'observations', 'commentaire'] },
  ],
  payments: [
    { field: 'studentName', label: { en: 'Student Name', fr: 'Nom de l\'Élève' }, type: 'text', required: true, aliases: ['nom', 'name', 'eleve', 'élève', 'student', 'nom_eleve'] },
    { field: 'amount', label: { en: 'Amount (XOF)', fr: 'Montant (FCFA)' }, type: 'currency', required: true, aliases: ['montant', 'amount', 'somme', 'versement', 'paiement'] },
    { field: 'date', label: { en: 'Payment Date', fr: 'Date du Paiement' }, type: 'date', required: true, aliases: ['date', 'date_paiement', 'payment_date', 'date_versement'] },
    { field: 'receiptNumber', label: { en: 'Receipt No.', fr: 'N° Reçu' }, type: 'text', required: false, aliases: ['recu', 'reçu', 'receipt', 'numero_recu', 'receipt_number', 'no_recu'] },
    { field: 'academicYear', label: { en: 'Academic Year', fr: 'Année Scolaire' }, type: 'text', required: false, aliases: ['annee', 'année', 'annee_scolaire', 'academic_year', 'year'] },
  ],
  parents: [
    { field: 'fullName', label: { en: 'Full Name', fr: 'Nom Complet' }, type: 'text', required: true, aliases: ['nom', 'name', 'nom_complet', 'full_name', 'parent', 'tuteur', 'nom_prenom', 'nom et prenom'] },
    { field: 'phone1', label: { en: 'Primary Phone', fr: 'Tél. Principal' }, type: 'phone', required: false, aliases: ['telephone', 'téléphone', 'phone', 'tel', 'mobile', 'contact', 'tel1', 'phone1'] },
    { field: 'phone2', label: { en: 'Secondary Phone', fr: 'Tél. Secondaire' }, type: 'phone', required: false, aliases: ['telephone2', 'téléphone2', 'phone2', 'tel2', 'mobile2', 'autre_tel'] },
    { field: 'email', label: { en: 'Email', fr: 'Email' }, type: 'text', required: false, aliases: ['email', 'e-mail', 'courriel', 'mail'] },
    { field: 'address', label: { en: 'Address', fr: 'Adresse' }, type: 'text', required: false, aliases: ['adresse', 'address', 'quartier', 'commune', 'lieu'] },
    { field: 'occupation', label: { en: 'Occupation', fr: 'Profession' }, type: 'text', required: false, aliases: ['profession', 'occupation', 'emploi', 'metier', 'métier', 'travail'] },
    { field: 'relationship', label: { en: 'Relationship', fr: 'Lien de Parenté' }, type: 'text', required: false, aliases: ['relation', 'lien', 'relationship', 'parente', 'parenté', 'lien_parental'] },
  ],
  staff: [
    { field: 'name', label: { en: 'Full Name', fr: 'Nom Complet' }, type: 'text', required: true, aliases: ['nom', 'name', 'nom_complet', 'full_name', 'employe', 'employé', 'enseignant', 'professeur'] },
    { field: 'position', label: { en: 'Position', fr: 'Poste / Fonction' }, type: 'text', required: false, aliases: ['poste', 'position', 'fonction', 'titre', 'role', 'rôle'] },
    { field: 'salary', label: { en: 'Monthly Salary (XOF)', fr: 'Salaire Mensuel (FCFA)' }, type: 'currency', required: false, aliases: ['salaire', 'salary', 'remuneration', 'rémunération', 'paie', 'montant'] },
    { field: 'email', label: { en: 'Email', fr: 'Email' }, type: 'text', required: false, aliases: ['email', 'e-mail', 'courriel', 'mail'] },
    { field: 'phone', label: { en: 'Phone', fr: 'Téléphone' }, type: 'phone', required: false, aliases: ['telephone', 'téléphone', 'phone', 'tel', 'mobile', 'contact'] },
    { field: 'bankDetails', label: { en: 'Bank Details', fr: 'Détails Bancaires' }, type: 'text', required: false, aliases: ['banque', 'bank', 'rib', 'compte', 'bank_details'] },
    { field: 'emergencyContact', label: { en: 'Emergency Contact', fr: 'Contact d\'Urgence' }, type: 'text', required: false, aliases: ['urgence', 'emergency', 'contact_urgence', 'emergency_contact'] },
  ],
  expenses: [
    { field: 'description', label: { en: 'Description', fr: 'Description / Motif' }, type: 'text', required: true, aliases: ['description', 'motif', 'objet', 'libelle', 'libellé', 'detail', 'détail'] },
    { field: 'amount', label: { en: 'Amount (XOF)', fr: 'Montant (FCFA)' }, type: 'currency', required: true, aliases: ['montant', 'amount', 'somme', 'cout', 'coût', 'total'] },
    { field: 'category', label: { en: 'Category', fr: 'Catégorie' }, type: 'text', required: false, aliases: ['categorie', 'catégorie', 'category', 'type', 'type_depense', 'nature'] },
    { field: 'date', label: { en: 'Date', fr: 'Date' }, type: 'date', required: false, aliases: ['date', 'date_depense', 'expense_date'] },
    { field: 'academicYear', label: { en: 'Academic Year', fr: 'Année Scolaire' }, type: 'text', required: false, aliases: ['annee', 'année', 'annee_scolaire', 'academic_year', 'year'] },
  ],
};

// ─── Normalization Utilities ─────────────────────────────────────────────────

/** Normalize a string for comparison: lowercase, strip accents, trim */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();
}

/** Parse an Excel date (serial number, DD/MM/YYYY, YYYY-MM-DD, etc.) */
export function parseExcelDate(val: any): string | null {
  if (val == null || val === '') return null;

  // Excel serial number
  if (typeof val === 'number' && val > 30000 && val < 100000) {
    const date = XLSX.SSF.parse_date_code(val);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const str = String(val).trim();

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  // YYYY-MM-DD (already correct)
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }

  // Try native parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1990) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

/** Parse a currency/number string: "150 000 FCFA" → 150000 */
export function parseCurrency(val: any): number | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return val;

  const str = String(val)
    .replace(/FCFA|CFA|XOF|F/gi, '')
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.\-]/g, '')
    .trim();

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/** Normalize a Malian phone number */
export function normalizePhone(val: any): string {
  if (val == null || val === '') return '';
  let str = String(val).replace(/[\s\-\(\)\.]/g, '');
  // Remove leading country code variations
  if (str.startsWith('+223')) str = str.slice(4);
  if (str.startsWith('00223')) str = str.slice(5);
  if (str.startsWith('223') && str.length > 10) str = str.slice(3);
  return str;
}

// ─── File Parsing ────────────────────────────────────────────────────────────

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

/** Parse an Excel/CSV file into sheets with headers and row data */
export function parseFile(file: File): Promise<ParsedSheet[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });

        const sheets: ParsedSheet[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
          const headers = json.length > 0 ? Object.keys(json[0]) : [];
          return { name, headers, rows: json };
        }).filter((s) => s.rows.length > 0);

        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Category Detection ──────────────────────────────────────────────────────

/** Score a set of headers against a category's keyword groups */
function scoreCategory(headers: string[], category: ImportCategory): number {
  const normalizedHeaders = headers.map(normalize);
  let score = 0;
  let matchCount = 0;

  for (const group of CATEGORY_KEYWORDS[category]) {
    for (const keyword of group.keywords) {
      const normKeyword = normalize(keyword);
      const match = normalizedHeaders.some(
        (h) => h.includes(normKeyword) || normKeyword.includes(h)
      );
      if (match) {
        score += group.weight;
        matchCount++;
        break; // only count each group once
      }
    }
  }

  // Normalize to 0–100
  const maxPossibleScore = CATEGORY_KEYWORDS[category].reduce((sum, g) => sum + g.weight, 0);
  return maxPossibleScore > 0 ? Math.round((score / maxPossibleScore) * 100) : 0;
}

/** Detect the most likely category for a parsed sheet */
export function detectCategory(sheet: ParsedSheet): DetectionResult {
  const scores: Record<ImportCategory, number> = {
    students: scoreCategory(sheet.headers, 'students'),
    payments: scoreCategory(sheet.headers, 'payments'),
    parents: scoreCategory(sheet.headers, 'parents'),
    staff: scoreCategory(sheet.headers, 'staff'),
    expenses: scoreCategory(sheet.headers, 'expenses'),
  };

  // Find highest score
  let bestCategory: ImportCategory = 'students';
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat as ImportCategory;
    }
  }

  return {
    category: bestCategory,
    confidence: bestScore,
    sheetName: sheet.name,
    headers: sheet.headers,
    rowCount: sheet.rows.length,
    sampleRows: sheet.rows.slice(0, 5),
  };
}

// ─── Column Mapping ──────────────────────────────────────────────────────────

/** Auto-map Excel columns to target fields for a given category */
export function autoMapColumns(
  headers: string[],
  category: ImportCategory,
  sampleRows: Record<string, any>[]
): ColumnMapping[] {
  const fields = TARGET_FIELDS[category];
  const mappings: ColumnMapping[] = [];
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const normHeader = normalize(header);
    let bestMatch: TargetFieldDef | null = null;
    let bestScore = 0;

    for (const fieldDef of fields) {
      if (usedTargets.has(fieldDef.field)) continue;

      for (const alias of fieldDef.aliases) {
        const normAlias = normalize(alias);
        // Exact match
        if (normHeader === normAlias) {
          bestMatch = fieldDef;
          bestScore = 100;
          break;
        }
        // Substring match
        if (normHeader.includes(normAlias) || normAlias.includes(normHeader)) {
          const score = 60 + (normAlias.length / normHeader.length) * 30;
          if (score > bestScore) {
            bestMatch = fieldDef;
            bestScore = score;
          }
        }
      }
      if (bestScore === 100) break;
    }

    // Gather sample values
    const sampleValues = sampleRows
      .slice(0, 3)
      .map((row) => String(row[header] ?? ''))
      .filter((v) => v !== '');

    if (bestMatch && bestScore >= 50) {
      usedTargets.add(bestMatch.field);
      mappings.push({
        excelColumn: header,
        targetField: bestMatch.field,
        fieldType: bestMatch.type,
        required: bestMatch.required,
        sampleValues,
      });
    } else {
      mappings.push({
        excelColumn: header,
        targetField: '__skip__',
        fieldType: 'text',
        required: false,
        sampleValues,
      });
    }
  }

  return mappings;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Validate and normalize rows using the column mapping */
export function validateRows(
  rows: Record<string, any>[],
  mappings: ColumnMapping[],
  category: ImportCategory
): ValidationResult {
  const validRows: Record<string, any>[] = [];
  const invalidRows: { rowIndex: number; row: Record<string, any>; errors: string[] }[] = [];
  const warnings: string[] = [];
  const fields = TARGET_FIELDS[category];
  const requiredFields = fields.filter((f) => f.required).map((f) => f.field);
  const activeMappings = mappings.filter((m) => m.targetField !== '__skip__');

  rows.forEach((row, idx) => {
    const normalized: Record<string, any> = {};
    const errors: string[] = [];

    for (const mapping of activeMappings) {
      const rawValue = row[mapping.excelColumn];

      switch (mapping.fieldType) {
        case 'currency': {
          const parsed = parseCurrency(rawValue);
          if (parsed != null) {
            normalized[mapping.targetField] = parsed;
          } else if (rawValue != null && String(rawValue).trim() !== '') {
            errors.push(`Invalid currency value for "${mapping.excelColumn}": "${rawValue}"`);
          }
          break;
        }
        case 'date': {
          const parsed = parseExcelDate(rawValue);
          if (parsed) {
            normalized[mapping.targetField] = parsed;
          } else if (rawValue != null && String(rawValue).trim() !== '') {
            // Don't fail on dates, just use raw string
            normalized[mapping.targetField] = String(rawValue).trim();
            warnings.push(`Row ${idx + 1}: Could not parse date "${rawValue}" for "${mapping.excelColumn}"`);
          }
          break;
        }
        case 'number': {
          const num = parseCurrency(rawValue); // reuse parser
          if (num != null) {
            normalized[mapping.targetField] = num;
          } else if (rawValue != null && String(rawValue).trim() !== '') {
            normalized[mapping.targetField] = 0;
          }
          break;
        }
        case 'phone': {
          normalized[mapping.targetField] = normalizePhone(rawValue);
          break;
        }
        default: {
          normalized[mapping.targetField] = rawValue != null ? String(rawValue).trim() : '';
          break;
        }
      }
    }

    // Check required fields
    for (const req of requiredFields) {
      const val = normalized[req];
      if (val == null || val === '' || val === 0) {
        errors.push(`Missing required field: "${req}"`);
      }
    }

    if (errors.length === 0 && Object.keys(normalized).length > 0) {
      validRows.push(normalized);
    } else if (Object.keys(normalized).length > 0) {
      invalidRows.push({ rowIndex: idx + 1, row: normalized, errors });
    }
  });

  // Trim duplicate warnings
  const uniqueWarnings = [...new Set(warnings)].slice(0, 20);

  return { validRows, invalidRows, totalRows: rows.length, warnings: uniqueWarnings };
}

// ─── Category Labels ─────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<ImportCategory, { en: string; fr: string; icon: string }> = {
  students: { en: 'Students & Enrollment', fr: 'Élèves & Inscriptions', icon: '🎓' },
  payments: { en: 'Payments & Receipts', fr: 'Paiements & Encaissements', icon: '💳' },
  parents: { en: 'Parent Directory', fr: 'Annuaire Parents', icon: '👨‍👩‍👧' },
  staff: { en: 'Staff & Payroll', fr: 'Personnel & Salaires', icon: '👔' },
  expenses: { en: 'Expenses & Purchases', fr: 'Dépenses & Achats', icon: '🧾' },
};
