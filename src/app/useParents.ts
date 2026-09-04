/**
 * Parents domain hook — extracted verbatim from App.tsx (states + submit/link/
 * unlink/delete handlers + relational helpers + notify/reminder + PDF export).
 *
 * External dependencies are injected as props so the hook stays a pure
 * container of domain logic: Supabase mutators and data (`students`/`setStudents`,
 * `addParent`, `updateParent`, `deleteParent`, `updateStudent`), the auth-welcome
 * banner (`setWelcomeMessage`), the shared global confirm dialog
 * (`setConfirmAction` — owned by App.tsx, shared with other delete flows),
 * plus `t`, `lang` and `formatCurrency`.
 *
 * Everything the views consume is returned (byte-identical prop wiring in
 * App.tsx): parent CRUD state, link-student modal state, notify modal state
 * and handlers, relational helpers, and the ledger PDF exporter.
 */
import { useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { TranslationDict } from '../i18n/translations';
import type { Language, Parent, Student } from './types';
import { visibleStudentIdentifier } from '../lib/studentIdentifiers';
import { drawSchoolStamp } from '../lib/pdfStamp';

export interface UseParentsArgs {
  t: TranslationDict;
  lang: Language;
  formatCurrency: (amount: number) => string;
  students: Student[];
  setStudents: Dispatch<SetStateAction<Student[]>>;
  addParent: (parent: Omit<Parent, 'id'>) => Promise<Parent | null>;
  updateParent: (id: string, updates: Partial<Parent>) => Promise<boolean>;
  deleteParent: (id: string) => Promise<boolean>;
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
  setWelcomeMessage: (msg: string | null) => void;
  setConfirmAction: (action: { title: string; message: string; confirmLabel: string; onConfirm: () => void } | null) => void;
}

export function useParents({
  t,
  lang,
  formatCurrency,
  students,
  setStudents,
  addParent,
  updateParent,
  deleteParent,
  updateStudent,
  setWelcomeMessage,
  setConfirmAction,
}: UseParentsArgs) {
  // Parent Directory States
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [parentSearchTerm, setParentSearchTerm] = useState('');
  const [showParentModal, setShowParentModal] = useState(false);
  const [editingParent, setEditingParent] = useState<Parent | null>(null);
  const [parentForm, setParentForm] = useState({
    fullName: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    address: '',
    occupation: '',
    relationship: 'Father',
    notes: '',
    linkedStudentIds: [] as string[]
  });
  const [showLinkStudentModal, setShowLinkStudentModal] = useState(false);
  const [activeLinkingParent, setActiveLinkingParent] = useState<Parent | null>(null);
  const [studentToLinkId, setStudentToLinkId] = useState<string>('');
  const [parentChildrenSortBy, setParentChildrenSortBy] = useState<'highest_balance' | 'alphabetical'>('highest_balance');

  // Notify / Payment Reminder Modal States
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyParent, setNotifyParent] = useState<Parent | null>(null);
  const [notifySelectedPhone, setNotifySelectedPhone] = useState<string>('');
  const [notifyTemplateType, setNotifyTemplateType] = useState<'polite' | 'urgent' | 'detailed'>('polite');
  const [notifyCustomText, setNotifyCustomText] = useState<string>('');
  const [copiedToast, setCopiedToast] = useState(false);

  const buildReminderText = (
    parent: Parent,
    children: Student[],
    totalOutstanding: number,
    type: 'polite' | 'urgent' | 'detailed',
    language: 'en' | 'fr'
  ) => {
    const schoolName = 'Complexe Scolaire Mama Thera';
    const overdueChildren = children.filter(c => c.totalDue > c.amountPaid);
    const childrenNames = (overdueChildren.length > 0 ? overdueChildren : children).map(c => c.name).join(', ');

    if (language === 'fr') {
      if (type === 'urgent') {
        return `*RAPPEL URGENT - ${schoolName}*\n\nCher/Chère ${parent.fullName},\n\nNous vous informons que les frais de scolarité pour (${childrenNames}) présentent un solde impayé de *${formatCurrency(totalOutstanding)}*.\n\nMerci de bien vouloir effectuer le règlement sous 48h ou de contacter le service financier de l'établissement.\n\nCordialement,\nLa Direction - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Classe'}): Reste ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*SITUATION FINANCIÈRE DE LA FAMILLE - ${schoolName}*\n\nParent : ${parent.fullName}\n\nDétail des impayés par enfant :\n${breakdown}\n\n*TOTAL Reste à Payer : ${formatCurrency(totalOutstanding)}*\n\nMerci de contacter la comptabilité pour régulariser ces frais.`;
      } else {
        return `*RAPPEL DE SCOLARITÉ - ${schoolName}*\n\nBonjour M/Mme ${parent.fullName},\n\nSauf erreur de notre part, le paiement des frais de scolarité de ${childrenNames} présente un solde restant de *${formatCurrency(totalOutstanding)}*.\n\nNous vous prions de bien vouloir procéder au règlement dès que possible.\n\nMerci de votre confiance,\nService Comptabilité - ${schoolName}`;
      }
    } else {
      if (type === 'urgent') {
        return `*URGENT TUITION NOTICE - ${schoolName}*\n\nDear ${parent.fullName},\n\nPlease be advised that the overdue tuition balance for (${childrenNames}) is *${formatCurrency(totalOutstanding)}*.\n\nKindly complete the payment within 48 hours or contact our finance department.\n\nSincerely,\nManagement - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Grade'}): Outstanding ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*FAMILY TUITION STATEMENT - ${schoolName}*\n\nParent: ${parent.fullName}\n\nOutstanding breakdown per child:\n${breakdown}\n\n*TOTAL OUTSTANDING BALANCE: ${formatCurrency(totalOutstanding)}*\n\nPlease reach out to the school accountant for any questions.`;
      } else {
        return `*TUITION REMINDER - ${schoolName}*\n\nDear ${parent.fullName},\n\nThis is a friendly reminder regarding the tuition balance of *${formatCurrency(totalOutstanding)}* for ${childrenNames}.\n\nWe kindly invite you to settle this balance at your earliest convenience.\n\nBest regards,\nAccounting Office - ${schoolName}`;
      }
    }
  };

  const openNotifyModal = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    setNotifyParent(parent);
    setNotifySelectedPhone(parent.phones[0] || '');
    setNotifyTemplateType('polite');
    const text = buildReminderText(parent, children, totalOutstanding, 'polite', lang);
    setNotifyCustomText(text);
    setShowNotifyModal(true);
  };

  const handleNotifyTemplateChange = (newType: 'polite' | 'urgent' | 'detailed') => {
    setNotifyTemplateType(newType);
    if (notifyParent) {
      const children = getChildrenForParent(notifyParent);
      const totalOutstanding = getParentOutstandingBalance(notifyParent);
      const text = buildReminderText(notifyParent, children, totalOutstanding, newType, lang);
      setNotifyCustomText(text);
    }
  };

  const handleSendWhatsApp = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(notifyCustomText)}`;
    window.open(url, '_blank');
  };

  const handleSendSMS = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9+]/g, '');
    const url = `sms:${cleanPhone}?body=${encodeURIComponent(notifyCustomText)}`;
    window.location.href = url;
  };

  const handleCopyNotifyMessage = () => {
    navigator.clipboard.writeText(notifyCustomText);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 3000);
  };

  // Parent Relational Helpers
  const getChildrenForParent = (parent: Parent) => {
    return students.filter(s =>
      s.parentId === parent.id ||
      (!s.parentId && s.parentName.trim().toLowerCase() === parent.fullName.trim().toLowerCase()) ||
      (s.parentEmail && parent.email && s.parentEmail.trim().toLowerCase() === parent.email.trim().toLowerCase())
    );
  };

  const getParentOutstandingBalance = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    return children.reduce((sum, child) => sum + Math.max(0, child.totalDue - child.amountPaid), 0);
  };

  const getParentPaymentHistory = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const ledger: {
      receiptNumber: string;
      studentName: string;
      studentId: string;
      date: string;
      amount: number;
      academicYear?: string;
    }[] = [];

    children.forEach(child => {
      (child.payments || []).forEach((p, idx) => {
        ledger.push({
          receiptNumber: p.receiptNumber || `REC-${child.id}-${idx + 1}`,
          studentName: child.name,
          studentId: visibleStudentIdentifier(child.grade, child.studentId) || '',
          date: p.date,
          amount: p.amount,
          academicYear: p.academicYear
        });
      });
    });

    return ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const handleExportParentLedgerPdf = async (parent: Parent) => {
    const { jsPDF } = await import('jspdf');
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    const paymentHistory = getParentPaymentHistory(parent);
    const totalPaymentsEver = paymentHistory.reduce((sum, item) => sum + item.amount, 0);
    const hasNinthGradeChild = children.some(child => Boolean(visibleStudentIdentifier(child.grade, child.studentId)));
    const studentNameX = hasNinthGradeChild ? 50 : 18;
    const gradeX = hasNinthGradeChild ? 105 : 75;
    const totalDueX = hasNinthGradeChild ? 135 : 125;
    const balanceX = hasNinthGradeChild ? 165 : 160;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const isFr = lang === 'fr';
    const currencySuffix = ' FCFA';
    const formatPdfAmount = (val: number) => val.toLocaleString('fr-FR') + currencySuffix;

    // Header band
    doc.setFillColor(5, 150, 105); // emerald-600
    doc.rect(0, 0, 210, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(t.consolidatedFamilyStatementLedger, 14, 20);

    // Date & Reference
    const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.setFontSize(9);
    doc.text(`${t.pdfDateColon} ${todayStr}`, 196, 12, { align: 'right' });
    doc.text(`REF: LEDGER-${parent.id.toUpperCase()}`, 196, 20, { align: 'right' });

    let y = 36;

    // Parent Info Block
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, 182, 32, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${t.parentGuardian2}: ${parent.fullName}`, 18, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${t.relationship2}: ${parent.relationship}`, 18, y + 15);
    doc.text(`${t.phone2}: ${parent.phones.join(' / ')}`, 18, y + 21);
    doc.text(`${t.address}: ${parent.address}`, 18, y + 27);

    doc.text(`${t.occupation}: ${parent.occupation}`, 115, y + 15);
    doc.text(`${t.email2} ${parent.email || 'N/A'}`, 115, y + 21);

    y += 40;

    // Summary Financial Banner Box
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(14, y, 182, 18, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.cumulativePaymentsMade, 18, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalPaymentsEver), 18, y + 14);

    doc.setFontSize(9);
    doc.setTextColor(153, 27, 27);
    doc.text(t.outstandingBalance, 115, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalOutstanding), 115, y + 14);

    y += 24;

    // Section 1: Linked Children Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(t.n1LinkedStudents, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    if (hasNinthGradeChild) doc.text(t.studentId, 18, y + 5);
    doc.text(t.fullName, studentNameX, y + 5);
    doc.text(t.grade, gradeX, y + 5);
    doc.text(t.totalDue2, totalDueX, y + 5);
    doc.text(t.balance2, balanceX, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (children.length === 0) {
      doc.text(t.noLinkedStudents, 18, y + 5);
      y += 8;
    } else {
      children.forEach((child) => {
        const remaining = Math.max(0, child.totalDue - child.amountPaid);
        const studentIdentifier = visibleStudentIdentifier(child.grade, child.studentId);
        if (hasNinthGradeChild && studentIdentifier) doc.text(studentIdentifier, 18, y + 5);
        doc.text(child.name.substring(0, 26), studentNameX, y + 5);
        doc.text(child.grade || '-', gradeX, y + 5);
        doc.text(formatPdfAmount(child.totalDue), totalDueX, y + 5);
        doc.text(formatPdfAmount(remaining), balanceX, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
      y += 4;
    }

    y += 6;

    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    // Section 2: Payment Receipts History Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(t.n2ConsolidatedPaymentReceipts, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(t.receipt, 18, y + 5);
    doc.text(t.pdfDate, 48, y + 5);
    doc.text(t.student, 75, y + 5);
    doc.text(t.year, 125, y + 5);
    doc.text(t.amount2, 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (paymentHistory.length === 0) {
      doc.text(t.noPaymentRecordsFound, 18, y + 5);
      y += 8;
    } else {
      paymentHistory.forEach((item) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y, 182, 7, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          doc.text(t.receipt, 18, y + 5);
          doc.text(t.pdfDate, 48, y + 5);
          doc.text(t.student, 75, y + 5);
          doc.text(t.year, 125, y + 5);
          doc.text(t.amount2, 165, y + 5);
          y += 7;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
        }

        doc.text(item.receiptNumber || 'REC', 18, y + 5);
        doc.text(item.date || '', 48, y + 5);
        doc.text((item.studentName || '').substring(0, 24), 75, y + 5);
        doc.text(item.academicYear || '-', 125, y + 5);
        doc.text(formatPdfAmount(item.amount), 165, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
    }

    y += 2;
    doc.setFillColor(236, 253, 245);
    doc.rect(14, y, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.totalCumulativePaymentsRecorded, 18, y + 5.5);
    doc.text(formatPdfAmount(totalPaymentsEver), 165, y + 5.5);

    // Official school stamp — always BELOW the content so it can never hide
    // anything (history rows, dates, footer): 10 mm under the totals row, the
    // footer note pushed below the stamp. A nearly-full page moves the whole
    // stamp block to a fresh page instead of overlapping content.
    y += 10;
    const STAMP_DIAMETER = 22;
    let stampCy = y + STAMP_DIAMETER / 2;
    if (stampCy + STAMP_DIAMETER / 2 + 8 > 289) {
      doc.addPage();
      stampCy = 30;
    }
    await drawSchoolStamp(doc, 105, stampCy, STAMP_DIAMETER);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.officialElectronicDocumentGeneratedByExecutiveFinanceComplexeScolaireMamaThera,
      105,
      stampCy + STAMP_DIAMETER / 2 + 6,
      { align: 'center' }
    );

    const safeName = parent.fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Releve_Parent_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleParentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parentForm.fullName.trim()) return;

    const parentData = {
      fullName: parentForm.fullName.trim(),
      phones: [parentForm.primaryPhone.trim(), parentForm.secondaryPhone.trim()].filter(Boolean),
      email: parentForm.email.trim() || undefined,
      address: parentForm.address.trim() || 'N/A',
      occupation: parentForm.occupation.trim() || 'N/A',
      relationship: parentForm.relationship || 'Guardian',
      notes: parentForm.notes.trim() || undefined,
    };

    let newParentId: string | null = null;
    let createdParent: Parent | null = null;
    let saved: boolean;
    if (editingParent) {
      saved = await updateParent(editingParent.id, parentData);
    } else {
      createdParent = await addParent(parentData);
      saved = !!createdParent;
      newParentId = createdParent?.id ?? null;
    }
    if (!saved) return;

    // If students were selected in the form, link them all to the newly created parent.
    // Stop on the first failed update so we do not falsely confirm a partial linkage.
    let linkedStudentCount = 0;
    if (!editingParent && newParentId && parentForm.linkedStudentIds.length > 0) {
      for (const studentId of parentForm.linkedStudentIds) {
        const linked = await updateStudent(studentId, {
          parentId: newParentId,
          parentName: parentData.fullName,
          parentPhone: parentData.phones[0] || '',
          parentEmail: parentData.email || '',
        });
        if (!linked) {
          setWelcomeMessage(`Parent créé, mais seulement ${linkedStudentCount}/${parentForm.linkedStudentIds.length} élève(s) lié(s).`);
          setTimeout(() => setWelcomeMessage(null), 6000);
          break;
        }
        linkedStudentCount += 1;
      }
    }

    const resetParentForm = () => setParentForm({
      fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: 'Father', notes: '', linkedStudentIds: []
    });

    if (editingParent) {
      setStudents(prev => prev.map(s => s.parentId === editingParent.id ? {
        ...s,
        parentName: parentData.fullName,
        parentPhone: parentData.phones[0] || s.parentPhone,
        parentEmail: parentData.email || s.parentEmail
      } : s));
      setShowParentModal(false);
      setEditingParent(null);
      resetParentForm();
    } else if (createdParent && linkedStudentCount > 0) {
      // Keep the modal open in "fiche" view so the user can visually confirm the linked students
      setEditingParent(createdParent);
      setParentForm({
        fullName: createdParent.fullName,
        primaryPhone: createdParent.phones[0] || '',
        secondaryPhone: createdParent.phones[1] || '',
        email: createdParent.email || '',
        address: createdParent.address,
        occupation: createdParent.occupation,
        relationship: createdParent.relationship,
        notes: createdParent.notes || '',
        linkedStudentIds: [],
      });
    } else {
      setShowParentModal(false);
      setEditingParent(null);
      resetParentForm();
    }
  };

  const handleLinkStudentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeLinkingParent || !studentToLinkId) return;

    const updated = await updateStudent(studentToLinkId, {
      parentId: activeLinkingParent.id,
      parentName: activeLinkingParent.fullName,
      parentPhone: activeLinkingParent.phones[0] || '',
      parentEmail: activeLinkingParent.email || '',
    });
    if (!updated) return;

    setShowLinkStudentModal(false);
    setActiveLinkingParent(null);
    setStudentToLinkId('');
  };

  const handleUnlinkStudent = async (studentId: string) => {
    await updateStudent(studentId, { parentId: undefined });
  };

  const handleDeleteParent = async (parentId: string) => {
    setConfirmAction({
      title: t.deleteParent,
      message: t.confirmDeleteParent,
      confirmLabel: t.deleteParent,
      onConfirm: async () => {
        const deleted = await deleteParent(parentId);
        if (deleted) {
          setStudents(prev => prev.map(s => s.parentId === parentId ? { ...s, parentId: undefined } : s));
        }
      },
    });
  };

  const openEditParentModal = (parent: Parent) => {
    setEditingParent(parent);
    setParentForm({
      fullName: parent.fullName,
      primaryPhone: parent.phones[0] || '',
      secondaryPhone: parent.phones[1] || '',
      email: parent.email || '',
      address: parent.address,
      occupation: parent.occupation,
      relationship: parent.relationship,
      notes: parent.notes || '',
      linkedStudentIds: []
    });
    setShowParentModal(true);
  };

  return {
    expandedParentId, setExpandedParentId,
    parentSearchTerm, setParentSearchTerm,
    showParentModal, setShowParentModal,
    editingParent, setEditingParent,
    parentForm, setParentForm,
    showLinkStudentModal, setShowLinkStudentModal,
    activeLinkingParent, setActiveLinkingParent,
    studentToLinkId, setStudentToLinkId,
    parentChildrenSortBy, setParentChildrenSortBy,
    showNotifyModal, setShowNotifyModal,
    notifyParent, setNotifyParent,
    notifySelectedPhone, setNotifySelectedPhone,
    notifyTemplateType, setNotifyTemplateType,
    notifyCustomText, setNotifyCustomText,
    copiedToast, setCopiedToast,
    buildReminderText,
    openNotifyModal,
    handleNotifyTemplateChange,
    handleSendWhatsApp,
    handleSendSMS,
    handleCopyNotifyMessage,
    getChildrenForParent,
    getParentOutstandingBalance,
    getParentPaymentHistory,
    handleExportParentLedgerPdf,
    handleParentSubmit,
    handleLinkStudentSubmit,
    handleUnlinkStudent,
    handleDeleteParent,
    openEditParentModal,
  };
}
