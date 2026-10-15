/**
 * ─── Les deux gestes de CORRECTION d'un paiement de salaire ───────────────────
 *
 * Ce module existe parce que la PAIE et les REÇUS ne corrigent pas la même chose,
 * et parce que `dataOps/payments.ts` a atteint le budget de lignes
 * (`scripts/check-line-budget.mjs`, 700) au moment où il a fallu les écrire : la
 * scission est le remède que cette porte prescrit elle-même.
 *
 * Il porte exactement deux gestes, et ils vont par paire :
 *   • `deleteSalaryPayment` retire la SEULE ligne fautive — mauvais membre,
 *     montant doublé, mois payé deux fois — et écrit une entrée
 *     `DELETE_SALARY_PAYMENT` avec l'instantané qui rend le geste annulable ;
 *   • `restoreSalaryPayment` réinsère la ligne à l'IDENTIQUE depuis cet
 *     instantané (même id, même membre, même montant, même date).
 *
 * Ce qu'ils NE font pas : toucher au MEMBRE. Jusqu'ici le seul recours contre une
 * paie fautive était `deleteStaff`, dont la clé étrangère est `ON DELETE CASCADE`
 * — toute la paie du membre partait avec, et le journal ne disait plus quel
 * montant avait été retiré. Le droit est celui de la base
 * (`public.is_finance_admin()`, « Finance admins delete salary_payments ») : le
 * gestionnaire financier corrige, l'économe enregistre.
 *
 * L'instantané vit dans `src/lib/salaryUndo.ts` — la forme ET son genre y sont
 * définis une seule fois, en ligne comme au rejeu (`src/lib/offlineReplayPayroll.ts`).
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { SalaryPayment } from '../domainTypes';
import { archivedSalaryFrom, salarySnapshotMetadata } from '../salaryUndo';
import type { ArchivedSalaryPayment } from '../salaryUndo';
import { logAuditEvent } from '../auditLogger';

export function createSalaryCorrectionOps(ctx: SupabaseDataCtx) {
  const { staff, setSalaryPayments, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  /**
   * SUPPRIMER un paiement de salaire — le correctif d'une paie fautive.
   *
   * Le défaut mesuré, et il décide de tout : jusqu'ici le seul recours contre un
   * salaire saisi pour le mauvais membre était de supprimer LE MEMBRE
   * (`deleteStaff`), dont la clé étrangère est `ON DELETE CASCADE` — toute sa
   * paie partait avec, et le journal ne disait plus quel montant avait été
   * retiré. On retire donc la SEULE ligne fautive.
   *
   * Trois choses suivent, et aucune n'est cosmétique :
   *   • la ligne part de `salary_payments` (`.select('id')` : zéro ligne = la
   *     policy « Finance admins delete salary_payments » a refusé, et l'écran le
   *     DIT — la suppression est réservée à `public.is_finance_admin()`, voir
   *     `canDeleteSalaryPayments` dans `src/lib/payrollRights.ts`) ;
   *   • une entrée `DELETE_SALARY_PAYMENT` est écrite dans le journal, avec le
   *     montant, la date et le MEMBRE : c'est la trace que l'école relit ;
   *   • l'instantané STRUCTURÉ part dans `metadata` (`salaryUndo.ts`) : c'est lui
   *     qui rend le geste annulable — sans lui, réparer une suppression
   *     demanderait de ressaisir la paie à la main, en espérant retomber sur le
   *     même montant et la même date.
   *
   * Hors ligne, le geste est mis en file AVEC tout ce qu'il faut pour écrire le
   * même instantané au rejeu (membre, montant, date, année) : une suppression
   * saisie sans réseau reste donc annulable, exactement comme celle faite en
   * ligne.
   */
  const deleteSalaryPayment = async (payment: SalaryPayment): Promise<boolean> => {
    const salaryPaymentId = payment.id;
    if (!salaryPaymentId) {
      notifyError('deleteSalaryPayment', 'Ce paiement de salaire n’a pas d’identifiant — suppression impossible.');
      return false;
    }
    // Le nom du membre est lu ICI, avant que la ligne ne disparaisse : après la
    // suppression, plus rien dans `salary_payments` ne dit à qui ce montant était
    // destiné.
    const staffName = staff.find(s => s.id === payment.staffId)?.name;

    /** Retire la ligne du listing local — les totaux du mois suivent d'eux-mêmes. */
    const applyLocally = (list: SalaryPayment[]): SalaryPayment[] => list.filter(p => p.id !== salaryPaymentId);

    if (isOffline()) {
      setSalaryPayments(applyLocally);
      // Même règle que les reçus : si la FILE refuse (stockage plein), la
      // suppression n'est pas retenue — et l'écran ne doit pas dire le contraire.
      try {
        enqueueOffline('deleteSalaryPayment', {
          id: salaryPaymentId,
          staffId: payment.staffId,
          staffName,
          amount: payment.amount,
          date: payment.date,
          academicYear: payment.academicYear,
        });
      } catch {
        // Le refus est DÉJÀ annoncé par `enqueueOffline` : on ne rend que l'échec.
        return false;
      }
      notifySuccess('deleteSalaryPayment');
      return true;
    }

    const { data, error } = await supabase.from('salary_payments').delete().eq('id', salaryPaymentId).select('id');
    if (error) {
      console.error('deleteSalaryPayment error:', error.message);
      notifyError('deleteSalaryPayment', error.message);
      return false;
    }
    if (!data || data.length === 0) {
      console.error('deleteSalaryPayment: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteSalaryPayment', 'Aucune ligne supprimée — droits insuffisants sur ce salaire.');
      return false;
    }

    setSalaryPayments(applyLocally);

    void logAuditEvent({
      action: 'DELETE_SALARY_PAYMENT',
      targetType: 'salary_payment',
      // `target_id` est l'ID DU PAIEMENT (pas du membre) : c'est lui qui relie
      // l'entrée à son instantané, donc à une éventuelle restauration.
      targetId: salaryPaymentId,
      details: `Salaire de ${payment.amount} FCFA (${payment.date}) supprimé — membre ${staffName || payment.staffId}`,
      metadata: salarySnapshotMetadata(archivedSalaryFrom(payment.staffId, staffName, payment)),
    });

    notifySuccess('deleteSalaryPayment');
    return true;
  };

  /**
   * RESTAURER un paiement de salaire supprimé — l'annulation du geste.
   *
   * L'instantané (`ArchivedSalaryPayment`) vient du `metadata` de l'entrée
   * `DELETE_SALARY_PAYMENT` : la vue « Historique des paiements » le relit et le
   * passe ici. On réinsère la ligne avec son ID D'ORIGINE — le salaire retrouve
   * son identité, et une restauration rejouée retombe sur la même ligne (`23505`
   * = « déjà revenu ») au lieu d'en payer une seconde.
   *
   * Une entrée `RESTORE_SALARY_PAYMENT` est écrite : le journal garde les DEUX
   * gestes, la suppression et sa réparation, dans l'ordre.
   *
   * Limite dite, la même que pour un reçu : la restauration demande le RÉSEAU.
   * L'instantané vit dans le journal de la base ; hors ligne on ne peut ni le
   * relire de source sûre ni garantir la réinsertion, donc on refuse au lieu de
   * faire semblant.
   */
  const restoreSalaryPayment = async (archived: ArchivedSalaryPayment): Promise<boolean> => {
    if (!archived.salaryPaymentId || !archived.staffId) {
      notifyError('restoreSalaryPayment', 'Instantané incomplet — restauration impossible.');
      return false;
    }
    if (isOffline()) {
      notifyError('restoreSalaryPayment', 'La restauration demande le réseau : l’instantané est relu dans le journal de la base.');
      return false;
    }

    const { error } = await supabase.from('salary_payments').insert({
      id: archived.salaryPaymentId,
      staff_id: archived.staffId,
      amount: archived.amount,
      date: archived.date,
      academic_year: archived.academicYear ?? null,
    });
    if (error && error.code !== '23505') {
      console.error('restoreSalaryPayment error:', error.message);
      notifyError('restoreSalaryPayment', error.message);
      return false;
    }
    // `23505` : la ligne est déjà revenue (seconde restauration, ou rejeu) — on
    // ne crie pas et on n'ajoute pas la ligne deux fois.
    const restored: SalaryPayment = {
      id: archived.salaryPaymentId,
      staffId: archived.staffId,
      amount: archived.amount,
      date: archived.date,
      academicYear: archived.academicYear,
    };
    setSalaryPayments(prev => prev.some(p => p.id === archived.salaryPaymentId) ? prev : [...prev, restored]);

    void logAuditEvent({
      action: 'RESTORE_SALARY_PAYMENT',
      targetType: 'salary_payment',
      targetId: archived.salaryPaymentId,
      details: `Salaire de ${archived.amount} FCFA (${archived.date}) restauré — membre ${archived.staffName || archived.staffId}`,
      // Le MÊME instantané, à l'identique : une seconde restauration (ou un rejeu
      // du geste) retrouve de quoi rendre la ligne une troisième fois.
      metadata: salarySnapshotMetadata(archived),
    });

    notifySuccess('restoreSalaryPayment');
    return true;
  };

  return { deleteSalaryPayment, restoreSalaryPayment };
}
