/**
 * ─── Retirer un SALAIRE fautif : la corbeille de la paie, montée et cliquée ──
 *
 * La demande du propriétaire est précise : « mets une icône supprimer dans les
 * dépenses et paie/salaire au cas où on fait une erreur ». Sur la paie, ce geste
 * n'existait pas : le seul recours était de supprimer le MEMBRE — et
 * `salary_payments.staff_id` est `ON DELETE CASCADE`, donc le retrait emportait
 * toute sa paie, et le journal ne disait plus quel montant avait disparu.
 *
 * Trois choses sont mesurées ici, et chacune se paie en silence :
 *
 *   • la corbeille n'existe QUE pour un rôle que la base accepte pour une
 *     suppression (« Finance admins delete salary_payments » →
 *     `public.is_finance_admin()` : admin, dev, Gestionnaire Principal).
 *     L'économe ENREGISTRE la paie sans pouvoir la détruire : aucun bouton ne
 *     lui est offert, donc aucun refus ne lui est annoncé après coup ;
 *   • rien ne part avant une confirmation, et cette confirmation dit ce qui part
 *     (le membre, le montant, la date) — c'est le geste qu'on ne veut pas
 *     presser par erreur, et « êtes-vous sûr ? » ne dit pas quel salaire ;
 *   • annuler n'appelle RIEN, confirmer appelle le gestionnaire du domaine
 *     (`handleDeleteSalaryPayment`) avec CE paiement-là, et pas un autre.
 *
 * Le test monte le VRAI DOM (happy-dom, via le harnais partagé) et clique comme
 * un doigt le ferait : le contrat mesuré est celui de l'INTERFACE. Les props
 * viennent du CONTRAIT (`makeProps`, tests/views-harness.tsx) — une prop nouvelle
 * est donc dérivée sans toucher à ce fichier, et une prop qui manquerait ferait
 * tomber la suite au lieu de rendre une vue à moitié câblée.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Trash2 } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { PayrollView } from '../src/components/PayrollView';
import { translations } from '../src/i18n/translations';
import type { SalaryPayment, Staff } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.fr;

/** Le membre dont la paie fautive doit pouvoir être retirée. */
const MEMBER: Staff = {
  id: 's1',
  name: 'Mariam Coulibaly',
  position: 'Proviseur',
  salary: 250000,
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
};

/** La paie fautive : le mauvais montant, un mauvais jour — le cas d'usage. */
const SALARY: SalaryPayment = {
  id: 'sp1',
  staffId: MEMBER.id,
  amount: 250000,
  date: '2026-10-05',
  academicYear: '2026-2027',
};

/**
 * Monte la vue de la paie avec le droit (ou non) de retirer un salaire, et rend
 * de quoi cliquer : la corbeille, le dialogue de confirmation et ses deux
 * boutons. Aucun autre cas n'a besoin de plus.
 */
function mount(opts: { canDeleteSalaryPayment: boolean }) {
  // Le harnais installe happy-dom (jamais un `new Window()` local, voir
  // scripts/check-test-harness.mjs).
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: SalaryPayment[] = [];
  const props = makeProps({
    t,
    lang: 'fr',
    staff: [MEMBER],
    // Les cartes du haut listent le personnel filtré : sans lui, la fiche du
    // membre disparaîtrait et la suite mesurerait une vue presque vide.
    filteredStaff: [MEMBER],
    salaryPayments: [SALARY],
    // L'icône de la corbeille arrive par les PROPS (`PayrollView` la prend dans
    // le contexte, comme les vues du shell) : le harnais dérive un composant muet
    // pour toute prop sans contenu déclaré, donc un cas qui mesure l'ICÔNE doit
    // passer la vraie. Sans cette ligne, `querySelector('svg')` mesurerait le
    // stub du harnais, pas la corbeille de l'écran.
    Trash2,
    canDeleteSalaryPayment: opts.canDeleteSalaryPayment,
    handleDeleteSalaryPayment: async (payment: SalaryPayment) => {
      calls.push(payment);
    },
  });
  const render = () => act(() => {
    root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(PayrollView)));
  });
  render();
  const click = (el: Element) => act(() => {
    // happy-dom's `.click()` dispatches a real bubbling click — React's root
    // listener picks it up exactly as it would a finger tap.
    (el as HTMLElement).click();
  });
  /** Les boutons du DIALOGUE de confirmation (jamais ceux de la ligne). */
  const dialogButtons = () => Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  );
  const byLabel = (label: string) => dialogButtons().find((b) => b.textContent?.trim() === label);
  return {
    container,
    calls,
    click,
    /** La corbeille de la ligne de paie : repérée par le `title` de l'action. */
    trigger: () => container.querySelector<HTMLButtonElement>(`button[title="${t.deleteSalaryPayment}"]`),
    dialog: () => container.querySelector('[role="dialog"]'),
    confirm: () => byLabel(t.deleteSalaryPayment),
    cancel: () => byLabel(t.cancel),
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('PayrollView — retirer un salaire saisi par erreur', () => {
  it('la corbeille ouvre une confirmation qui nomme le membre, le montant et la date', () => {
    const h = mount({ canDeleteSalaryPayment: true });
    try {
      const trigger = h.trigger();
      assert.ok(trigger, 'la corbeille est offerte quand le rôle peut supprimer');
      h.click(trigger);

      const dialog = h.dialog();
      assert.ok(dialog, 'la confirmation est EN LIGNE (pas un dialogue navigateur)');
      const texte = dialog.textContent ?? '';
      assert.match(texte, new RegExp(MEMBER.name), 'la confirmation nomme le membre dont la paie part');
      assert.match(texte, /250000/, 'elle rappelle le montant');
      assert.match(texte, new RegExp(SALARY.date), 'et la date, pour ne pas retirer la paie du mauvais mois');
      assert.ok(h.confirm(), 'une confirmation offre le bouton qui DÉCIDE');
      assert.equal(h.calls.length, 0, 'rien n’est retiré tant que la confirmation n’est pas donnée');
    } finally {
      h.cleanup();
    }
  });

  it('confirmer appelle le domaine avec CE paiement-là, une seule fois', async () => {
    const h = mount({ canDeleteSalaryPayment: true });
    try {
      h.click(h.trigger()!);
      const confirm = h.confirm();
      assert.ok(confirm, 'le bouton de confirmation existe');
      await act(async () => { h.click(confirm); });

      assert.equal(h.calls.length, 1, 'le retrait part une seule fois');
      assert.equal(h.calls[0]!.id, SALARY.id, 'c’est le salaire de la ligne qui part');
      assert.equal(h.calls[0]!.staffId, MEMBER.id, 'et il porte bien le membre concerné');
      assert.equal(h.calls[0]!.amount, SALARY.amount, 'au montant affiché');
    } finally {
      h.cleanup();
    }
  });

  it('annuler ne retire rien', () => {
    const h = mount({ canDeleteSalaryPayment: true });
    try {
      h.click(h.trigger()!);
      const cancel = h.cancel();
      assert.ok(cancel, 'la confirmation offre de renoncer');
      h.click(cancel);
      assert.equal(h.calls.length, 0, 'renoncer ne touche à aucune ligne');
    } finally {
      h.cleanup();
    }
  });

  it('sans le droit de supprimer : aucune corbeille, donc aucun retrait possible', () => {
    // Le cas de l'économe : il enregistre la paie (`public.is_payroll_writer()`)
    // sans pouvoir la détruire (`public.is_finance_admin()`). La fiche et son
    // historique restent affichés — c'est l'ACTION qui n'existe pas.
    const h = mount({ canDeleteSalaryPayment: false });
    try {
      assert.match(h.container.textContent ?? '', new RegExp(MEMBER.name), 'la paie reste affichée');
      assert.equal(h.trigger(), null, 'pas de rôle, pas de bouton : un bouton que le serveur refuserait est un mensonge');
      assert.equal(h.dialog(), null, 'et aucune confirmation n’est ouverte');
      assert.equal(h.calls.length, 0);
    } finally {
      h.cleanup();
    }
  });

  it('la corbeille porte le LIBELLÉ de l’action, pas seulement l’icône', () => {
    // Une corbeille seule, de la même couleur qu'un ornement, se lit comme une
    // décoration — et c'est justement le geste qu'on ne veut pas presser par
    // erreur (même règle que tests/delete-affordance-labels.test.tsx).
    const h = mount({ canDeleteSalaryPayment: true });
    try {
      const trigger = h.trigger();
      assert.ok(trigger, 'la corbeille est offerte quand le rôle peut supprimer');
      assert.ok(
        (trigger.textContent ?? '').includes(t.deleteSalaryPayment),
        'le libellé de l’action est écrit à côté de l’icône',
      );
      assert.ok(trigger.querySelector('svg'), 'l’icône corbeille reste présente');
    } finally {
      h.cleanup();
    }
  });
});
