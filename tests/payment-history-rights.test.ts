/**
 * Suite for `src/lib/paymentHistoryRights.ts` — qui peut LIRE l'historique des
 * paiements, tel que la BASE le décide.
 *
 * Le défaut, mesuré le 2026-10-15 : l'économe n'avait pas la ligne du rail, et sa
 * cause n'était pas dans le rail. `audit_logs` n'était lisible que par
 * `admin`/`dev` (« Admins can view audit logs », 20260814000000), et l'historique
 * des paiements se LIT dans ce journal — c'est le seul endroit du dépôt qui nomme
 * l'encaisseur. Ouvrir l'onglet sans la lecture aurait affiché « rien encaissé »
 * sur une caisse pleine.
 *
 * La décision du propriétaire n'ouvre PAS le journal à l'économe : elle lui ouvre
 * une policy SUPPLÉMENTAIRE, filtrée par `action`, qui ne lui rend que les lignes
 * dont cet écran est fait. Cette suite tient les trois moitiés de cette phrase :
 *
 *   1. la RÈGLE (qui lit, qui ne lit pas), et le fait que ce droit ne suit ni la
 *      suppression d'un élève ni celui de la caisse ;
 *   2. la NON-DIVERGENCE avec la migration — les rôles de
 *      `public.is_payment_history_viewer()` sont comparés dans les deux sens ;
 *   3. le PÉRIMÈTRE DES LIGNES — l'union des deux listes d'ACTIONS de
 *      l'application (`PAYMENT_HISTORY_ACTIONS` + `CORRECTION_HISTORY_ACTIONS`)
 *      est comparée à la liste `action IN (…)` de la policy. C'est ce qui empêche
 *      l'écran de montrer un bloc que la base ne rend pas (ou l'inverse) : le
 *      filtre de la policy est écrit en SQL, les deux listes sont écrites en
 *      TypeScript, et rien d'autre ne les tient ensemble.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYMENT_HISTORY_VIEWER_ROLES, canViewPaymentHistory } from '../src/lib/paymentHistoryRights';
import { PAYMENT_HISTORY_ACTIONS } from '../src/lib/paymentHistory';
import { CORRECTION_HISTORY_ACTIONS } from '../src/lib/correctionHistory';
import { canDeleteRecords, isAdminRole } from '../src/lib/deleteRights';
import { canDeletePayments, canUpdatePaymentMonths } from '../src/lib/paymentRights';
// Le blanchiment PARTAGÉ des commentaires SQL (commentaires et littéraux remplacés
// par des espaces, longueurs conservées) : c'est lui qui empêche la prose de la
// migration de satisfaire une vérification de structure — la leçon que ce dépôt a
// déjà payée trois fois sur des contrôles textuels.
import { blankComments } from '../scripts/lib/schema-expected.mjs';

const ROOT = join(import.meta.dirname, '..');
// La migration qui ouvre la lecture à l'économe : elle porte le helper
// `is_payment_history_viewer()` et la policy filtrée dont ce module est le miroir.
const HISTORY_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261020000000_econome_payment_history.sql');
// Celle qui garde le journal — et qui doit RESTER telle quelle : la lecture de
// `admin`/`dev` ne doit pas bouger d'une ligne sous prétexte d'en ajouter une.
const JOURNAL_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260814000000_audit_logs.sql');

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

/**
 * Les ACTIONS que la policy ouvre — la liste `action IN (…)`, lue sur l'ORIGINAL.
 *
 * Les BORNES de la liste se trouvent sur le texte BLANCHI (les parenthèses d'un
 * commentaire y sont des espaces, donc la première parenthèse fermante rencontrée
 * est celle de la liste), et les jetons se lisent sur l'ORIGINAL — ils sont entre
 * apostrophes, donc blanchis au même endroit. Un commentaire qui citerait un geste
 * ne peut donc ni ouvrir la liste, ni y ajouter un jeton.
 */
function actionsOf(sql: string): string[] {
  const masked = blankComments(sql);
  const at = masked.indexOf('action IN (');
  assert.ok(at > 0, 'la policy porte une liste `action IN (…)`');
  let depth = 0;
  let end = -1;
  for (let i = at + 'action IN '.length; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > at, 'la liste d’actions est fermée');
  const actions = [...sql.slice(at, end).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
  assert.ok(actions.length > 0, 'la liste d’actions n’est pas vide');
  return [...actions].sort();
}

// ─── La règle ────────────────────────────────────────────────────────────────

describe('paymentHistoryRights — qui la base laisse lire l’historique des paiements', () => {
  it('l’économe le lit (la décision du 2026-10-15), comme admin et dev', () => {
    // C'est LUI qui tient la caisse : lui cacher qui a encaissé quoi revenait à lui
    // demander de répondre à une question sans lui en donner les moyens.
    for (const role of ['admin', 'dev', 'econome']) {
      assert.equal(canViewPaymentHistory(role), true, `${role} lit l’historique des paiements`);
    }
    assert.equal(canViewPaymentHistory(' Econome '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('ni `staff`, ni `general_manager`, ni un rôle inconnu ne le lisent', () => {
    for (const role of ['staff', 'general_manager', null, undefined, '', '  ', 'root']) {
      assert.equal(canViewPaymentHistory(role), false, `« ${String(role)} » ne lit pas l’historique des paiements`);
    }
  });

  it('lire l’historique n’EST PAS administrer : l’économe reste hors des tables admin', () => {
    // Trois droits voisins, trois portées : lire ces lignes (ici), supprimer un
    // reçu (`is_payment_deleter`), détruire une table réservée aux admins
    // (`is_admin`). Les confondre rouvrirait des gestes que la base refuse.
    assert.equal(canViewPaymentHistory('econome'), true);
    assert.equal(canDeleteRecords('econome'), false, 'les tables admin restent hors de portée');
    assert.equal(isAdminRole('econome'), false, 'l’économe n’est pas un administrateur');
    // …et le droit de lire ne va pas non plus à un surveillant, même s'il peut
    // désormais voir l'écran « reçus muets » (qui ne lit aucune table).
    assert.equal(canViewPaymentHistory('staff'), false);
    assert.equal(canDeletePayments('staff'), false);
    assert.equal(canUpdatePaymentMonths('staff'), false);
  });
});

// ─── La non-divergence avec la migration ─────────────────────────────────────

describe('la règle de l’app et la fonction de la base ne peuvent pas diverger', () => {
  const sql = readFileSync(HISTORY_MIGRATION, 'utf8');
  // Les vérifications de STRUCTURE se font sur le texte blanchi : la prose de la
  // migration cite le helper, la policy et les gestes — elle ne doit donc pas
  // pouvoir satisfaire un contrôle écrit pour le CODE.
  const masked = blankComments(sql);

  it('les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYMENT_HISTORY_VIEWER_ROLES].sort(),
      rolesOf(sql, 'is_payment_history_viewer'),
      'un rôle ajouté d’un seul côté montrerait un onglet que la base rend vide',
    );
  });

  it('la policy s’appuie sur ce helper, et n’est ouverte qu’aux comptes connectés', () => {
    // `anon` n’a pas de session : `auth.uid()` y est NULL, donc le helper est faux —
    // mais le `TO authenticated` est la barrière qui ne dépend pas de ce détail.
    assert.match(
      masked,
      /CREATE POLICY "Payment history viewers read payment gestures"\s*\n\s*ON public\.audit_logs\s*\n\s*FOR SELECT\s*\n\s*TO authenticated\s*\n\s*USING \(\s*\n\s*public\.is_payment_history_viewer\(\)/,
      'la policy SELECT de l’historique est nommée, sur audit_logs, pour authenticated, gardée par le helper',
    );
    assert.doesNotMatch(masked, /TO anon\b|TO public\b/i, 'aucune ligne de cet écran n’est lisible sans session');
  });

  it('la policy est IDEMPOTENTE : elle se retire avant de se poser', () => {
    // `db:apply` refuse un ajout déjà présent plutôt que de le doubler : une
    // migration rejouée doit donc passer par un DROP, comme ses voisines.
    assert.match(
      masked,
      /DROP POLICY IF EXISTS "Payment history viewers read payment gestures" ON public\.audit_logs/,
      'sans le DROP, un second passage sur la base ferait échouer l’application',
    );
  });
});

// ─── Le périmètre des LIGNES ─────────────────────────────────────────────────

describe('l’économe lit les lignes de son écran, et pas une de plus', () => {
  const sql = readFileSync(HISTORY_MIGRATION, 'utf8');
  const masked = blankComments(sql);

  it('la policy ouvre EXACTEMENT les gestes de caisse et les corrections d’argent', () => {
    // Les deux listes vivent dans l'application, à côté des écrans qui les
    // montrent : les trois gestes de la caisse, et les quatre corrections que le
    // bloc « gestes de correction » affiche. Un geste ajouté d'un seul côté ferait
    // un écran qui montre plus que la base ne rend (ou un bloc vide qui se lirait
    // « rien n'a été retiré du registre »).
    const expected = [...PAYMENT_HISTORY_ACTIONS, ...CORRECTION_HISTORY_ACTIONS].sort();
    assert.deepEqual(actionsOf(sql), expected, 'l’union des deux listes doit être celle de la policy');
    assert.equal(expected.length, 7, 'sept gestes : trois de caisse, quatre de correction');
  });

  it('le RESTE du journal n’est pas ouvert pour autant', () => {
    // Ce que la policy NE nomme pas reste refusé à l'économe : les changements de
    // rôle, les suppressions d'élèves, les réglages — et l'ouverture de la caisse
    // (`ADD_EXPENSE`, `RECORD_SALARY_PAYMENT`), qui n'est pas un historique.
    const opened = new Set(actionsOf(sql));
    for (const action of ['UPDATE_USER_ROLE', 'DELETE_STUDENT', 'ADD_STUDENT', 'RECORD_SALARY_PAYMENT']) {
      assert.equal(opened.has(action), false, `${action} ne fait pas partie de cet écran`);
    }
  });

  it('elle n’ouvre AUCUNE écriture : le journal reste en insertion seule', () => {
    assert.doesNotMatch(masked, /FOR (INSERT|UPDATE|DELETE|ALL)/i, 'une lecture ne se paie pas d’un droit d’écriture');
  });

  it('la lecture d’admin/dev reste ENTIÈRE : les policies s’additionnent', () => {
    // La policy du journal (20260814000000) n'est pas retirée ni réécrite : une
    // policy permissive en plus AJOUTE des lignes, elle n'en enlève aucune. C'est
    // la raison du choix — le journal d'audit des administrateurs ne change pas.
    const journal = readFileSync(JOURNAL_MIGRATION, 'utf8');
    assert.match(journal, /CREATE POLICY "Admins can view audit logs"[\s\S]*?role IN \('admin', 'dev'\)/);
    assert.doesNotMatch(masked, /DROP POLICY IF EXISTS "Admins can view audit logs"/, 'le journal des admins n’est pas retiré');
  });
});
