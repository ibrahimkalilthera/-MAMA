/**
 * Suite pour `src/app/tabRights.ts` — la table qui dit qui peut OUVRIR un onglet
 * réservé, et RIEN d'autre que cette table.
 *
 * Le défaut, mesuré le 2026-10-15 : trois endroits décidaient du même onglet —
 * la ligne du rail (`isAdminDev`, `canSeePaymentHistory`), la barre mobile
 * (les mêmes recopies) et le filet du shell (`!auth.isAdmin` ⇒ settings, audit,
 * paymentHistory). La base a ouvert la lecture de l'historique des paiements à
 * l'économe, le rail a suivi, le filet non : la ligne s'affichait, l'onglet
 * revenait au tableau de bord dans la même seconde. La fonctionnalité était morte
 * À L'ÉCRAN tout en paraissant ouverte.
 *
 * Cette suite tient quatre moitiés de la réparation :
 *
 *   1. le DROIT — chaque onglet ouvre exactement la liste de son entrée, pour tout
 *      le vocabulaire des rôles, et un profil pas encore chargé n'ouvre rien ;
 *   2. la NON-DUPLICATION — l'entrée ne porte pas une copie de la liste ni une
 *      copie du gate : c'est la MÊME référence que le module de droits exporte (une
 *      égalité d'identité, pas une égalité de contenu) ;
 *   3. la NON-DIVERGENCE avec la base — les rôles de chaque onglet sont comparés,
 *      dans les deux sens, à l'objet de la MIGRATION que l'entrée nomme
 *      (`public.is_admin()`, la policy « Admins can view audit logs »,
 *      `public.is_payment_history_viewer()`) ;
 *   4. le FAIT de l'onglet — `readsJournal` : le journal se recharge pour les deux
 *      écrans qui le lisent, et pour eux seuls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RESERVED_TABS, beforeOpenTab, canOpenTab, isReservedTab } from '../src/app/tabRights';
import type { ReservedTab } from '../src/app/tabRights';
import { ADMIN_ROLES, isAdminRole } from '../src/lib/deleteRights';
import {
  PAYMENT_HISTORY_VIEWER_ROLES,
  canViewPaymentHistory,
} from '../src/lib/paymentHistoryRights';
import { ROLE_POOL } from './reserved-tabs-cases';
// Le blanchiment PARTAGÉ des commentaires SQL : la prose de la migration CITE les
// rôles et les politiques, et une explication ne doit pas pouvoir satisfaire une
// vérification de structure.
import { blankComments } from '../scripts/lib/schema-expected.mjs';

const ROOT = join(import.meta.dirname, '..');
const migration = (name: string) => readFileSync(join(ROOT, 'supabase', 'migrations', name), 'utf8');

const entryOf = (tab: ReservedTab) => {
  const entry = RESERVED_TABS.find((candidate) => candidate.tab === tab);
  assert.ok(entry, `la table porte ${tab}`);
  return entry!;
};

/** Les rôles cités par `role IN (…)` dans la fonction `name` d'un fichier SQL. */
function functionRoles(sql: string, name: string): string[] {
  const fn = new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?role IN \\(([^)]*)\\)`, 'i').exec(sql);
  assert.ok(fn, `la fonction public.${name}() est lisible dans la migration`);
  return fn![1]
    .split(',')
    .map((role) => role.trim().replace(/^'|'$/g, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

/** Les rôles d'une POLICY nommée — sa condition écrite en clair (`role IN (…)`). */
function policyRoles(sql: string, policy: string): string[] {
  const masked = blankComments(sql);
  const start = masked.indexOf(`CREATE POLICY "${policy}"`);
  assert.ok(start > 0, `la policy « ${policy} » est déclarée`);
  const blocked = masked.slice(start).indexOf(';');
  // Le `;` qui ferme le bloc, ou la fin du fichier s'il n'y en a pas (dernier objet).
  const block = blocked < 0 ? sql.slice(start) : sql.slice(start, start + blocked);
  const roles = [...block.matchAll(/role IN \(([^)]*)\)/g)];
  assert.equal(roles.length, 1, `la policy « ${policy} » porte une seule liste de rôles`);
  return roles[0][1]
    .split(',')
    .map((role) => role.trim().replace(/^'|'$/g, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

// ─── 1. Le droit ─────────────────────────────────────────────────────────────

describe('tabRights — un onglet réservé, et son seul droit', () => {
  it('chaque onglet s’ouvre EXACTEMENT pour les rôles de son entrée', () => {
    for (const entry of RESERVED_TABS) {
      for (const role of ROLE_POOL) {
        assert.equal(
          canOpenTab(entry.tab, role),
          (entry.roles as readonly string[]).includes(role),
          `${entry.tab} pour ${role}`,
        );
      }
    }
  });

  it('la casse et les espaces sont absorbés, comme Postgres les lit', () => {
    assert.equal(canOpenTab('audit', ' Dev '), true);
    assert.equal(canOpenTab('paymentHistory', 'ECONOME'), true);
    assert.equal(canOpenTab('settings', 'STAFF'), false);
  });

  it('un profil PAS ENCORE chargé n’ouvre aucun onglet réservé', () => {
    // Mesuré le 2026-10-15 : la garde d'écran ne lisait que `isAdmin`, donc un
    // poste dont le profil n'était pas là pouvait ouvrir un écran que la base
    // aurait refusé. Le doute ne s'écrit pas comme un droit.
    for (const entry of RESERVED_TABS) {
      for (const role of [null, undefined, '', '   ']) {
        assert.equal(canOpenTab(entry.tab, role), false, `${entry.tab} pour « ${String(role)} »`);
      }
    }
  });

  it('un onglet NON réservé s’ouvre à tout compte connecté', () => {
    for (const role of [...ROLE_POOL, null, undefined]) {
      assert.equal(canOpenTab('students', role), true, `students reste ouvert (${String(role)})`);
    }
    assert.deepEqual(
      ROLE_POOL.filter((role) => !canOpenTab('dashboard', role)),
      [],
      'le tableau de bord n’est réservé à personne — c’est même là que le filet ramène',
    );
  });

  it('« réservé » nomme les onglets de la table, et rien d’autre', () => {
    for (const tab of ['audit', 'paymentHistory', 'settings'] as const) {
      assert.equal(isReservedTab(tab), true, `${tab} est réservé`);
    }
    for (const tab of ['students', 'dashboard', 'silentReceipts', 'payroll']) {
      assert.equal(isReservedTab(tab), false, `${tab} ne l’est pas`);
    }
  });
});

// ─── 2. La non-duplication ───────────────────────────────────────────────────

describe('la table ne RECOPIE ni les listes ni les gates', () => {
  it('les listes de rôles sont les MÊMES références que le module de droits exporte', () => {
    // Une égalité d'identité, pas de contenu : une copie qui contiendrait les
    // mêmes rôles aujourd'hui divergerait demain, et c'est exactement le défaut.
    assert.equal(entryOf('paymentHistory').roles, PAYMENT_HISTORY_VIEWER_ROLES);
    assert.equal(entryOf('audit').roles, ADMIN_ROLES);
    assert.equal(entryOf('settings').roles, ADMIN_ROLES);
  });

  it('le gate est la FONCTION du module de droits, pas une règle réécrite', () => {
    assert.equal(entryOf('paymentHistory').canOpen, canViewPaymentHistory);
    assert.equal(entryOf('audit').canOpen, isAdminRole);
    assert.equal(entryOf('settings').canOpen, isAdminRole);
  });

  it('chaque entrée nomme l’objet de la BASE qu’elle reflète', () => {
    for (const entry of RESERVED_TABS) {
      assert.ok(entry.basis.trim().length > 0, `${entry.tab} nomme son objet (policy ou fonction)`);
    }
    assert.match(entryOf('paymentHistory').basis, /is_payment_history_viewer/);
    assert.match(entryOf('audit').basis, /audit logs/);
    assert.match(entryOf('settings').basis, /is_admin/);
  });
});

// ─── 3. La non-divergence avec la base ───────────────────────────────────────

describe('la règle de l’app et la base ne peuvent pas diverger', () => {
  it('l’onglet du journal suit la policy « Admins can view audit logs »', () => {
    const sql = migration('20260814000000_audit_logs.sql');
    assert.deepEqual(
      [...entryOf('audit').roles].sort(),
      policyRoles(sql, 'Admins can view audit logs'),
      'un rôle ajouté d’un seul côté montrerait un onglet que la base rend vide',
    );
  });

  it('les Réglages suivent `public.is_admin()`', () => {
    const sql = migration('20260809000000_auth_and_rls.sql');
    assert.deepEqual([...entryOf('settings').roles].sort(), functionRoles(sql, 'is_admin'));
  });

  it('et le journal est gardé par la MÊME fonction que les Réglages, comme la base', () => {
    // Les deux onglets lisent `ADMIN_ROLES` : ce n'est pas une économie, c'est la
    // même liste côté base (`public.is_admin()` pour l'un, la policy du journal
    // pour l'autre) — et le cas ci-dessus a mesuré l'autre moitié.
    const sql = migration('20260809000000_auth_and_rls.sql');
    assert.deepEqual([...entryOf('audit').roles].sort(), functionRoles(sql, 'is_admin'));
  });

  it('l’historique des paiements suit `public.is_payment_history_viewer()`', () => {
    const sql = migration('20261020000000_econome_payment_history.sql');
    assert.deepEqual(
      [...entryOf('paymentHistory').roles].sort(),
      functionRoles(sql, 'is_payment_history_viewer'),
    );
  });

  it('aucun onglet réservé n’ouvre à un rôle qui n’existe pas dans l’application', () => {
    for (const entry of RESERVED_TABS) {
      for (const role of entry.roles) {
        assert.ok(
          (ROLE_POOL as readonly string[]).includes(role),
          `${entry.tab} nomme « ${role} », absent du vocabulaire des rôles (AppRole)`,
        );
      }
    }
  });
});

// ─── 4. Le fait de l'onglet : le journal se recharge ─────────────────────────

describe('beforeOpenTab — les écrans qui LISENT le journal le rechargent', () => {
  it('recharge pour le journal et pour l’historique des paiements', () => {
    for (const tab of ['audit', 'paymentHistory'] as const) {
      let calls = 0;
      beforeOpenTab(tab, () => {
        calls += 1;
      });
      assert.equal(calls, 1, `${tab} recharge le journal en s’ouvrant`);
    }
  });

  it('ne recharge rien pour les onglets qui ne le lisent pas', () => {
    for (const tab of ['settings', 'students', 'dashboard', 'silentReceipts']) {
      let calls = 0;
      beforeOpenTab(tab, () => {
        calls += 1;
      });
      assert.equal(calls, 0, `${tab} ne lit pas le journal`);
    }
  });

  it('ne casse rien quand l’écran ne peut pas le recharger (appel sans rappel)', () => {
    assert.doesNotThrow(() => beforeOpenTab('audit', undefined));
  });

  it('le fait est DÉCLARÉ par l’onglet, pas écrit dans les navigations', () => {
    // C'est ce qui a rendu la liste `if (tab === 'audit' || tab === 'paymentHistory')`
    // de la barre mobile inutile — et le contrôle refuse qu'une telle liste revienne.
    assert.equal(entryOf('audit').readsJournal, true);
    assert.equal(entryOf('paymentHistory').readsJournal, true);
    assert.equal(entryOf('settings').readsJournal, false);
  });
});
