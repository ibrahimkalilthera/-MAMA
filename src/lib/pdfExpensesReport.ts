import { jsPDF } from 'jspdf';
import type { Expense, VendorExpense } from './useSupabaseData';

export interface ExpensesReportOptions {
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  selectedYear: string;
  subTab?: 'general' | 'vendors' | 'all';
  selectedCategory?: string; // 'all' or category key/label
  selectedStatus?: string;   // 'all' | 'paid' | 'partial' | 'unpaid'
  searchQuery?: string;
  lang?: 'en' | 'fr';
}

const CATEGORY_LABELS_FR: Record<string, string> = {
  all: 'Toutes les catégories',
  Supplies: 'Fournitures',
  Fournitures: 'Fournitures',
  Utilities: 'Services Publics',
  'Services Publics': 'Services Publics',
  Maintenance: 'Maintenance & Entretien',
  Entretien: 'Maintenance & Entretien',
  Other: 'Autres charges',
  Autre: 'Autres charges',
  stationery: 'Fournitures & Papeterie',
  solar_energy: 'Panneaux Solaires & Batteries',
  electricity: 'Électricité EDM-SA',
  water: 'Entretien de forage',
  taxes: 'Impôts & Taxes',
  insurance: 'Assurances',
  security_maintenance: "Gardiennage & Entretien de l'établissement",
  security_guarding: 'Frais de gardiennage',
  facility_maintenance: "Entretien de l'établissement",
  works_renovation: 'Travaux et Aménagements',
  machine_management: 'Gestion Machine',
  reforestation: 'Reboisement & Espaces Verts',
  catering: 'Restauration & Cantine',
  training: 'Volet Formation',
  social_events: 'Événements Sociaux',
  exam_def: 'Dépenses liées au DEF',
  exam_bac: 'Dépenses liées au BAC',
  exams: 'Examens Nationaux (DEF & BAC)',
  furniture: 'Mobilier & Équipements',
  internet: 'Internet & Télécoms',
  cleaning: 'Nettoyage & Propreté',
  social_cases: 'Cas Sociaux & Aides',
};

const CATEGORY_LABELS_EN: Record<string, string> = {
  all: 'All Categories',
  Supplies: 'Supplies',
  Fournitures: 'Supplies',
  Utilities: 'Utilities',
  'Services Publics': 'Utilities',
  Maintenance: 'Maintenance',
  Entretien: 'Maintenance',
  Other: 'Other Expenses',
  Autre: 'Other Expenses',
  stationery: 'Supplies & Stationery',
  solar_energy: 'Solar Panels & Batteries',
  electricity: 'EDM-SA Electricity',
  water: 'Borehole Maintenance & Water',
  taxes: 'Taxes & Fiscal Duties',
  insurance: 'Insurance',
  security_maintenance: 'Guarding & Campus Maintenance',
  security_guarding: 'Security & Guarding Services',
  facility_maintenance: 'Campus & Facility Maintenance',
  works_renovation: 'Works & Improvements',
  machine_management: 'Machinery & Equipment Management',
  reforestation: 'Reforestation & Green Spaces',
  catering: 'Catering & Meals',
  training: 'Staff Training & Workshops',
  social_events: 'Social Events & Ceremonies',
  exam_def: 'DEF Examination Expenses',
  exam_bac: 'BAC Examination Expenses',
  exams: 'National Exams (DEF & BAC)',
  furniture: 'Furniture & Equipment',
  internet: 'Internet Providers',
  cleaning: 'Cleaning Services',
  social_cases: 'Welfare / Social Cases',
};

/**
 * Checks if an expense matches a category filter with bilingual tolerance.
 */
function matchesCategory(expenseCategory: string, filterCategory: string): boolean {
  if (!filterCategory || filterCategory === 'all') return true;
  const c1 = expenseCategory.trim().toLowerCase();
  const c2 = filterCategory.trim().toLowerCase();
  if (c1 === c2) return true;

  if ((c2 === 'supplies' || c2 === 'fournitures' || c2 === 'stationery') && (c1 === 'supplies' || c1 === 'fournitures' || c1 === 'stationery')) return true;
  if ((c2 === 'insurance' || c2 === 'assurances' || c2 === 'assurance') && (c1 === 'insurance' || c1 === 'assurances' || c1 === 'assurance')) return true;
  if ((c2 === 'security_maintenance' || c2 === 'security_guarding' || c2 === 'facility_maintenance' || c2 === 'gardiennage' || c2 === 'securite' || c2 === 'sécurité' || c2.includes('entretien de l\'etablissement') || c2.includes('gardiennage')) && 
      (c1 === 'security_maintenance' || c1 === 'security_guarding' || c1 === 'facility_maintenance' || c1.includes('gardien') || c1.includes('securit') || c1.includes('sécurit') || c1.includes('guard') || c1.includes('etablissement') || c1.includes('établissement'))) return true;
  if ((c2 === 'works_renovation' || c2 === 'travaux' || c2 === 'amenagements' || c2 === 'aménagements' || c2.includes('travaux') || c2.includes('amenagement')) && (c1 === 'works_renovation' || c1.includes('travaux') || c1.includes('amenag') || c1.includes('aménag') || c1.includes('renov') || c1.includes('work'))) return true;
  if ((c2 === 'machine_management' || c2 === 'gestion machine' || c2 === 'machine' || c2 === 'machines') && (c1 === 'machine_management' || c1.includes('machin') || c1.includes('equip') || c1.includes('appareil'))) return true;
  if ((c2 === 'reforestation' || c2 === 'reboisement' || c2 === 'arbres' || c2 === 'espaces verts') && (c1 === 'reforestation' || c1.includes('rebois') || c1.includes('arbre') || c1.includes('vert') || c1.includes('forest') || c1.includes('plant'))) return true;
  if ((c2 === 'taxes' || c2 === 'impots' || c2 === 'impôts' || c2 === 'fisc') && (c1 === 'taxes' || c1.includes('impot') || c1.includes('impôt') || c1.includes('taxe') || c1.includes('fisc'))) return true;
  if ((c2 === 'solar_energy' || c2 === 'panneaux' || c2 === 'batteries' || c2 === 'solaire') && (c1 === 'solar_energy' || c1.includes('solar') || c1.includes('panneau') || c1.includes('batteri') || c1.includes('solair'))) return true;
  if ((c2 === 'catering' || c2 === 'restauration' || c2 === 'cantine' || c2 === 'repas') && (c1 === 'catering' || c1.includes('restaur') || c1.includes('cantin') || c1.includes('repas') || c1.includes('cater'))) return true;
  if ((c2 === 'training' || c2 === 'formation' || c2 === 'atelier') && (c1 === 'training' || c1.includes('format') || c1.includes('train') || c1.includes('atelier') || c1.includes('seminair'))) return true;
  if ((c2 === 'social_events' || c2 === 'evenements' || c2 === 'événements' || c2 === 'ceremonie' || c2 === 'fete') && (c1 === 'social_events' || c1.includes('even') || c1.includes('évén') || c1.includes('fete') || c1.includes('fête') || c1.includes('ceremon'))) return true;
  if ((c2 === 'exam_def' || c2 === 'def') && (c1 === 'exam_def' || c1.includes('def'))) return true;
  if ((c2 === 'exam_bac' || c2 === 'bac') && (c1 === 'exam_bac' || c1.includes('bac'))) return true;
  if (c2 === 'exams' && (c1 === 'exams' || c1 === 'exam_def' || c1 === 'exam_bac' || c1.includes('exam') || c1.includes('def') || c1.includes('bac'))) return true;
  if ((c2 === 'water' || c2 === 'forage' || c2 === 'eau' || c2 === 'pompage') && (c1 === 'water' || c1.includes('forage') || c1.includes('eau') || c1.includes('somagep') || c1.includes('pomp'))) return true;
  if ((c2 === 'electricity' || c2 === 'electricite' || c2 === 'électricité' || c2 === 'edm') && (c1 === 'electricity' || c1.includes('electr') || c1.includes('électr') || c1.includes('edm'))) return true;
  if ((c2 === 'utilities' || c2 === 'services publics') && (c1 === 'utilities' || c1 === 'services publics' || c1 === 'electricity' || c1 === 'water')) return true;
  if ((c2 === 'maintenance' || c2 === 'entretien' || c2 === 'cleaning') && (c1 === 'maintenance' || c1 === 'entretien' || c1 === 'cleaning' || c1 === 'facility_maintenance')) return true;
  if ((c2 === 'other' || c2 === 'autre') && (c1 === 'other' || c1 === 'autre')) return true;
  if (c2 === 'social_cases' && (c1 === 'social_cases' || c1.includes('social') || c1.includes('aide'))) return true;

  return false;
}

/**
 * Generates an executive A4 Expenses & Operational Outflows PDF Report for Complexe Scolaire MAMA THERA.
 * Supports filtering by category, status, and sub-tabs.
 */
export function generateExpensesReportPdf({
  expenses,
  vendorExpenses,
  selectedYear,
  subTab = 'all',
  selectedCategory = 'all',
  selectedStatus = 'all',
  searchQuery = '',
  lang = 'fr',
}: ExpensesReportOptions): void {
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const categoryName = isFr
    ? (CATEGORY_LABELS_FR[selectedCategory] || selectedCategory)
    : (CATEGORY_LABELS_EN[selectedCategory] || selectedCategory);

  const isFilteredByCategory = selectedCategory && selectedCategory !== 'all';

  // 1. Filter General Expenses
  const filteredGeneralExpenses = expenses.filter(e => {
    if (selectedYear && e.academicYear && e.academicYear !== selectedYear) return false;
    if (isFilteredByCategory && !matchesCategory(e.category, selectedCategory)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchDesc = (e.description || '').toLowerCase().includes(q);
      const matchCat = (e.category || '').toLowerCase().includes(q);
      if (!matchDesc && !matchCat) return false;
    }
    return true;
  });

  // 2. Filter Vendor Expenses
  const filteredVendorExpenses = vendorExpenses.filter(v => {
    if (selectedYear && v.academicYear && v.academicYear !== selectedYear) return false;
    if (isFilteredByCategory && !matchesCategory(v.category, selectedCategory)) return false;
    if (selectedStatus && selectedStatus !== 'all' && v.paymentStatus !== selectedStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = (v.vendorName || '').toLowerCase().includes(q);
      const matchDesc = (v.description || '').toLowerCase().includes(q);
      const matchStudent = (v.beneficiaryStudentName || '').toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchStudent) return false;
    }
    return true;
  });

  const totalGeneral = filteredGeneralExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalVendorInvoiced = filteredVendorExpenses.reduce((sum, v) => sum + (v.amount || 0), 0);
  const totalVendorPaid = filteredVendorExpenses.reduce((sum, v) => {
    if (v.paymentStatus === 'paid') return sum + (v.amount || 0);
    if (v.paymentStatus === 'partial') return sum + (v.amountPaid || 0);
    return sum;
  }, 0);
  const totalVendorOutstanding = Math.max(0, totalVendorInvoiced - totalVendorPaid);
  const grandTotalOutflows = (subTab === 'general' ? totalGeneral : (subTab === 'vendors' ? totalVendorPaid : totalGeneral + totalVendorPaid));

  // 1. Header Banner
  doc.setFillColor(225, 29, 72); // rose-600
  doc.rect(0, 0, 210, 32, 'F');

  doc.setFillColor(159, 18, 57); // rose-900 thin accent
  doc.rect(0, 30, 210, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const filterSubtitle = isFilteredByCategory
    ? (isFr ? `FILTRE ACTIF : ${categoryName.toUpperCase()} — ANNÉE ${selectedYear}` : `FILTER APPLIED: ${categoryName.toUpperCase()} — YEAR ${selectedYear}`)
    : (isFr ? `RAPPORT GLOBAL DES CHARGES D'EXPLOITATION — ANNÉE ${selectedYear}` : `GLOBAL OPERATING OUTFLOWS REPORT — YEAR ${selectedYear}`);

  doc.text(filterSubtitle, 14, 20);

  doc.setFontSize(8);
  doc.text(
    subTab === 'general'
      ? (isFr ? 'Section: Dépenses Générales' : 'Section: General Expenses')
      : subTab === 'vendors'
      ? (isFr ? 'Section: Fournisseurs & Services' : 'Section: Vendors & Services')
      : (isFr ? 'Section: Toutes Dépenses' : 'Section: All Outflows'),
    14,
    27
  );

  doc.setFontSize(8.5);
  doc.text(`Bamako, Mali`, 196, 11, { align: 'right' });
  doc.text(`Édité le: ${todayStr}`, 196, 20, { align: 'right' });

  let y = 39;

  // 2. Executive KPI Cards (3 Summary Boxes)
  const boxWidth = 57;
  const boxHeight = 20;
  const gap = 5;
  let startX = 14;

  if (subTab === 'general') {
    // Card 1: Filtered General Total
    doc.setFillColor(255, 241, 242); // rose-50
    doc.setDrawColor(254, 205, 211);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(159, 18, 57);
    doc.text(isFr ? 'TOTAL DÉPENSES SÉLECTIONNÉES' : 'SELECTED EXPENSES TOTAL', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalGeneral), startX + 4, y + 14);

    // Card 2: Records Count
    startX += boxWidth + gap;
    doc.setFillColor(243, 244, 246);
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(31, 41, 55);
    doc.text(isFr ? 'NOMBRE D\'OPÉRATIONS' : 'NUMBER OF RECORDS', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(`${filteredGeneralExpenses.length} ${isFr ? 'entrées' : 'items'}`, startX + 4, y + 14);

    // Card 3: Filter Category Tag
    startX += boxWidth + gap;
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 95, 70);
    doc.text(isFr ? 'CATÉGORIE FILTRÉE' : 'FILTERED CATEGORY', startX + 4, y + 6);
    doc.setFontSize(9.5);
    doc.text(categoryName.length > 20 ? categoryName.slice(0, 18) + '...' : categoryName, startX + 4, y + 14);
  } else if (subTab === 'vendors') {
    // Card 1: Invoiced
    doc.setFillColor(243, 244, 246);
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(31, 41, 55);
    doc.text(isFr ? 'TOTAL FACTURÉ' : 'TOTAL INVOICED', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalVendorInvoiced), startX + 4, y + 14);

    // Card 2: Paid Portions
    startX += boxWidth + gap;
    doc.setFillColor(240, 253, 244); // emerald-50
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 95, 70);
    doc.text(isFr ? 'MONTANTS RÉGLÉS' : 'PAID PORTIONS', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalVendorPaid), startX + 4, y + 14);

    // Card 3: Outstanding Balance
    startX += boxWidth + gap;
    doc.setFillColor(254, 242, 242); // red-50
    doc.setDrawColor(254, 202, 202);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(153, 27, 27);
    doc.text(isFr ? 'SOLDE RESTANT DÛ' : 'OUTSTANDING BALANCE', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalVendorOutstanding), startX + 4, y + 14);
  } else {
    // Both General & Vendors
    doc.setFillColor(255, 241, 242);
    doc.setDrawColor(254, 205, 211);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(159, 18, 57);
    doc.text(isFr ? 'DÉPENSES GÉNÉRALES' : 'GENERAL EXPENSES', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalGeneral), startX + 4, y + 14);

    startX += boxWidth + gap;
    doc.setFillColor(243, 244, 246);
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(31, 41, 55);
    doc.text(isFr ? 'FOURNISSEURS RÉGLÉS' : 'VENDOR CHARGES PAID', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(totalVendorPaid), startX + 4, y + 14);

    startX += boxWidth + gap;
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
    doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(185, 28, 28);
    doc.text(isFr ? 'TOTAL DÉCAISSEMENTS' : 'TOTAL OUTFLOWS', startX + 4, y + 6);
    doc.setFontSize(10.5);
    doc.text(formatAmount(grandTotalOutflows), startX + 4, y + 14);
  }

  y += 28;

  // 3. Itemized Tables

  // Section A: General Expenses Log
  if (subTab === 'all' || subTab === 'general') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      isFr
        ? `1. Journal des Dépenses Générales ${isFilteredByCategory ? `[${categoryName}]` : ''}`
        : `1. General Expenses Log ${isFilteredByCategory ? `[${categoryName}]` : ''}`,
      14,
      y
    );
    y += 4;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(14, y + 7, 196, y + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(isFr ? 'DATE' : 'DATE', 18, y + 5);
    doc.text(isFr ? 'CATÉGORIE' : 'CATEGORY', 48, y + 5);
    doc.text(isFr ? 'DESCRIPTION / MOTIF' : 'DESCRIPTION', 95, y + 5);
    doc.text(isFr ? 'MONTANT (FCFA)' : 'AMOUNT (FCFA)', 190, y + 5, { align: 'right' });

    y += 7;

    if (filteredGeneralExpenses.length > 0) {
      filteredGeneralExpenses.forEach((exp, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        const isAlt = idx % 2 === 1;
        if (isAlt) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7.5, 196, y + 7.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(exp.date, 18, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(159, 18, 57);
        const catDisplay = isFr ? (CATEGORY_LABELS_FR[exp.category] || exp.category) : (CATEGORY_LABELS_EN[exp.category] || exp.category);
        doc.text(catDisplay, 48, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(exp.description ? (exp.description.length > 45 ? exp.description.slice(0, 42) + '...' : exp.description) : '—', 95, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(220, 38, 38);
        doc.text(formatAmount(exp.amount), 190, y + 5, { align: 'right' });

        y += 7.5;
      });

      // Total row for general expenses
      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 7.5, 'F');
      doc.setDrawColor(148, 163, 184);
      doc.line(14, y + 7.5, 196, y + 7.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(isFr ? 'SOUS-TOTAL DÉPENSES GÉNÉRALES' : 'SUBTOTAL GENERAL EXPENSES', 18, y + 5);
      doc.text(formatAmount(totalGeneral), 190, y + 5, { align: 'right' });
      y += 10;
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        isFr
          ? `Aucune dépense générale trouvée pour le filtre sélectionné (${categoryName}).`
          : `No general expenses found for the selected filter (${categoryName}).`,
        18,
        y + 6
      );
      y += 10;
    }

    y += 4;
  }

  // Section B: Vendor Expenses Log
  if (subTab === 'all' || subTab === 'vendors') {
    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      isFr
        ? `2. Fournisseurs, Services & Cas Sociaux ${isFilteredByCategory ? `[${categoryName}]` : ''}`
        : `2. Vendors, Services & Social Cases ${isFilteredByCategory ? `[${categoryName}]` : ''}`,
      14,
      y
    );
    y += 4;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(14, y + 7, 196, y + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(isFr ? 'FOURNISSEUR / BÉNÉFICIAIRE' : 'VENDOR / BENEFICIARY', 18, y + 5);
    doc.text(isFr ? 'CATÉGORIE' : 'CATEGORY', 80, y + 5);
    doc.text(isFr ? 'ÉCHÉANCE' : 'DUE DATE', 120, y + 5);
    doc.text(isFr ? 'STATUT' : 'STATUS', 150, y + 5);
    doc.text(isFr ? 'MONTANT (FCFA)' : 'AMOUNT (FCFA)', 190, y + 5, { align: 'right' });

    y += 7;

    if (filteredVendorExpenses.length > 0) {
      filteredVendorExpenses.forEach((ve, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        const isAlt = idx % 2 === 1;
        if (isAlt) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7.5, 196, y + 7.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        const nameText = ve.vendorName || ve.beneficiaryStudentName || '—';
        doc.text(nameText.length > 30 ? nameText.slice(0, 27) + '...' : nameText, 18, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        const vCatDisplay = isFr ? (CATEGORY_LABELS_FR[ve.category] || ve.category) : (CATEGORY_LABELS_EN[ve.category] || ve.category);
        doc.text(vCatDisplay, 80, y + 5);
        doc.text(ve.dueDate || '—', 120, y + 5);

        // Status badge text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        if (ve.paymentStatus === 'paid') {
          doc.setTextColor(5, 150, 105);
          doc.text(isFr ? 'Payé' : 'Paid', 150, y + 5);
        } else if (ve.paymentStatus === 'partial') {
          doc.setTextColor(217, 119, 6);
          doc.text(isFr ? 'Partiel' : 'Partial', 150, y + 5);
        } else {
          doc.setTextColor(220, 38, 38);
          doc.text(isFr ? 'Non payé' : 'Unpaid', 150, y + 5);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(formatAmount(ve.amount), 190, y + 5, { align: 'right' });

        y += 7.5;
      });

      // Total row for vendor expenses
      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 7.5, 'F');
      doc.setDrawColor(148, 163, 184);
      doc.line(14, y + 7.5, 196, y + 7.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(isFr ? 'SOUS-TOTAL FACTURÉ / RÉGLÉ' : 'SUBTOTAL INVOICED / PAID', 18, y + 5);
      doc.text(`${formatAmount(totalVendorPaid)} / ${formatAmount(totalVendorInvoiced)}`, 190, y + 5, { align: 'right' });
      y += 10;
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        isFr
          ? `Aucun engagement fournisseur ou cas social trouvé pour le filtre sélectionné (${categoryName}).`
          : `No vendor commitments or social cases found for the selected filter (${categoryName}).`,
        18,
        y + 6
      );
      y += 10;
    }
  }

  // 4. Signatures & Stamp Block
  if (y > 230) {
    doc.addPage();
    y = 25;
  } else {
    y = Math.max(y + 10, 235);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.text(isFr ? 'L\'Économe / Responsable Achats' : 'The Accountant / Purchasing Lead', 25, y);
  doc.text(isFr ? 'La Direction / Promotrice' : 'The Director / Promoter', 140, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(isFr ? 'Signature & Visa' : 'Signature & Verification', 25, y + 5);
  doc.text(isFr ? 'Approbation & Cachet' : 'Approval & Official Stamp', 140, y + 5);

  doc.setDrawColor(203, 213, 225);
  doc.line(25, y + 25, 80, y + 25);
  doc.line(140, y + 25, 190, y + 25);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Complexe Scolaire MAMA THERA — Bilan des Charges & Dépenses [${categoryName}] — ${todayStr}`,
    105,
    288,
    { align: 'center' }
  );

  // Trigger Save / Download
  const safeCatName = selectedCategory && selectedCategory !== 'all' ? `_${selectedCategory}` : '';
  const filename = `MAMA_THERA_Rapport_Depenses${safeCatName}_${selectedYear}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
