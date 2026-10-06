/**
 * Bilingual toast labels for data mutations.
 *
 * Extracted from src/App.tsx (split campaign, no behaviour change): the labels
 * are a constant keyed by the mutation operation name `useSupabaseData` reports,
 * so they do not belong inside a `useMemo` in the composition root. The hook's
 * `onMutationSuccess` looks up `OPERATION_LABELS[operation]` and shows the label
 * in the active language; an operation with no label stays silent.
 */
export const OPERATION_LABELS: Record<string, { en: string; fr: string }> = {
  addParent: { en: 'Parent added', fr: 'Parent ajouté' },
  updateParent: { en: 'Parent updated', fr: 'Parent mis à jour' },
  deleteParent: { en: 'Parent deleted', fr: 'Parent supprimé' },
  addStudent: { en: 'Student added', fr: 'Élève ajouté(e)' },
  updateStudent: { en: 'Student updated', fr: 'Élève mis(e) à jour' },
  mergeStudents: { en: 'Records merged', fr: 'Fiches fusionnées' },
  deleteStudent: { en: 'Student deleted', fr: 'Élève supprimé(e)' },
  addPayment: { en: 'Payment recorded', fr: 'Paiement enregistré' },
  deletePayment: { en: 'Payment deleted', fr: 'Paiement supprimé' },
  restorePayment: { en: 'Payment restored', fr: 'Paiement restauré' },
  addStaff: { en: 'Staff added', fr: 'Employé ajouté' },
  updateStaff: { en: 'Staff updated', fr: 'Employé mis à jour' },
  deleteStaff: { en: 'Staff deleted', fr: 'Employé supprimé' },
  addSalaryPayment: { en: 'Salary recorded', fr: 'Salaire enregistré' },
  addExpense: { en: 'Expense added', fr: 'Dépense ajoutée' },
  addVendorExpense: { en: 'Vendor expense added', fr: 'Charge fournisseur ajoutée' },
  updateVendorExpense: { en: 'Vendor expense updated', fr: 'Charge fournisseur mise à jour' },
  deleteVendorExpense: { en: 'Vendor expense deleted', fr: 'Charge fournisseur supprimée' },
  addTodo: { en: 'Task added', fr: 'Tâche ajoutée' },
};
