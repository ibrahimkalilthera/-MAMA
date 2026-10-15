/**
 * Domain: paymentCorrections — retirer un salaire fautif, et les gestes de
 * correction que l'Historique des paiements montre à part.
 *
 * Extrait du domaine `admin` au moment où il a dépassé le budget de lignes de
 * `scripts/check-line-budget.mjs` (700) — la scission que ce gate prescrit
 * lui-même, comme `cashReport` avant lui. Le lot se détache proprement parce
 * qu'il ne sert qu'un geste et un bloc : la corbeille de la paie
 * (`PayrollView.tsx`), le bloc des corrections et ses deux gestes
 * (`PaymentHistoryView.tsx`), et les deux libellés de journal que ces gestes
 * écrivent (`auditDisplay.ts` → `auditActionDeleteSalaryPayment` /
 * `auditActionRestoreSalaryPayment`).
 *
 * Comme les autres domaines, il exporte les deux fragments (en/fr) que
 * `src/i18n/translations.ts` fusionne ; `scripts/l10n-verify.mjs` vérifie la
 * parité, l'ABSENCE de doublon entre domaines, et le même ordre de clés dans les
 * deux langues — les deux blocs ci-dessous se lisent donc dans le même ordre.
 */
export const en = {
    deleteSalaryPayment: "Delete salary",
    deleteSalaryPaymentConfirm: "Are you sure you want to delete {name}'s salary — {amount} of {date}? The gesture stays reversible from the Payment History.",
    restoreSalaryPayment: "Restore salary",
    restoreSalaryPaymentHint: "Re-inserts this salary exactly as it was: same member, same amount, same date.",
    onlyFinanceAdminCanDeleteSalary: "Only a finance admin can remove a salary.",
    paymentHistorySubject: "Member / subject",
    paymentHistoryCorrections: "Correction gestures",
    paymentHistoryCorrectionsNote: "{count} correction gesture(s) — outside the collected net: a removed expense or salary is not a collection.",
    paymentHistoryCorrectionsEmpty: "No correction: nothing has been removed from the register.",
    auditActionDeleteSalaryPayment: "Salary deleted",
    auditActionRestoreSalaryPayment: "Salary restored",
};

export const fr = {
    deleteSalaryPayment: "Supprimer le salaire",
    deleteSalaryPaymentConfirm: "Êtes-vous sûr de vouloir supprimer le salaire de {name} — {amount} du {date} ? Le geste reste réversible depuis l'Historique des paiements.",
    restoreSalaryPayment: "Rétablir le salaire",
    restoreSalaryPaymentHint: "Réinsère ce salaire à l'identique : même membre, même montant, même date.",
    onlyFinanceAdminCanDeleteSalary: "Seul le gestionnaire financier peut retirer un salaire.",
    paymentHistorySubject: "Membre / sujet",
    paymentHistoryCorrections: "Gestes de correction",
    paymentHistoryCorrectionsNote: "{count} geste(s) de correction — hors du net encaissé : une dépense ou un salaire retiré n'est pas un encaissement.",
    paymentHistoryCorrectionsEmpty: "Aucune correction : rien n'a été retiré du registre.",
    auditActionDeleteSalaryPayment: "Salaire supprimé",
    auditActionRestoreSalaryPayment: "Salaire rétabli",
};
