// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/offline-queue-audit.mjs — JUGER une file hors-ligne sans y toucher.
//
// ─── Pourquoi ce module existe ──────────────────────────────────────────────
// Le 2026-11-27, le poste de l'école portait 38 gestes en attente, tous refusés
// à la synchronisation (« insert or update on table "payments" violates foreign
// key constraint »). Leur élève n'avait jamais été créé : la base refusait son
// insertion depuis le 24/11 à cause d'un matricule tronqué (migration
// 20261127000000). La question posée était donc : « lesquels sont récupérables,
// lesquels sont perdus, et à quel élève rattacher ceux qui pointent vers un
// identifiant que la base n'a jamais vu ? »
//
// Une file ne se répare pas en la vidant. Chaque geste est une recette ou un
// paiement ; les supprimer à l'aveugle, c'est effacer de l'argent encaissé. Ce
// module ne supprime donc RIEN : il CLASSE chaque entrée par ce que la base
// fera d'elle au prochain drainage, à partir de trois faits seulement —
// la file elle-même, les élèves en base, les reçus en base.
//
// ─── Le fait qui rend la récupération possible ──────────────────────────────
// Hors ligne, l'élève reçoit un UUID (`createRowId`, src/lib/rowMappers.ts). Cet
// UUID voyage DEUX fois : comme `localId` du geste `addStudent` (le rejeu
// l'envoie comme `id` de la ligne — voir `rowIdColumn` dans offlineReplay.ts) et
// comme `studentId` de chacun de ses paiements. Tant que le geste `addStudent`
// est en file, rien n'est orphelin : le drainage crée l'élève AVEC cet
// identifiant, et les paiements qui le suivent tombent juste. C'est seulement
// quand ce geste a disparu — ou quand la fiche a été recréée à la main entre
// temps, avec un AUTRE identifiant — qu'il faut réécrire les références.
//
// ─── Ce module ne décide rien de la réparation ──────────────────────────────
// Il classe et il PROPOSE (une fiche déjà en base avec la même clé métier donne
// une correspondance automatique, sans ambiguïté). Le rattachement qui demande
// un humain — « ce reçu de 15 000 F du 12/11, c'est bien Amadou BOLLY ? » — est
// rendu sous forme de liste lisible, avec le reçu, la date et le montant, pour
// que l'école reconnaisse le papier qu'elle a en main. `rewriteQueue` applique
// ensuite une correspondance DÉCIDÉE, et rend la file corrigée ; l'écriture en
// base, elle, reste le travail du rejeu de l'application (mêmes déclencheurs,
// même journal, même idempotence).
// ─────────────────────────────────────────────────────────────────────────────

/** La clé `localStorage` que lit et écrit `src/lib/offlineQueue.ts`. */
export const QUEUE_STORAGE_KEY = 'mama_thera_offline_queue';

/** Les verdicts, nommés une fois — le rapport et les tests lisent les mêmes. */
export const VERDICT = {
  /** Aucun élève en jeu (dépense, réglage, note, journal…). */
  SANS_REFERENCE: 'sans-reference',
  /** La ligne que ce geste créerait est DÉJÀ en base : le drainage le retirera en 23505, sans rien perdre. */
  DEJA_EN_BASE: 'deja-en-base',
  /** L'élève visé existe : le prochain drainage passera. */
  PRET_A_PARTIR: 'pret-a-partir',
  /** L'élève visé n'existe pas ENCORE, mais un `addStudent` de la file le crée — avec ce même identifiant. */
  CREE_PAR_LA_FILE: 'cree-par-la-file',
  /** L'élève visé n'existe pas et rien dans la file ne le crée : à rattacher à une fiche réelle. */
  ELEVE_A_RATTACHER: 'eleve-a-rattacher',
  /** La fiche à créer existe déjà (même nom + téléphone + classe + année) : adopter l'identifiant existant. */
  DOUBLON_METIER: 'doublon-metier',
  /** Le numéro de reçu est déjà porté par un AUTRE paiement : le geste sera refusé éternellement. */
  RECU_DEJA_PRIS: 'recu-deja-pris',
  /** La ligne visée (paiement à corriger/supprimer) n'existe pas : le geste ne fera rien. */
  CIBLE_ABSENTE: 'cible-absente',
};

/** Le verdict est-il un blocage à trancher par l'école ? */
export function isBlocking(verdict) {
  return verdict === VERDICT.ELEVE_A_RATTACHER
    || verdict === VERDICT.DOUBLON_METIER
    || verdict === VERDICT.RECU_DEJA_PRIS
    || verdict === VERDICT.CIBLE_ABSENTE;
}

/**
 * `btrim` de PostgreSQL : les ESPACES, pas les autres blancs.
 *
 * La clé métier de la base (`students_business_key_unique`) est écrite avec
 * `btrim`, et non `trim` : s'en écarter ferait proposer un rattachement que la
 * base refuserait, sur un nom qui finit par une espace insécable.
 */
function btrim(value) {
  return typeof value === 'string' ? value.replace(/^ +| +$/g, '') : '';
}

/**
 * La clé métier EXACTE de `students_business_key_unique` (migration
 * 20261005000002), recalculée en JS :
 *   lower(btrim(name)) · btrim(parent_phone) · lower(btrim(grade)) · academic_year
 *
 * C'est elle qui décide si un `addStudent` en file est un doublon : la
 * recalculer autrement ferait proposer un rattachement que la base refuserait.
 */
export function businessKeyOf(student) {
  const studentLike = student && typeof student === 'object' ? student : {};
  return [
    btrim(studentLike.name).toLowerCase(),
    btrim(studentLike.parentPhone),
    btrim(studentLike.grade).toLowerCase(),
    studentLike.academicYear == null ? '' : String(studentLike.academicYear),
  ].join('\u0001');
}

/** L'élève désigné par un geste, ou `null` — une seule lecture pour toutes les branches. */
export function studentRefOf(item) {
  const type = item?.type;
  const payload = item?.payload ?? {};
  switch (type) {
    case 'addPayment':
    case 'deletePayment':
    case 'updatePaymentMonths':
      return typeof payload.studentId === 'string' && payload.studentId ? payload.studentId : null;
    case 'updateStudent':
    case 'deleteStudent':
      return typeof payload.id === 'string' && payload.id ? payload.id : null;
    case 'addTodo':
    case 'updateTodo':
      return typeof payload.studentId === 'string' && payload.studentId ? payload.studentId : null;
    default:
      return null;
  }
}

/** La ligne créée par un geste quand la base ne doit pas générer son id. */
export function createdRowIdOf(item) {
  const localId = item?.localId;
  return typeof localId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)
    ? localId
    : null;
}

/**
 * Normalise ce que le poste a exporté : la liste brute, l'objet
 * `{ queue: [...] }`, ou le texte `localStorage` encore emballé.
 *
 * Un contenu qui n'est pas une liste de gestes est un REFUS nommé : « je n'ai
 * pas pu lire » ne doit jamais se présenter comme « la file est vide » — c'est
 * précisément la confusion qui a fait perdre des gestes le 2026-10-05
 * (`storageUnreadable` dans src/lib/offlineQueue.ts).
 */
export function normalizeQueue(input) {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new Error(`Contenu illisible : ce n’est pas du JSON (${error.message})`, { cause: error });
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = value.queue ?? value.items ?? value[QUEUE_STORAGE_KEY];
    if (typeof value === 'string') return normalizeQueue(value);
  }
  if (!Array.isArray(value)) throw new Error('Contenu illisible : la file doit être une liste de gestes.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Entrée ${index + 1} : ce n’est pas un geste.`);
    if (typeof item.type !== 'string' || !item.type) throw new Error(`Entrée ${index + 1} : aucun type de geste.`);
    if (!item.payload || typeof item.payload !== 'object') throw new Error(`Entrée ${index + 1} (${item.type}) : aucun contenu.`);
    return item;
  });
}

/** Une date lisible, sans fuseau qui décale d'un jour. */
function dayOf(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

/**
 * Un geste classé — la forme que lit le rapport.
 *
 * @typedef {object} AuditEntry
 * @property {number} index position dans la file (1 = premier geste)
 * @property {string|null} id identifiant de l'entrée de file
 * @property {string} type type de geste (`addPayment`, `addStudent`…)
 * @property {string|null} createdAt
 * @property {number} attempts
 * @property {string|null} lastError
 * @property {string} verdict un des `VERDICT`
 * @property {string} detail ce que la base fera, en une phrase
 * @property {string} [studentRef] l'identifiant d'élève visé
 * @property {string} [proposedStudentId] fiche à adopter quand elle est certaine
 * @property {string} [receiptNumber] ce que le papier du reçu porte
 * @property {number|string} [amount]
 * @property {string} [date]
 */

/**
 * Classe chaque geste par ce que la base en fera au prochain drainage.
 *
 * @param {{ items: Array, students?: Array, payments?: Array }} input
 *   `students` : `[{ id, name, parent_phone, grade, academic_year }]`
 *   `payments` : `[{ id, student_id, receipt_number, amount, date }]`
 * @returns {{
 *   total: number,
 *   entries: AuditEntry[],
 *   byVerdict: Record<string, number>,
 *   mapping: Record<string, string>,
 *   blocking: AuditEntry[],
 *   recoverable: AuditEntry[],
 *   toAttach: AuditEntry[],
 * }}
 */
export function auditOfflineQueue({ items, students = [], payments = [] } = {}) {
  const queue = normalizeQueue(items ?? []);

  const studentIds = new Set(students.map((s) => s.id).filter(Boolean));
  const paymentIds = new Set(payments.map((p) => p.id).filter(Boolean));
  const byBusinessKey = new Map();
  for (const student of students) {
    const key = businessKeyOf({
      name: student.name,
      parentPhone: student.parent_phone ?? student.parentPhone,
      grade: student.grade,
      academicYear: student.academic_year ?? student.academicYear,
    });
    if (!btrim(student.name)) continue; // l'index est PARTIEL : pas de nom, pas de clé
    if (!byBusinessKey.has(key)) byBusinessKey.set(key, []);
    byBusinessKey.get(key).push(student.id);
  }
  const receipts = new Map();
  for (const payment of payments) {
    if (!payment.receipt_number) continue;
    if (!receipts.has(payment.receipt_number)) receipts.set(payment.receipt_number, []);
    receipts.get(payment.receipt_number).push(payment);
  }
  const creatorAt = new Map();
  queue.forEach((item, index) => {
    if (item.type !== 'addStudent') return;
    const id = createdRowIdOf(item);
    if (id) creatorAt.set(id, index);
  });

  const mapping = {};
  const entries = queue.map((item, index) => {
    const type = item.type;
    const base = {
      index: index + 1,
      id: item.id ?? null,
      type,
      createdAt: item.createdAt ?? null,
      attempts: item.attempts ?? 0,
      lastError: item.lastError ?? null,
    };
    const verdict = (value, detail, extra = {}) => ({ ...base, verdict: value, detail, ...extra });

    // ── Le geste qui CRÉE l'élève ────────────────────────────────────────────
    if (type === 'addStudent') {
      const localId = createdRowIdOf(item);
      const name = typeof item.payload.name === 'string' ? item.payload.name : '(sans nom)';
      if (localId && studentIds.has(localId)) {
        return verdict(VERDICT.DEJA_EN_BASE, `« ${name} » existe déjà en base avec le même identifiant — rien à créer.`, { studentRef: localId });
      }
      const matches = btrim(item.payload.name) ? (byBusinessKey.get(businessKeyOf(item.payload)) ?? []) : [];
      if (matches.length === 1) {
        mapping[localId ?? `#${index + 1}`] = matches[0];
        return verdict(
          VERDICT.DOUBLON_METIER,
          `« ${name} » existe déjà en base sous un AUTRE identifiant (${matches[0]}) : la création sera refusée, les gestes de cet élève doivent pointer vers cette fiche.`,
          { studentRef: localId, proposedStudentId: matches[0] },
        );
      }
      if (matches.length > 1) {
        return verdict(
          VERDICT.DOUBLON_METIER,
          `« ${name} » correspond à ${matches.length} fiches en base (${matches.join(', ')}) : choisir laquelle, aucune proposition automatique.`,
          { studentRef: localId },
        );
      }
      if (!localId) {
        return verdict(VERDICT.PRET_A_PARTIR, `« ${name} » sera créé, mais le geste ne porte aucun identifiant : la base en générera un, et les gestes qui visaient un id local ne le rejoindront pas.`);
      }
      return verdict(VERDICT.PRET_A_PARTIR, `« ${name} » sera créé avec l’identifiant ${localId}, celui que ses paiements attendent.`, { studentRef: localId });
    }

    // ── Un paiement : le reçu est-il déjà en base ? ──────────────────────────
    if (type === 'addPayment') {
      const payment = item.payload.payment ?? {};
      const localId = createdRowIdOf(item);
      if (localId && paymentIds.has(localId)) {
        return verdict(VERDICT.DEJA_EN_BASE, 'Ce paiement est déjà en base (même identifiant de geste) : le drainage le retirera sans rien compter deux fois.');
      }
      const sameNumber = payment.receiptNumber ? (receipts.get(payment.receiptNumber) ?? []) : [];
      if (sameNumber.length) {
        const same = sameNumber.find((row) => Number(row.amount) === Number(payment.amount)
          && dayOf(row.date) === dayOf(payment.date)
          && (!row.student_id || row.student_id === item.payload.studentId));
        if (same) {
          return verdict(VERDICT.DEJA_EN_BASE, `Le reçu n° ${payment.receiptNumber} (${payment.amount} F, ${dayOf(payment.date)}) est déjà en base : rien à récupérer, rien à perdre.`, { receiptNumber: payment.receiptNumber });
        }
        return verdict(
          VERDICT.RECU_DEJA_PRIS,
          `Le reçu n° ${payment.receiptNumber} est déjà porté par un AUTRE paiement (${sameNumber[0].amount} F, ${dayOf(sameNumber[0].date)}) : la base refusera ce geste à chaque passage.`,
          { receiptNumber: payment.receiptNumber },
        );
      }
    }

    // ── Corriger / supprimer un paiement qui n'existe pas ────────────────────
    if (type === 'deletePayment' || type === 'updatePaymentMonths') {
      const paymentId = item.payload.paymentId;
      if (paymentId && !paymentIds.has(paymentId)) {
        return verdict(
          VERDICT.CIBLE_ABSENTE,
          `Le paiement visé (${paymentId}) n’est pas en base : ce geste ne changera rien.`,
          { studentRef: studentRefOf(item) },
        );
      }
    }

    // ── Tout autre geste : que devient l'élève qu'il vise ? ─────────────────
    const studentRef = studentRefOf(item);
    if (!studentRef) return verdict(VERDICT.SANS_REFERENCE, 'Aucun élève en jeu.');

    if (studentIds.has(studentRef)) {
      return verdict(VERDICT.PRET_A_PARTIR, `L’élève visé existe (${studentRef}) : le prochain drainage passera.`, { studentRef });
    }
    if (creatorAt.has(studentRef)) {
      const creator = creatorAt.get(studentRef);
      const order = creator < index ? 'avant ce geste' : 'APRÈS ce geste (il faudra un second passage)';
      return verdict(
        VERDICT.CREE_PAR_LA_FILE,
        `L’élève visé n’existe pas encore, mais le geste n° ${creator + 1} de la file le crée avec CET identifiant (${order}).`,
        { studentRef },
      );
    }
    return verdict(
      VERDICT.ELEVE_A_RATTACHER,
      `L’élève visé (${studentRef}) n’existe pas, et aucun geste de la file ne le crée : ce geste doit être rattaché à une fiche réelle.`,
      { studentRef, ...identificationOf(item) },
    );
  });

  const byVerdict = {};
  for (const entry of entries) byVerdict[entry.verdict] = (byVerdict[entry.verdict] ?? 0) + 1;

  return {
    total: entries.length,
    entries,
    byVerdict,
    mapping,
    blocking: entries.filter((entry) => isBlocking(entry.verdict)),
    recoverable: entries.filter((entry) => entry.verdict === VERDICT.PRET_A_PARTIR
      || entry.verdict === VERDICT.CREE_PAR_LA_FILE
      || entry.verdict === VERDICT.DEJA_EN_BASE),
    toAttach: entries.filter((entry) => entry.verdict === VERDICT.ELEVE_A_RATTACHER),
  };
}

/**
 * Ce que le papier du reçu peut reconnaître : numéro, date, montant, élève.
 *
 * Sans ces quatre-là, « rattachez le geste à un élève » demanderait à l'école de
 * deviner ce qu'elle a encaissé — et c'est justement ce que la file ne dit pas
 * quand elle ne porte qu'un identifiant.
 */
function identificationOf(item) {
  const payload = item.payload ?? {};
  const payment = payload.payment ?? {};
  const info = {
    receiptNumber: payment.receiptNumber ?? payload.receiptNumber ?? null,
    date: dayOf(payment.date ?? payload.date),
    amount: payment.amount ?? payload.amount ?? null,
  };
  return Object.fromEntries(Object.entries(info).filter(([, value]) => value != null));
}

/**
 * Applique une correspondance DÉCIDÉE : chaque identifiant local devient l'id
 * d'une fiche réelle.
 *
 * Deux effets, et un seul retrait — nommé, jamais silencieux :
 *   • toute référence à un élève est réécrite (`addPayment.studentId`,
 *     `deletePayment.studentId`, `updatePaymentMonths.studentId`,
 *     `updateStudent.id`, `deleteStudent.id`, `todo.studentId`) ;
 *   • un `addStudent` dont l'identifiant est rattaché à une fiche existante est
 *     RETIRÉ de la file — l'élève existe déjà, le recréer serait un doublon
 *     refusé à chaque passage. Le retrait est rendu dans `removed` pour être dit.
 *
 * Le reste de la file est rendu dans le MÊME ordre, sans autre changement.
 */
export function rewriteQueue(items, mapping = {}) {
  const queue = normalizeQueue(items ?? []);
  const rewritten = [];
  const removed = [];
  const out = [];

  const targetOf = (id) => (typeof id === 'string' && typeof mapping[id] === 'string' && mapping[id] !== id ? mapping[id] : null);

  for (const item of queue) {
    if (item.type === 'addStudent') {
      const target = targetOf(createdRowIdOf(item));
      if (target) {
        removed.push({ id: item.id ?? null, type: item.type, studentId: createdRowIdOf(item), reason: `l’élève visé existe déjà (${target})` });
        continue;
      }
    }

    const payload = { ...item.payload };
    const rewriteField = (field, value) => {
      const target = targetOf(value);
      if (!target) return value;
      rewritten.push({ id: item.id ?? null, type: item.type, field, from: value, to: target });
      return target;
    };

    if ('studentId' in payload) payload.studentId = rewriteField('studentId', payload.studentId);
    if ((item.type === 'updateStudent' || item.type === 'deleteStudent') && 'id' in payload) {
      payload.id = rewriteField('id', payload.id);
    }
    out.push({ ...item, payload });
  }

  return { items: out, rewritten, removed };
}

/** Le rapport lisible en Markdown — ce que l'école garde et relit. */
export function reportToMarkdown(report, { dumpName = 'file hors-ligne', generatedAt = new Date().toISOString() } = {}) {
  const lines = [
    '# File hors-ligne — constat',
    '',
    `- Source : \`${dumpName}\``,
    `- Constat établi le ${generatedAt}`,
    `- Gestes en file : **${report.total}**`,
    '',
    '## Ce que la base fera de chaque geste',
    '',
    '| Verdict | Gestes | Signification |',
    '| --- | ---: | --- |',
  ];
  const meanings = {
    [VERDICT.PRET_A_PARTIR]: 'passera au prochain drainage',
    [VERDICT.CREE_PAR_LA_FILE]: 'passera : l’élève est créé par un autre geste de la file',
    [VERDICT.DEJA_EN_BASE]: 'déjà en base — sera retiré sans rien compter deux fois',
    [VERDICT.SANS_REFERENCE]: 'aucun élève en jeu',
    [VERDICT.ELEVE_A_RATTACHER]: 'BLOQUÉ — élève visé introuvable',
    [VERDICT.DOUBLON_METIER]: 'BLOQUÉ — la fiche existe sous un autre identifiant',
    [VERDICT.RECU_DEJA_PRIS]: 'BLOQUÉ — numéro de reçu déjà porté ailleurs',
    [VERDICT.CIBLE_ABSENTE]: 'BLOQUÉ — la ligne visée n’existe pas',
  };
  for (const [verdict, count] of Object.entries(report.byVerdict)) {
    lines.push(`| \`${verdict}\` | ${count} | ${meanings[verdict] ?? ''} |`);
  }

  if (report.toAttach.length) {
    lines.push('', '## À rattacher — reçus à reconnaître', '');
    for (const entry of report.toAttach) {
      const parts = [
        entry.receiptNumber ? `reçu n° ${entry.receiptNumber}` : 'reçu sans numéro',
        entry.amount != null ? `${entry.amount} F` : 'montant inconnu',
        entry.date ?? 'date inconnue',
        `cible ${entry.studentRef}`,
      ];
      lines.push(`- geste n° ${entry.index} — ${parts.join(' · ')}`);
    }
  }

  if (report.blocking.length) {
    lines.push('', '## Blocages à trancher', '');
    for (const entry of report.blocking) {
      lines.push(`- geste n° ${entry.index} (\`${entry.type}\`) — ${entry.detail}`);
    }
  }

  const propositions = Object.entries(report.mapping ?? {});
  if (propositions.length) {
    lines.push('', '## Correspondances proposées (vérifier avant d’appliquer)', '');
    for (const [from, to] of propositions) lines.push(`- \`${from}\` → \`${to}\``);
  }

  lines.push('', 'Aucun geste n’a été supprimé : ce constat ne lit que la file et la base.');
  return `${lines.join('\n')}\n`;
}
