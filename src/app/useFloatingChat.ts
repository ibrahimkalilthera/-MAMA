/**
 * Floating AI chat domain hook — extracted verbatim from App.tsx.
 *
 * Owns everything chat-AI: both assistant surfaces (the Productivité AI-tab
 * `handleAiQuery` and the floating widget `handleFloatingAiQuery`), their
 * message/input state, the greeting re-seed effect and the Escape wiring of
 * the floating panel. App.tsx only consumes the returned API.
 *
 * Call-site note: the hook takes `stats`/`formatCurrency`/`formatDate` as
 * arguments, so App.tsx must call it after those are declared.
 */
import { useEffect, useState } from 'react';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';
import type { DashboardStats } from './mainViewsProps';
import type { Student, Staff, SalaryPayment, Expense, VendorExpense } from '../lib/useSupabaseData';
import { useEscapeToClose } from '../lib/useEscapeToClose';

export type ChatMessage = { sender: 'user' | 'assistant'; text: string };

interface FloatingChatDeps {
  lang: 'en' | 'fr';
  t: TranslationDict;
  stats: DashboardStats;
  students: Student[];
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  formatCurrency: (value: number) => string;
  formatDate: (dateStr: string) => string;
}

export function useFloatingChat(deps: FloatingChatDeps) {
  const { lang, t, stats, students, staff, salaryPayments, expenses, vendorExpenses, formatCurrency, formatDate } = deps;

  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([
    { sender: 'assistant', text: 'Hello! I am your Mama Thera Finance Assistant. How can I assist you with calculations or school statistics today?' }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [floatingChatMessages, setFloatingChatMessages] = useState<ChatMessage[]>([]);
  const [floatingChatInput, setFloatingChatInput] = useState('');

  // Seed the greeting whenever the chat is empty — including right after a
  // language switch, since the translated text itself is the dependency.
  useEffect(() => {
    if (floatingChatMessages.length === 0) {
      setFloatingChatMessages([
        {
          sender: 'assistant',
          text: t.helloIAmYourMamaTheraFinanceAssistantHowCanIAssistYouWithSchoolStatisticsTodayYouCanAskMeFinancialQuestionsOrClickOneOfTheQuickOptionsBelow
        }
      ]);
    }
  }, [floatingChatMessages.length, t.helloIAmYourMamaTheraFinanceAssistantHowCanIAssistYouWithSchoolStatisticsTodayYouCanAskMeFinancialQuestionsOrClickOneOfTheQuickOptionsBelow]);

  // Escape closes the floating chat panel (keyboard consistency with modals).
  useEscapeToClose(isFloatingChatOpen, () => setIsFloatingChatOpen(false));

  const handleAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;

    const userMsg: ChatMessage = { sender: 'user', text: queryText };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');

    const query = queryText.toLowerCase();
    let responseText = '';

    const isFrench = lang === 'fr';
    const currentMonth = new Date().getMonth();

    if (query.includes('balance') || query.includes('solde') || query.includes('caisse') || query.includes('cash') || query.includes('liquidity') || query.includes('liquidit')) {
      const balance = stats.totalFees - stats.totalExpenses;
      const income = stats.collectedMonth;
      const expensesVal = stats.expensesThisMonth;
      const template = isFrench ? translations.fr.aiResponseBalance : translations.en.aiResponseBalance;
      responseText = template
        .replace('{balance}', formatCurrency(balance))
        .replace('{income}', formatCurrency(income))
        .replace('{expenses}', formatCurrency(expensesVal));
    } else if (query.includes('overdue') || query.includes('late') || query.includes('retard') || query.includes('unpaid') || query.includes('debt') || query.includes('impaye') || query.includes('dette') || query.includes('non pay')) {
      const count = stats.lateParentsCount;
      const amount = stats.totalOutstanding;
      const template = isFrench ? translations.fr.aiResponseOverdue : translations.en.aiResponseOverdue;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{amount}', formatCurrency(amount));
    } else if (query.includes('expense') || query.includes('depense') || query.includes('outflow') || query.includes('sorti')) {
      const expensesVal = stats.expensesThisMonth;
      const categories = isFrench
        ? "papeterie, électricité, eau, cas sociaux et salaires"
        : "stationery, electricity, water, social cases, and salaries";
      const template = isFrench ? translations.fr.aiResponseExpenses : translations.en.aiResponseExpenses;
      responseText = template
        .replace('{expenses}', formatCurrency(expensesVal))
        .replace('{categories}', categories);
    } else if (query.includes('payroll') || query.includes('salary') || query.includes('salaire') || query.includes('paie') || query.includes('personnel') || query.includes('employee') || query.includes('staff')) {
      const count = staff.length;
      const totalSalaries = staff.reduce((acc, s) => acc + s.salary, 0);
      const unpaidCount = staff.filter(s => {
        const paidThisMonth = salaryPayments
          .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
          .reduce((sum, p) => sum + p.amount, 0);
        return paidThisMonth < s.salary;
      }).length;
      const template = isFrench ? translations.fr.aiResponsePayroll : translations.en.aiResponsePayroll;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{salary}', formatCurrency(totalSalaries))
        .replace('{unpaidCount}', unpaidCount.toString());
    } else {
      responseText = isFrench ? translations.fr.aiNoData : translations.en.aiNoData;
    }

    setTimeout(() => {
      setAiMessages(prev => [...prev, { sender: 'assistant', text: responseText }]);
    }, 400);
  };

  const handleFloatingAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;

    const userMsg: ChatMessage = { sender: 'user', text: queryText };
    setFloatingChatMessages(prev => [...prev, userMsg]);
    setFloatingChatInput('');

    const query = queryText.toLowerCase().trim();
    let responseText = '';
    const isFrench = lang === 'fr';

    // 1. "How much tuition was collected this month?" / "Combien de frais de scolarité ont été collectés ce mois-ci ?"
    const isTuitionQuery =
      query.includes('tuition') ||
      query.includes('collected') ||
      query.includes('scolarité') ||
      query.includes('scolarite') ||
      query.includes('collecté') ||
      query.includes('collecte');

    // 2. "Which parents still owe school fees?" / "Quels parents doivent encore des frais de scolarité ?"
    const isParentsOweQuery =
      query.includes('parent') && (query.includes('owe') || query.includes('redevable') || query.includes('doit') || query.includes('doivent') || query.includes('dette') || query.includes('outstanding') || query.includes('impayé') || query.includes('impaye'));

    // 3. "Show all expenses for June." / "Afficher toutes les dépenses pour juin."
    const isExpensesJuneQuery =
      (query.includes('expense') || query.includes('dépense') || query.includes('depense')) && (query.includes('june') || query.includes('juin') || query.includes('06'));

    // 4. "How much money do we currently have in cash?" / "Combien d'argent avons-nous actuellement en caisse ?"
    const isCashQuery =
      query.includes('cash') ||
      query.includes('caisse') ||
      query.includes('liquid') ||
      query.includes('argent') ||
      query.includes('money');

    // 5. "Which students haven't paid the second installment?" / "Quels élèves n'ont pas payé la deuxième tranche ?"
    const isSecondInstallmentQuery =
      query.includes('second') ||
      query.includes('deuxième') ||
      query.includes('deuxieme') ||
      query.includes('installment') ||
      query.includes('tranche') ||
      query.includes('versement');

    // 6. "Generate this month's financial report." / "Générer le rapport financier de ce mois-ci."
    const isReportQuery =
      query.includes('report') ||
      query.includes('rapport') ||
      query.includes('bilan') ||
      query.includes('generate') ||
      query.includes('générer') ||
      query.includes('generer');

    if (isSecondInstallmentQuery) {
      const partialStudentsList = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return s.amountPaid > 0 && s.amountPaid < discountedTotal;
      });

      if (partialStudentsList.length > 0) {
        if (isFrench) {
          responseText = `Les élèves suivants ont effectué un paiement partiel (premier versement) mais n'ont pas encore réglé leur deuxième versement :\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent : ${s.parentName}) : Payé ${formatCurrency(s.amountPaid)} sur ${formatCurrency(discountedTotal)} (Reste : ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        } else {
          responseText = `The following students have made a partial payment (first installment) but have not yet paid their second installment:\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent: ${s.parentName}): Paid ${formatCurrency(s.amountPaid)} of ${formatCurrency(discountedTotal)} (Owes: ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench
          ? "Aucun élève n'est actuellement répertorié avec un statut de paiement partiel (tous sont soit non-payés, soit entièrement payés)."
          : "No students are currently registered with partial payment statuses (all are either unpaid or fully paid).";
      }

    } else if (isParentsOweQuery) {
      const debtors = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return (discountedTotal - s.amountPaid) > 0;
      });

      if (debtors.length > 0) {
        if (isFrench) {
          responseText = `Voici les parents qui doivent encore des frais de scolarité :\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Élève : ${s.name}) : reste dû **${formatCurrency(remaining)}** (Date limite : ${formatDate(s.dueDate)})`;
            }).join('\n');
        } else {
          responseText = `The following parents still owe school fees:\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Student: ${s.name}): **${formatCurrency(remaining)}** outstanding (Due date: ${formatDate(s.dueDate)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench
          ? "Excellente nouvelle ! Tous les parents sont à jour dans leurs paiements."
          : "Great news! All parents are fully up to date with their school fees.";
      }

    } else if (isExpensesJuneQuery) {
      const juneExpensesList = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === 5; // June is 5
      });
      const juneVendorExpensesList = vendorExpenses.filter(v => {
        const d = new Date(v.dueDate);
        return d.getMonth() === 5;
      });

      const totalGeneral = juneExpensesList.reduce((sum, e) => sum + e.amount, 0);
      const totalVendor = juneVendorExpensesList.reduce((sum, v) => sum + v.amount, 0);

      if (juneExpensesList.length > 0 || juneVendorExpensesList.length > 0) {
        if (isFrench) {
          responseText = `Dépenses enregistrées pour le mois de **Juin** :\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**Dépenses Générales :**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description} : **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Dépenses Fournisseurs :**\n` + juneVendorExpensesList.map(v => `• [Échéance ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''} : **${formatCurrency(v.amount)}** (${v.paymentStatus === 'paid' ? 'Payé' : 'Non Payé'})`).join('\n') + `\n\n`;
          }
          responseText += `**Total Juin :** ${formatCurrency(totalGeneral + totalVendor)}`;
        } else {
          responseText = `Registered expenses for the month of **June**:\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**General Expenses:**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description}: **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Vendor Expenses:**\n` + juneVendorExpensesList.map(v => `• [Due ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''}: **${formatCurrency(v.amount)}** (${v.paymentStatus})`).join('\n') + `\n\n`;
          }
          responseText += `**Total June Expenses:** ${formatCurrency(totalGeneral + totalVendor)}`;
        }
      } else {
        responseText = isFrench
          ? "Aucune dépense n'a été enregistrée pour le mois de juin."
          : "No expenses have been recorded for the month of June.";
      }

    } else if (isTuitionQuery) {
      const currentMonth = new Date().getMonth();
      const collectedThisMonth = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const payDate = new Date(p.date);
          return payDate.getMonth() === currentMonth;
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      responseText = isFrench
        ? `Le montant total des frais de scolarité collectés ce mois-ci s'élève à **${formatCurrency(collectedThisMonth)}**.`
        : `The total tuition fees collected this month is **${formatCurrency(collectedThisMonth)}**.`;

    } else if (isCashQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      responseText = isFrench
        ? `Le solde de caisse disponible en direct est actuellement de **${formatCurrency(cash)}**.`
        : `The live cash balance currently available in our accounts is **${formatCurrency(cash)}**.`;

    } else if (isReportQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      if (isFrench) {
        responseText = `📊 **RAPPORT SCOLAIRE MENSUEL - COMPLEXE SCOLAIRE MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Entrées (Frais Collectés ce Mois)** : ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Sorties (Dépenses & Salaires ce Mois)** : ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Flux de Trésorerie Net Mensuel** : ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Solde de Caisse Général** : **${formatCurrency(cash)}**\n` +
          `• **Dettes Restantes à Recouvrer** : **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Rapport généré automatiquement à la demande.`;
      } else {
        responseText = `📊 **MONTHLY SCHOOL FINANCIAL REPORT - MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Total Inflow (Tuition Collected)**: ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Total Outflow (Expenses & Salaries)**: ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Net Monthly Cash Flow**: ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Current Total Cash Balance**: **${formatCurrency(cash)}**\n` +
          `• **Outstanding Debt Receivable**: **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Report compiled automatically upon query request.`;
      }

    } else {
      if (isFrench) {
        responseText = `Je n'ai pas pu analyser de données financières précises pour votre question : « ${queryText} ».\n\n` +
          `Je suis programmé pour répondre à ces requêtes spécifiques concernant l'administration de l'école :\n` +
          `• « **Combien de scolarités ont été collectées ce mois-ci ?** »\n` +
          `• « **Quels parents doivent encore des frais de scolarité ?** »\n` +
          `• « **Afficher toutes les dépenses pour juin.** »\n` +
          `• « **Combien d'argent avons-nous actuellement en caisse ?** »\n` +
          `• « **Quels élèves n'ont pas payé la deuxième tranche ?** »\n` +
          `• « **Générer le rapport financier de ce mois-ci.** »`;
      } else {
        responseText = `I couldn't find a precise match or analyze financial data for your question: "${queryText}".\n\n` +
          `I am specifically trained to answer the following school finance queries:\n` +
          `• "**How much tuition was collected this month?**"\n` +
          `• "**Which parents still owe school fees?**"\n` +
          `• "**Show all expenses for June.**"\n` +
          `• "**How much money do we currently have in cash?**"\n` +
          `• "**Which students haven't paid the second installment?**"\n` +
          `• "**Generate this month's financial report.**"`;
      }
    }

    setTimeout(() => {
      setFloatingChatMessages(prev => [...prev, { sender: 'assistant', text: responseText }]);
    }, 450);
  };

  return {
    aiMessages, setAiMessages, aiInput, setAiInput, handleAiQuery,
    isFloatingChatOpen, setIsFloatingChatOpen,
    floatingChatMessages, floatingChatInput, setFloatingChatInput, handleFloatingAiQuery,
  };
}
