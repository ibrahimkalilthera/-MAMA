// Le solde d'un élève, calculé par la BASE — ce que la migration déclare, lu
// structurellement.
//
// WHY THIS EXISTS
// ---------------
// `students.amount_paid` duplique la somme de `payments.amount`. Le 2026-10-11,
// deux reçus encaissés à 52 secondes d'intervalle ont laissé un élève à 4 000
// FCFA quand ses lignes en valaient 8 000 : le client réécrivait la copie en
// valeur ABSOLUE, depuis un instantané en mémoire, et le second geste est parti
// d'un instantané qui ne contenait pas encore le premier. Le 2026-11-06, la veille
// du registre a nommé un second cas (un reçu de 4 000 que le solde ignorait).
//
// La migration `20261107000000_students_balance_from_receipts.sql` ferme les deux
// côtés : un déclencheur BEFORE sur `students` REMPLACE les colonnes dérivées par
// ce que disent les reçus (le client ne peut plus écrire un solde), et un
// déclencheur AFTER sur `payments` recalcule la fiche touchée. Ces cas protègent
// ce qui se trompe SANS base : un déclencheur qui ne se déclencherait que sur
// INSERT, une orientation STATEMENT au lieu de ROW, une fonction SECURITY INVOKER
// (le recalcul serait alors filtré par la RLS, donc muet), un `search_path` libre
// (détournement d'une fonction SECURITY DEFINER), ou un rattrapage oublié.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCreateTrigger } from '../scripts/lib/db-objects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'supabase/migrations/20261107000000_students_balance_from_receipts.sql';

function migrationText(): string {
  return readFileSync(join(ROOT, MIGRATION), 'utf8');
}

/** Le texte d'un `CREATE TRIGGER … ;` nommé, tel qu'il est écrit. */
function triggerStatement(sql: string, name: string): string {
  const pattern = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[\\s\\S]*?EXECUTE\\s+FUNCTION[\\s\\S]*?;`, 'i');
  const match = pattern.exec(sql);
  assert.ok(match, `le déclencheur ${name} est déclaré par la migration`);
  return match[0];
}

/** Le corps d'une fonction PL/pgSQL nommée, pour lire ses garanties. */
function functionText(sql: string, name: string): string {
  const pattern = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i');
  const match = pattern.exec(sql);
  assert.ok(match, `la fonction ${name} est déclarée par la migration`);
  return match[0];
}

describe('le solde vient des reçus — la migration, lue comme un catalogue', () => {
  const sql = migrationText();

  it('le côté `students` REMPLACE les deux colonnes dérivées, sur INSERT et sur UPDATE', () => {
    const trigger = parseCreateTrigger(triggerStatement(sql, 'students_balance_derived'));
    assert.ok(trigger, 'le déclencheur se lit comme le catalogue le rendrait');
    assert.equal(trigger.table, 'students');
    assert.equal(trigger.timing, 'BEFORE');
    // INSERT **et** UPDATE : une écriture du client passe par UPDATE, mais un
    // import de fiches passe par INSERT — ne garder que l'un laisserait l'autre
    // chemin ouvert, et c'est exactement par là qu'un solde sans reçu entrerait.
    assert.deepEqual(trigger.events, ['INSERT', 'UPDATE']);
    assert.equal(trigger.orientation, 'ROW', 'une orientation STATEMENT ne verrait aucune ligne');
    assert.equal(trigger.functionName, 'derive_student_balance');
  });

  it('le côté `payments` recalcule après coup, sur les trois gestes', () => {
    const trigger = parseCreateTrigger(triggerStatement(sql, 'payments_sync_student_balance'));
    assert.ok(trigger);
    assert.equal(trigger.table, 'payments');
    assert.equal(trigger.timing, 'AFTER', 'un BEFORE lirait la ligne d’avant le geste');
    // INSERT : un reçu encaissé ; UPDATE : un reçu ré-attribué ou corrigé ;
    // DELETE : un reçu annulé. En manquer un laisserait la copie en arrière.
    assert.deepEqual(trigger.events, ['DELETE', 'INSERT', 'UPDATE']);
    assert.equal(trigger.orientation, 'ROW');
    assert.equal(trigger.functionName, 'sync_student_balance_from_receipts');
  });

  it('les fonctions sont SECURITY DEFINER avec un `search_path` figé', () => {
    for (const name of ['student_balance_from_receipts', 'derive_student_balance', 'sync_student_balance_from_receipts']) {
      const text = functionText(sql, name);
      assert.match(text, /SECURITY\s+DEFINER/i, `${name} : le recalcul ne dépend pas des droits de l’auteur du geste`);
      // Sans ce verrou, une table homonyme posée par un client se ferait lire par
      // une fonction qui écrit avec les droits du propriétaire.
      assert.match(text, /SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `${name} : search_path figé`);
    }
  });

  it('la dérivation est la SOMME des reçus, et la date leur maximum', () => {
    const text = functionText(sql, 'student_balance_from_receipts');
    assert.match(text, /coalesce\(sum\(p\.amount\),\s*0\)/i, 'le solde est la somme des lignes, jamais une valeur déclarée');
    assert.match(text, /max\(p\.date\)/i, 'la dernière date est celle du reçu le plus récent');
    assert.match(text, /where\s+p\.student_id\s*=\s*p_student_id/i, 'par fiche, jamais un total global');
  });

  it('une ré-attribution recalcule les DEUX fiches', () => {
    const text = functionText(sql, 'sync_student_balance_from_receipts');
    assert.match(text, /OLD\.student_id/i, 'la fiche d’origine perd le reçu qu’elle n’a plus');
    assert.match(text, /NEW\.student_id/i, 'la fiche d’arrivée le gagne');
  });

  it('les fiches DÉJÀ en base sont rattrapées, pas seulement les gestes futurs', () => {
    // Un fichier qui ne répare que l'avenir laisserait l'ancien mensonge en place :
    // c'est la règle que `check-payment-ledger` applique déjà au cas mesuré.
    assert.match(sql, /UPDATE\s+public\.students\s+s\s+SET\s+amount_paid\s*=\s*coalesce/i);
    assert.match(sql, /last_payment_date\s*=\s*\(\s*SELECT\s+max\(p\.date\)/i);
  });

  it('l’index qui soutient le calcul est déclaré, et de façon rejouable', () => {
    assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_payments_student_id\s+ON\s+public\.payments\(student_id\)/i);
  });

  it('le fichier est rejouable : ses déclencheurs se retirent avant d’être reposés', () => {
    for (const name of ['students_balance_derived', 'payments_sync_student_balance']) {
      assert.match(sql, new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\s+ON`, 'i'));
    }
  });
});
