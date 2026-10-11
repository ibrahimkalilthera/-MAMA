// Tests de scripts/lib/payment-ledger.mjs (et de la commande qui s'en sert,
// `npm run check:payment-ledger`, par sa FORME).
//
// WHY THIS EXISTS
// ---------------
// `students.amount_paid` duplique la somme de `payments.amount` : la même
// grandeur vit à deux endroits, et c'est le CLIENT qui réécrit la copie — en
// valeur absolue, depuis un instantané en mémoire, sans lire l'erreur de
// l'écriture. Le 2026-10-11, la mesure a trouvé un élève à 4 000 FCFA quand ses
// deux reçus en valaient 8 000 (encaissés à 52 secondes d'intervalle, les deux
// gestes au journal d'audit, le solde n'en comptant qu'un). Rien ne le voyait.
//
// Ces cas protègent ce qui se trompe SANS base, donc sans qu'on s'en aperçoive :
// une comparaison de deux TOTAUX au lieu d'une liste d'élèves (un écart global
// qui se compense passe inaperçu), un `inner join` qui rend invisibles les
// élèves sans aucune ligne de paiement, une comparaison de montants laissés en
// CHAÎNES (« 900 » > « 1000 » est vrai, et faux quand ça compte), et un rapport
// incapable de distinguer « le reçu n'est pas compté » de « le solde est en
// avance ».
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GAP_LABELS,
  LEDGER_DIVERGENCE_SQL,
  LEDGER_REPAIR_SQL,
  LEDGER_TOTALS_SQL,
  classifyGap,
  summarizeLedger,
} from '../scripts/lib/payment-ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('payment-ledger — le classement d’un écart dit le geste, pas seulement le signe', () => {
  it('l’écart MESURÉ : 4 000 au lieu de 8 000, c’est un reçu que le solde ne compte pas', () => {
    // REC-223352 (14:59:47) et REC-276036 (15:00:40) : deux reçus de 4 000, un
    // seul compté. Les deux gestes sont au journal d'audit, la ligne existe.
    assert.equal(classifyGap({ rollup: 4000, lines: 8000 }), 'receipt-not-counted');
    assert.match(GAP_LABELS['receipt-not-counted'], /reçu encaissé/);
  });

  it('un solde sans aucun reçu n’est PAS la même histoire', () => {
    // Cas d'une suppression de paiement dont la copie n'a pas suivi (ou d'une
    // fusion de fiches) : l'argent n'a jamais été encaissé sous cette fiche.
    assert.equal(classifyGap({ rollup: 4000, lines: 0 }), 'balance-without-receipt');
    assert.equal(classifyGap({ rollup: 4000, lines: 2000 }), 'balance-ahead');
    assert.equal(classifyGap({ rollup: 0, lines: 0 }), 'closed');
  });

  it('et il lit des montants VENUS DU SQL, donc des chaînes', () => {
    // `numeric` arrive en chaîne depuis `pg` : comparer « 900 » et « 1000 » en
    // texte donnerait « en avance » alors que le solde est en retard.
    assert.equal(classifyGap({ rollup: '900', lines: '1000' }), 'receipt-not-counted');
    assert.equal(classifyGap({ rollup: '1000', lines: '900' }), 'balance-ahead');
  });
});

describe('payment-ledger — le rapport porte sur des ÉLÈVES', () => {
  it('compte les écarts, les classe, et donne l’écart global', () => {
    const summary = summarizeLedger({
      divergences: [
        { student_id: 'stu-a', rollup: '4000', lines: '8000' }, // le cas mesuré
        { student_id: 'stu-b', rollup: '2000', lines: '0' },
        { student_id: 'stu-c', rollup: '5000', lines: '4000' },
      ],
      totals: { students: '497', payments: '97', rollup_total: '987000', lines_total: '991000' },
    });
    assert.equal(summary.students, 497);
    assert.equal(summary.payments, 97);
    assert.equal(summary.diverging, 3);
    assert.equal(summary.rollupTotal, 987000);
    assert.equal(summary.linesTotal, 991000);
    assert.equal(summary.gap, -4000, 'le montant reste un NOMBRE, jamais une chaîne');
    assert.deepEqual(
      summary.rows.map((row) => row.kind),
      ['receipt-not-counted', 'balance-without-receipt', 'balance-ahead'],
    );
    assert.deepEqual(summary.byKind, {
      'receipt-not-counted': 1,
      'balance-without-receipt': 1,
      'balance-ahead': 1,
    });
  });

  it('un écart qui se compense reste visible : ce sont les ÉLÈVES qui comptent', () => {
    // Deux élèves faux de 4 000 en sens inverse : l'écart GLOBAL est nul, et une
    // comparaison de totaux aurait déclaré le registre sain.
    const summary = summarizeLedger({
      divergences: [
        { student_id: 'stu-a', rollup: '4000', lines: '8000' },
        { student_id: 'stu-b', rollup: '8000', lines: '4000' },
      ],
      totals: { students: '2', payments: '2', rollup_total: '12000', lines_total: '12000' },
    });
    assert.equal(summary.gap, 0);
    assert.equal(summary.diverging, 2, 'un écart nul ne veut pas dire aucun écart');
  });

  it('un registre qui se referme se dit tel quel, sans inventer d’élève', () => {
    const summary = summarizeLedger({ divergences: [], totals: { students: '497', payments: '97' } });
    assert.equal(summary.diverging, 0);
    assert.deepEqual(summary.rows, []);
    assert.deepEqual(summary.byKind, {});
  });
});

describe('payment-ledger — la requête ne peut pas manquer les cas muets', () => {
  it('elle joint les élèves SANS paiement (left join) et attrape les soldes NULL', () => {
    assert.match(LEDGER_DIVERGENCE_SQL, /left join/i, 'un inner join rendrait invisibles les élèves sans aucune ligne');
    assert.match(LEDGER_DIVERGENCE_SQL, /is distinct from/i, 'un `<>` laisserait un amount_paid NULL hors de la liste');
    assert.match(LEDGER_DIVERGENCE_SQL, /coalesce\(s\.amount_paid, 0\)/);
    assert.match(LEDGER_DIVERGENCE_SQL, /order by abs\(/i, 'le plus gros écart d’abord, puis l’identifiant');
  });

  it('les totaux disent sur QUOI porte le contrôle', () => {
    for (const column of ['students', 'payments', 'rollup_total', 'lines_total']) {
      assert.match(LEDGER_TOTALS_SQL, new RegExp(`as ${column}`), `${column} est mesuré`);
    }
  });

  it('la réparation est bornée aux identifiants reçus, idempotente, et rend ce qui a changé', () => {
    assert.match(LEDGER_REPAIR_SQL, /where s\.id = any\(\$1::uuid\[\]\)/, 'jamais toute la table');
    assert.match(LEDGER_REPAIR_SQL, /is distinct from/i, 'réécrire une valeur déjà juste n’est pas une réparation');
    assert.match(LEDGER_REPAIR_SQL, /returning s\.id/i, 'la trace porte la valeur RÉELLE, pas l’intention');
  });
});

describe('check:payment-ledger — la commande elle-même, telle qu’elle est écrite', () => {
  const source = read('scripts/check-payment-ledger.mjs');
  const pkg = JSON.parse(read('package.json'));

  it('elle existe sous son nom, et vise la base partagée', () => {
    assert.equal(pkg.scripts['check:payment-ledger'], 'node scripts/check-payment-ledger.mjs');
    assert.match(source, /SHARED_PROJECT_REF/, 'la connexion est construite sur le ref partagé');
  });

  it('sans --repair, elle n’écrit RIEN — et le drapeau est explicite', () => {
    assert.match(source, /const REPAIR = args\.includes\('--repair'\)/);
    assert.match(source, /if \(REPAIR && summary\.diverging > 0\)/, 'toute écriture est sous le drapeau');
    // Les deux seules écritures de la commande : le solde et sa trace.
    const writes = source.match(/client\.query\((LEDGER_REPAIR_SQL|LEDGER_REPAIR_AUDIT_SQL)/g) ?? [];
    assert.equal(writes.length, 2, 'une écriture de correction, une écriture de journal — pas une de plus');
    // Les deux APPELS, pas les deux noms : l'import est alphabétique, donc
    // `…_AUDIT_SQL` y précède `…_REPAIR_SQL` sans rien dire de l'ordre du geste.
    const updateAt = source.indexOf('client.query(LEDGER_REPAIR_SQL');
    const auditAt = source.indexOf('client.query(LEDGER_REPAIR_AUDIT_SQL');
    assert.ok(updateAt > 0 && auditAt > updateAt, 'la trace se lit APRÈS coup, sur ce qui a réellement changé');
  });

  it('un écart rend la commande ROUGE (exit 1) sans laisser croire à une réparation', () => {
    assert.match(source, /if \(summary\.diverging > 0 && !REPAIR\) process\.exitCode = 1;/);
  });

  it('et elle refuse de verdir sans mot de passe ni lecture', () => {
    assert.match(source, /SUPABASE_DB_PASSWORD absent/);
    assert.match(source, /process\.exit\(2\)/, 'ne pas avoir pu regarder n’est pas un vert');
  });
});
