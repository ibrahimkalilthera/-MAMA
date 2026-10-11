// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/payment-ledger.mjs — le registre des paiements, réconcilié.
//
// ─── Le fait mesuré, le 2026-10-11 ──────────────────────────────────────────
// `students.amount_paid` DUPLIQUE la somme de `payments.amount` : la même
// grandeur vit à deux endroits, et le client réécrit la copie en valeur ABSOLUE
// depuis un instantané en mémoire (src/lib/dataOps/payments.ts), sans lire
// l'erreur de cette écriture. Sur les 497 élèves mesurés, 86 des 87 payeurs se
// refermaient exactement — et un seul non : 4 000 FCFA au lieu de 8 000, deux
// reçus distincts encaissés à 52 secondes d'intervalle (REC-223352 à 14:59:47,
// REC-276036 à 15:00:40), les deux gestes présents au journal d'audit, le solde
// n'en comptant qu'un. Rien, ni dans l'application ni dans la CI, ne le voyait.
//
// ─── Ce que ce module décide, et dans quel ordre ────────────────────────────
// Le contrôle est une RÉCONCILIATION, pas une comparaison de deux totaux. Un
// écart global de 4 000 FCFA peut venir d'un élève faux de 4 000 ou de vingt
// élèves faux de 200 — et la réparation ne s'adresse qu'à des élèves. La
// question posée est donc « quels élèves portent deux montants qui ne se
// referment pas », et la réponse est une liste d'identifiants, jamais un nom :
// un contrôle de caisse n'a pas besoin de savoir comment s'appelle l'enfant.
//
// ─── Laquelle des deux colonnes est la référence ────────────────────────────
// `payments` EST le registre : un reçu, une ligne, un montant, une date.
// `amount_paid` en est une copie d'affichage, écrite en dernier et donc faillible.
// La somme des lignes fait donc foi, et le classement d'un écart le dit en clair :
// « le reçu existe, la copie est en retard ». L'inverse (une copie en avance sur
// les reçus) n'est pas la même histoire, et le rapport les sépare.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les élèves dont les deux montants ne se referment PAS.
 *
 * `left join` et non `inner join` : un élève dont `amount_paid` vaut 4 000 sans
 * AUCUNE ligne de paiement — une suppression de paiement dont la copie n'a pas
 * suivi — est précisément le cas qu'un inner join rend invisible. Un `inner join`
 * ne regarde que les élèves qui ont des paiements, c'est-à-dire ceux qui vont
 * bien.
 *
 * `coalesce` des deux côtés et `is distinct from` plutôt que `<>` : `amount_paid`
 * est NULLable, `null <> 4000` n'est pas vrai en SQL, et un solde NULL aurait
 * donc disparu de la liste au lieu d'y figurer avec ses 4 000 de trop.
 *
 * Le tri met en tête ce qui compte le plus (l'écart absolu), et l'identifiant
 * tranche à égalité — deux exécutions du même état rendent le même ordre, donc
 * deux rapports se comparent.
 */
export const LEDGER_DIVERGENCE_SQL = `
  select s.id as student_id,
         coalesce(s.amount_paid, 0) as rollup,
         coalesce(p.total, 0) as lines,
         coalesce(s.amount_paid, 0) - coalesce(p.total, 0) as gap
    from public.students s
    left join (
      select student_id, sum(amount) as total
        from public.payments
       group by student_id
    ) p on p.student_id = s.id
   where coalesce(s.amount_paid, 0) is distinct from coalesce(p.total, 0)
   order by abs(coalesce(s.amount_paid, 0) - coalesce(p.total, 0)) desc, s.id
`;

/**
 * Les totaux, pour dire sur QUOI porte le contrôle.
 *
 * Un contrôle qui ne dit pas combien d'élèves et de paiements il a regardés ne
 * prouve rien : « aucun écart » sur une base vide et « aucun écart » sur 497
 * élèves s'écrivent de la même façon dans un journal.
 */
export const LEDGER_TOTALS_SQL = `
  select (select count(*)::int from public.students) as students,
         (select count(*)::int from public.payments) as payments,
         (select coalesce(sum(amount_paid), 0) from public.students) as rollup_total,
         (select coalesce(sum(amount), 0) from public.payments) as lines_total
`;

/**
 * Le geste de réparation, borné aux élèves qu'on a DÉCIDÉ de réparer.
 *
 * Une sous-requête scalaire, et pas un `from (…) p` : un élève sans aucun
 * paiement n'a pas de ligne à joindre, et c'est justement un cas à réparer.
 * `where … is distinct from` rend l'écriture idempotente : si l'application a
 * écrit la bonne valeur entre-temps, la ligne n'est pas touchée, et le `returning`
 * dit alors ce qui a RÉELLEMENT changé — c'est cette réponse qui part au journal
 * d'audit, jamais l'intention.
 */
export const LEDGER_REPAIR_SQL = `
  update public.students s
     set amount_paid = coalesce(
           (select sum(amount) from public.payments where student_id = s.id), 0)
   where s.id = any($1::uuid[])
     and s.amount_paid is distinct from coalesce(
           (select sum(amount) from public.payments where student_id = s.id), 0)
  returning s.id as student_id, s.amount_paid as amount_paid
`;

/** La ligne du journal d'audit qui rend la réparation lisible par l'école. */
export const LEDGER_REPAIR_AUDIT_SQL = `
  insert into public.audit_logs (action, target_type, target_id, details, metadata, user_role)
  values ('REPAIR_AMOUNT_PAID', 'student', $1, $2, $3::jsonb, 'dev')
`;

/**
 * Ce qu'un écart VEUT DIRE — le geste qu'il appelle, pas seulement son signe.
 *
 * @param {{ rollup?: number|string, lines?: number|string }} input
 * @returns {'receipt-not-counted'|'balance-without-receipt'|'balance-ahead'|'closed'}
 */
export function classifyGap({ rollup = 0, lines = 0 } = {}) {
  const paid = Number(rollup ?? 0);
  const ledger = Number(lines ?? 0);
  if (ledger > paid) return 'receipt-not-counted';
  if (ledger === 0 && paid > 0) return 'balance-without-receipt';
  if (paid > ledger) return 'balance-ahead';
  return 'closed';
}

/** Le libellé d'un écart, tel qu'il se lit dans un rapport ou un journal. */
export const GAP_LABELS = {
  'receipt-not-counted': 'un reçu encaissé que le solde ne compte pas',
  'balance-without-receipt': 'un solde affiché sans aucun reçu',
  'balance-ahead': 'un solde affiché au-delà des reçus',
  closed: 'les deux montants se referment',
};

/**
 * Le rapport : les écarts classés, et les totaux sur lesquels ils portent.
 *
 * Les montants sont ramenés en NOMBRES avant d'être comparés : `numeric` arrive
 * en chaîne depuis `pg` (« 8000 »), et « 8000 » > « 4000 » est vrai par accident
 * pendant que « 900 » > « 1000 » est faux. Comparer des chaînes de montants
 * donnerait un rapport juste la plupart du temps — c'est-à-dire faux quand ça
 * compte.
 *
 * @param {{ divergences?: { student_id?: string, id?: string, rollup?: unknown, lines?: unknown }[],
 *   totals?: { students?: unknown, payments?: unknown, rollup_total?: unknown, lines_total?: unknown } }} input
 */
export function summarizeLedger({ divergences = [], totals = {} } = {}) {
  const rows = divergences.map((row) => {
    const rollup = Number(row.rollup ?? 0);
    const lines = Number(row.lines ?? 0);
    return {
      id: row.student_id ?? row.id ?? '',
      rollup,
      lines,
      gap: rollup - lines,
      kind: classifyGap({ rollup, lines }),
    };
  });

  /** @type {Record<string, number>} */
  const byKind = {};
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;

  const rollupTotal = Number(totals.rollup_total ?? 0);
  const linesTotal = Number(totals.lines_total ?? 0);

  return {
    students: Number(totals.students ?? 0),
    payments: Number(totals.payments ?? 0),
    rollupTotal,
    linesTotal,
    gap: rollupTotal - linesTotal,
    diverging: rows.length,
    rows,
    byKind,
  };
}
