/**
 * Suite for `src/lib/paymentRights.ts` — qui peut SUPPRIMER un paiement d'élève,
 * tel que la BASE le décide, et tel que la fiche élève le respecte.
 *
 * Le défaut, mesuré le 2026-10-05 : le bouton « supprimer un paiement » était
 * réservé à `public.is_admin()` (admin, dev). L'économe — qui tient la caisse et
 * saisit les reçus — ne pouvait donc pas corriger un montant tapé deux fois : le
 * bouton lui était caché. La décision du propriétaire ouvre cette seule policy à
 * l'économe (`public.is_payment_deleter()`).
 *
 * Trois choses sont verrouillées, et pas une de moins :
 *   1. la règle elle-même (qui peut, qui ne peut pas) ;
 *   2. la non-divergence avec la MIGRATION — la liste de rôles de
 *      `is_payment_deleter()` est comparée dans les deux sens ;
 *   3. le rendu RÉEL de la fiche : l'économe voit la corbeille du PAIEMENT mais
 *      PAS le bouton « supprimer l'élève » — deux portes distinctes, mesurées sur
 *      le HTML monté, pas déduites du code.
 *
 * Depuis le 2026-10-13, un SECOND droit vit ici : RENSEIGNER les mois d'un reçu
 * (`canUpdatePaymentMonths`). Il ne vient PAS d'une policy — une policy borne des
 * LIGNES, donc l'ouvrir à l'économe lui aurait ouvert le MONTANT avec — mais de
 * la fonction `public.set_payment_months`
 * (`20261013000000_econome_payment_months.sql`), `SECURITY DEFINER`, gardée par
 * `public.is_payment_month_editor()`, dont la seule colonne écrite est `months`.
 * Les deux moitiés sont vérifiées ici : la liste de rôles est comparée à celle de
 * la FONCTION dans les deux sens, ET la policy UPDATE de `payments` doit rester
 * `is_admin()` — l'économe n'a aucun chemin d'UPDATE direct sur cette table.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import { translations } from '../src/i18n/translations';
import { PAYMENT_DELETER_ROLES, PAYMENT_MONTH_EDITOR_ROLES, canDeletePayments, canUpdatePaymentMonths } from '../src/lib/paymentRights';
import { canDeleteRecords, isAdminRole } from '../src/lib/deleteRights';
import { listFiles, maskComments } from '../scripts/lib/source-text.mjs';
// La même leçon que pour tous les contrôles textuels de ce dépôt : un contrôle qui
// lit de la prose comme du code s'est déjà trompé trois fois ici. Le corps de la
// fonction NOMME `amount`, `date`, `receipt_number` et `student_id` — dans le
// commentaire qui dit justement qu'elle n'y touche pas. `blankComments` remplace
// le contenu des commentaires et des littéraux par des espaces AVANT de juger.
import { blankComments } from '../scripts/lib/schema-expected.mjs';
import type { Payment, Student } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const ROOT = join(import.meta.dirname, '..');
const PAYMENTS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261005000003_econome_delete_payments.sql');
const RLS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260809000000_auth_and_rls.sql');
// La migration qui a ouvert les MOIS à l'économe : c'est elle qui porte le helper
// `is_payment_month_editor()` et la fonction bornée dont ce module est le miroir.
// Lue comme les autres — la règle de l'app ne peut pas dériver de la base.
const MONTHS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261013000000_econome_payment_months.sql');
// La migration qui REFERME l'écriture ouverte à tout compte connecté, mesurée le
// 2026-10-13 sur la base de l'école : trois politiques héritées (`Authenticated
// users can … payments`, `USING (true)`) s'ADDITIONNAIENT à la garde `is_admin()`,
// si bien que `general_manager` réécrivait `amount` sur un reçu réel.
const WRITE_LOCK_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261013000001_payments_write_lock.sql');

/** Les rôles cités par `role IN (…)` dans la fonction `name` d'un fichier SQL. */
function rolesOf(sql: string, name: string): string[] {
  const fn = new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?role IN \\(([^)]*)\\)`, 'i').exec(sql);
  assert.ok(fn, `la fonction public.${name}() est lisible dans la migration`);
  return fn![1]
    .split(',')
    .map((role) => role.trim().replace(/^'|'$/g, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

// ─── La règle ────────────────────────────────────────────────────────────────

describe('paymentRights — qui la base laisse supprimer un paiement', () => {
  it('l’économe supprime un paiement (la décision du 2026-10-05), comme admin et dev', () => {
    for (const role of ['admin', 'dev', 'econome']) {
      assert.equal(canDeletePayments(role), true, `${role} peut supprimer un paiement`);
    }
  });

  it('ni `staff`, ni `general_manager`, ni un rôle inconnu ne suppriment un paiement', () => {
    for (const role of ['staff', 'general_manager', null, undefined, '', '  ', 'root']) {
      assert.equal(canDeletePayments(role), false, `« ${String(role)} » ne supprime pas un paiement`);
    }
    assert.equal(canDeletePayments(' Econome '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('le droit reste plus LARGE que la suppression admin : l’économe n’a que les paiements', () => {
    // L'économe supprime un paiement mais AUCUNE table réservée aux admins.
    assert.equal(canDeletePayments('econome'), true);
    assert.equal(canDeleteRecords('econome'), false, 'les tables admin restent hors de portée de l’économe');
    assert.equal(canDeleteRecords('dev'), true);
    assert.equal(canDeletePayments('dev'), true);
  });
});

// ─── La non-divergence avec la migration ─────────────────────────────────────

describe('la règle de l’app et la fonction de la base ne peuvent pas diverger', () => {
  const sql = readFileSync(PAYMENTS_MIGRATION, 'utf8');

  it('les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYMENT_DELETER_ROLES].sort(),
      rolesOf(sql, 'is_payment_deleter'),
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) un bouton que la base ne suit pas',
    );
  });

  it('la policy de suppression de payments s’appuie bien sur ce helper', () => {
    assert.match(sql, /CREATE POLICY "[^"]*" ON public\.payments\s+FOR DELETE USING \(public\.is_payment_deleter\(\)\)/);
  });
});

// ─── Renseigner les MOIS : un droit BORNÉ, porté par une fonction ────────────

describe('paymentRights — qui la base laisse renseigner les mois d’un reçu', () => {
  it('admin, dev ET économe le peuvent : c’est la FONCTION de la base qui décide', () => {
    // Décision du propriétaire, 2026-10-13 : l'économe tient la caisse et
    // repartage les reçus, et il supprime DÉJÀ un reçu fautif — lui refuser de
    // renseigner les mois de celui qu'il a sous les yeux laissait l'école devant un
    // reçu muet, avec la suppression comme seul recours (ce qui aurait changé son
    // numéro, sa date et son auteur au journal).
    for (const role of ['admin', 'dev', 'econome']) {
      assert.equal(canUpdatePaymentMonths(role), true, `${role} renseigne les mois d’un reçu`);
    }
    assert.equal(canUpdatePaymentMonths(' ADMIN '), true, 'la casse et les espaces sont absorbés');
  });

  it('ni `staff`, ni `general_manager`, ni un rôle inconnu ne les renseignent', () => {
    for (const role of ['staff', 'general_manager', null, undefined, '', '  ', 'root']) {
      assert.equal(canUpdatePaymentMonths(role), false, `« ${String(role)} » non plus`);
    }
  });

  it('ce droit ne suit PAS celui de la suppression d’un élève : l’économe reste dehors', () => {
    // Renseigner les mois n'est pas « administrer » : l'économe ne supprime
    // toujours aucun élève, ni aucune table réservée aux administrateurs.
    assert.equal(canUpdatePaymentMonths('econome'), true);
    assert.equal(canDeleteRecords('econome'), false, 'les tables admin restent hors de portée');
    assert.equal(canUpdatePaymentMonths('staff'), false, 'un surveillant ne corrige pas la caisse');
  });
});

describe('le droit de renseigner les mois ne diverge pas de la FONCTION de la base', () => {
  const sql = readFileSync(MONTHS_MIGRATION, 'utf8');

  it('les rôles sont ceux de `public.is_payment_month_editor()`, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYMENT_MONTH_EDITOR_ROLES].sort(),
      rolesOf(sql, 'is_payment_month_editor'),
      'un rôle ajouté d’un seul côté afficherait un bouton que la base refuse (42501)',
    );
  });

  it('la fonction est SECURITY DEFINER, avec un `search_path` figé', () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION public\.set_payment_months\([\s\S]*?\)\s*RETURNS INTEGER\s*\nLANGUAGE plpgsql\s*\nSECURITY DEFINER\s*\nSET search_path = public/,
      'une fonction SECURITY DEFINER qui laisse son search_path libre est un détournement qui attend son heure',
    );
  });

  it('elle REFUSE un appelant qui n’est pas éditeur des mois', () => {
    assert.match(
      sql,
      /IF NOT public\.is_payment_month_editor\(\) THEN[\s\S]*?ERRCODE = '42501'/,
      'la garde de rôle est dans le corps de la fonction, pas seulement dans l’écran',
    );
  });

  it('la SEULE colonne écrite est `months` — c’est la borne, pas une convention', () => {
    // Ce que la requête nomme à gauche du signe égal. Le montant, la date, le
    // numéro de reçu et l'élève ne peuvent pas être atteints par ce chemin : ils
    // n'y sont pas. C'est la borne qu'une policy ne pouvait PAS donner (elle borne
    // des lignes), et c'est pourquoi ce droit passe par une fonction.
    const body = /CREATE OR REPLACE FUNCTION public\.set_payment_months[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? '';
    assert.ok(body, 'le corps de la fonction doit être lisible');
    // Seul le CODE est jugé : la prose du corps nomme les colonnes qu'elle
    // s'interdit, et la lire ferait rougir un contrôle sur son propre commentaire.
    const code = blankComments(body);
    const assignments = /UPDATE public\.payments SET ([\s\S]*?) WHERE/.exec(code);
    assert.ok(assignments, 'la fonction écrit bien dans `payments`');
    assert.deepEqual(
      assignments![1].split(',').map((part) => part.trim().split(/\s*=/)[0]),
      ['months'],
      'une colonne de plus ici ouvrirait l’argent à l’économe',
    );
    for (const forbidden of ['amount', 'date', 'receipt_number', 'student_id']) {
      assert.ok(!code.includes(forbidden), `« ${forbidden} » n’a rien à faire dans cette fonction`);
    }
  });

  it('l’EXECUTE est retiré à `anon` et à `public`, et donné à `authenticated`', () => {
    // Leçon du 2026-09-06 : les privilèges PAR DÉFAUT de Supabase donnent à `anon`
    // un droit d'exécution direct sur toute fonction créée — un `REVOKE` sur
    // `public` ne le retire pas.
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.set_payment_months\(uuid, text\[\]\) FROM anon;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.set_payment_months\(uuid, text\[\]\) FROM public;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_payment_months\(uuid, text\[\]\) TO authenticated;/);
  });

  it('la policy UPDATE de `payments` reste `is_admin()` : l’économe n’a AUCUN UPDATE direct', () => {
    // La seconde moitié de la borne. Si une migration future ouvrait cette policy à
    // l'économe, le MONTANT s'ouvrirait avec elle (une policy borne des lignes, pas
    // des colonnes) : ce test doit alors rougir et forcer la décision à se dire —
    // c'est exactement le défaut que la migration du 2026-10-13 évite.
    const rls = readFileSync(RLS_MIGRATION, 'utf8');
    assert.match(
      rls,
      /CREATE POLICY "Admin update payments" ON public\.payments\s+FOR UPDATE USING \(public\.is_admin\(\)\)/,
      'la seule policy UPDATE de `payments` est celle des administrateurs',
    );
    assert.deepEqual(rolesOf(rls, 'is_admin'), ['admin', 'dev'], 'et `is_admin()` ne connaît que ces deux rôles');
    assert.equal(
      canUpdatePaymentMonths('econome') && !rolesOf(rls, 'is_admin').includes('econome'),
      true,
      'l’économe écrit les mois par la FONCTION, jamais par un UPDATE de table',
    );
  });
});

// ─── L'ÉCRITURE d'un reçu : fermée, sauf le chemin nommé ─────────────────────

describe('l’écriture d’un reçu n’est ouverte qu’au rôle nommé (20261013000001)', () => {
  const sql = readFileSync(WRITE_LOCK_MIGRATION, 'utf8');

  it('retire PAR LEUR NOM les trois politiques héritées de la base de l’école', () => {
    for (const name of [
      'Authenticated users can update payments',
      'Authenticated users can insert payments',
      'Authenticated users can read payments',
    ]) {
      assert.match(
        sql,
        new RegExp(`DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" ON public\\.payments;`),
        `« ${name} » doit partir par son nom : une politique oubliée annule la borne, et rien ne le dit`,
      );
    }
  });

  it('la ré-attribution d’un reçu passe par `is_admin()` — le rôle que l’écran offre déjà', () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION public\.reassign_payment_student\([\s\S]*?\)\s*RETURNS INTEGER\s*\nLANGUAGE plpgsql\s*\nSECURITY DEFINER\s*\nSET search_path = public/,
      'SECURITY DEFINER avec un `search_path` figé, comme les autres fonctions sensibles',
    );
    assert.match(
      sql,
      /IF NOT public\.is_admin\(\) THEN[\s\S]*?ERRCODE = '42501'/,
      'la garde est dans le corps de la fonction, pas seulement dans l’écran',
    );
    // Le rôle n'est pas une liste recopiée ici : c'est `is_admin()`, dont
    // `ADMIN_ROLES` est le miroir — qui peut fusionner une fiche peut déplacer ses
    // reçus, et personne d'autre.
    assert.equal(isAdminRole('admin'), true);
    assert.equal(isAdminRole('dev'), true);
    assert.equal(isAdminRole('econome'), false, 'l’économe ne déplace pas un reçu d’une fiche à une autre');
    assert.equal(isAdminRole('general_manager'), false);
  });

  it('la SEULE colonne écrite est `student_id` — ni montant, ni date, ni numéro', () => {
    const body = /CREATE OR REPLACE FUNCTION public\.reassign_payment_student[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? '';
    assert.ok(body, 'le corps de la fonction doit être lisible');
    const code = blankComments(body);
    const assignments = /UPDATE public\.payments\s+SET ([\s\S]*?)\s+WHERE/.exec(code);
    assert.ok(assignments, 'la fonction écrit bien dans `payments`');
    assert.deepEqual(
      assignments![1].split(',').map((part) => part.trim().split(/\s*=/)[0]),
      ['student_id'],
      'une colonne de plus ici rouvrirait l’argent au rôle qui déplace un reçu',
    );
    for (const forbidden of ['amount', 'date', 'receipt_number', 'months']) {
      assert.ok(!code.includes(forbidden), `« ${forbidden} » n’a rien à faire dans cette fonction`);
    }
    assert.match(
      code,
      /WHERE id = p_payment_id AND student_id = p_from_student_id/,
      'la fiche d’ORIGINE est exigée : un reçu qui n’y est plus rend 0, et 0 n’est pas un succès',
    );
  });

  it('l’EXECUTE est retiré à `anon` et à `public`, et donné à `authenticated`', () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.reassign_payment_student\(uuid, uuid, uuid\) FROM anon;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.reassign_payment_student\(uuid, uuid, uuid\) FROM public;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reassign_payment_student\(uuid, uuid, uuid\) TO authenticated;/);
  });
});

describe('aucun chemin de l’application ne réécrit un reçu par un UPDATE de table', () => {
  // Le contrôle qui aurait attrapé le défaut du 2026-10-13 à sa source. Depuis la
  // migration, écrire dans `payments` passe par : la saisie (`insert`), la
  // suppression (`delete`) et les FONCTIONS bornées de la base — jamais par
  // `.update(…)`, qui est ce que le client peut envoyer de plus large.
  const sources = listFiles(join(ROOT, 'src'));

  it('le corpus est lu (un scan vide n’est pas un scan vert)', () => {
    assert.ok(sources.length > 100, `le corpus de src/ doit être lu : ${sources.length} fichier(s)`);
    assert.ok(sources.some((file) => file.endsWith('dataOps/students.ts')), 'dont le fichier de la fusion');
  });

  it('`from(\'payments\').update(…)` n’existe plus : la fonction bornée est le seul chemin', () => {
    const offenders = sources.filter((file) =>
      /from\(\s*['"]payments['"]\s*\)\s*[\s\S]{0,40}?\.\s*update\s*\(/.test(
        maskComments(readFileSync(file, 'utf8')),
      ),
    );
    assert.deepEqual(
      offenders,
      [],
      'un UPDATE de table sur les reçus rouvrirait le montant — c’est le défaut mesuré en production',
    );
  });

  it('la fusion appelle la FONCTION, et nomme la fiche d’origine', () => {
    const code = maskComments(readFileSync(join(ROOT, 'src', 'lib', 'dataOps', 'students.ts'), 'utf8'));
    assert.match(code, /rpc\(\s*'reassign_payment_student'/);
    assert.match(code, /p_from_student_id/);
    assert.match(code, /from\(\s*'payments'\s*\)\s*[\s\S]{0,40}?\.\s*select\(\s*'id'\s*\)/, 'et relit qu’aucun reçu n’est resté sous la fiche supprimée');
  });
});

// ─── Le rendu réel ───────────────────────────────────────────────────────────

const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800',
  accent: 'text-emerald-600', accentBg: 'bg-emerald-50', accentText: 'text-white',
  accentHover: 'hover:bg-emerald-100', accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-emerald-200', accentSoft: 'bg-emerald-50', accentSoftText: 'text-emerald-600',
  accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669', accentHexDeep: '#047857', accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300', accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50', inkStrong: 'text-slate-800',
  accentSoftDark: 'bg-blue-500/15', accentSoftDarkHover: 'hover:bg-blue-500/25', accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-100', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false,
};

const PAY: Payment = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' };
const STUDENT: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', totalDue: 150000, amountPaid: 25000,
  parentName: 'Papa Diallo', parentEmail: '', parentPhone: '', dueDate: '2026-12-31',
  notes: '', payments: [PAY],
};

function mount(opts: { canDelete: boolean; canDeletePayment: boolean; canEditPaymentMonths: boolean }) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(StudentDetailsModal, {
    student: STUDENT, t, lang: 'fr', currentTheme: theme,
    formatDate: (d: string) => d, formatCurrency: (n: number) => `${n} FCFA`,
    getGradeDisplay: (g: string | undefined) => g ?? '', generatePaymentReceiptPdf: async () => {},
    currentUser: { name: 'Admin', role: 'admin' }, copyToClipboard: () => {}, handleSaveNote: async () => {},
    studentDetailTab: 'general', setStudentDetailTab: () => {}, selectedYear: '2026-2027', overlayRef: () => {},
    onClose: () => {}, onEdit: () => {}, onPrint: () => {}, onDeleteRequest: () => {},
    canDelete: opts.canDelete, canDeletePayment: opts.canDeletePayment,
    onDeletePayment: async () => true,
    canEditPaymentMonths: opts.canEditPaymentMonths,
    onUpdatePaymentMonths: async () => true,
  })));
  return {
    container,
    /** La corbeille d'un PAIEMENT : repérée par son `title`. */
    paymentTrash: () => container.querySelector(`button[title="${t.deletePayment}"]`),
    /** Le bouton « renseigner les mois » : repéré par son `title`. */
    monthsEdit: () => container.querySelector(`button[title="${t.paymentMonthsEdit}"]`),
    /** Le bouton « supprimer l'élève » : repéré par son texte (pas de `title`). */
    studentDelete: () => Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === t.deleteStudent) ?? null,
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('la fiche élève ne propose chaque geste qu’au rôle que la base accepte', () => {
  it('économe : la corbeille du paiement ET les mois d’un reçu muet, mais pas l’élève', () => {
    // Décision du 2026-10-13 : l'économe renseigne les mois — il tient la caisse,
    // et il le fait par la FONCTION bornée de la base, qui n'écrit que `months`.
    // Ce qui reste fermé n'a jamais été ouvert : la suppression de l'ÉLÈVE, que
    // `is_admin()` réserve aux administrateurs.
    const h = mount({ canDelete: false, canDeletePayment: true, canEditPaymentMonths: true });
    try {
      assert.ok(h.paymentTrash(), 'l’économe doit pouvoir corriger un paiement');
      assert.ok(h.monthsEdit(), 'et renseigner les mois d’un reçu muet');
      assert.equal(h.studentDelete(), null, 'mais pas supprimer l’élève entier');
    } finally {
      h.cleanup();
    }
  });

  it('staff : aucune des actions', () => {
    const h = mount({ canDelete: false, canDeletePayment: false, canEditPaymentMonths: false });
    try {
      assert.equal(h.paymentTrash(), null);
      assert.equal(h.studentDelete(), null);
      assert.equal(h.monthsEdit(), null);
    } finally {
      h.cleanup();
    }
  });

  it('admin/dev : les trois actions', () => {
    const h = mount({ canDelete: true, canDeletePayment: true, canEditPaymentMonths: true });
    try {
      assert.ok(h.paymentTrash());
      assert.ok(h.studentDelete());
      assert.ok(h.monthsEdit(), 'le bouton des mois est offert là où la FONCTION de la base l’autorise');
    } finally {
      h.cleanup();
    }
  });
});
