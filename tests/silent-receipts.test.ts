// L'AGRÉGAT de l'écran École des reçus muets — la brique PURE (src/lib/silentReceipts.ts).
//
// Ce que ces cas tiennent, et pourquoi chacun peut casser en silence :
//
//   • **QUI** — un élève n'obtient une ligne que s'il porte un reçu muet DE L'ANNÉE
//     jugée. Un reçu d'une autre année scolaire, ou un reçu qui déclare déjà ses
//     mois, ne compte pas : le premier gonflerait le travail d'une année qu'on ne
//     regarde pas, le second proposerait de renseigner un reçu déjà renseigné ;
//   • **L'ORDRE** — du plus gros montant non documenté au plus petit, à égalité
//     par le nombre de reçus puis par le nom. C'est la demande : « triés par ce
//     qu'il reste à rattraper ». Un tri qui se contenterait de l'ordre du fichier
//     des élèves donnerait une liste qui change d'un poste à l'autre ;
//   • **LE MONTANT** — la somme des seuls reçus MUETS. Additionner tous les
//     paiements de l'élève afficherait une somme qui n'a rien à voir avec le
//     travail qui reste ;
//   • **LE PREMIER REÇU** — la liste d'une ligne est rangée du PLUS ANCIEN au plus
//     récent, donc `receipts[0]` est celui par lequel l'écran ouvre la fiche. Le
//     vérifier ici évite de le vérifier trois fois plus loin ;
//   • **L'ANNÉE ILLISIBLE** — pas de fenêtre, pas de jugement : liste VIDE. Une
//     liste remplie sur une année inventée ferait travailler l'école sur des mois
//     qui n'existent pas.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Payment, Student } from '../src/lib/domainTypes';
import {
  silentReceiptClasses,
  silentReceiptRows,
  silentReceiptTargets,
  silentReceiptsCatchUp,
  silentReceiptsPassSummary,
  silentReceiptsTotal,
  silentReceiptsWalk,
  silentReceiptsWalkSummary,
  walkTargetIsSilent,
} from '../src/lib/silentReceipts';
import type { SilentReceiptTarget } from '../src/lib/silentReceipts';
import { isSilentReceipt, monthsCoverage } from '../src/lib/paymentMonths';

/** Un reçu MUET : il ne déclare aucun mois. */
const silent = (id: string, date: string, amount: number): Payment => ({ id, date, amount });

/** Un reçu qui DÉCLARE ses mois : il n'a rien à faire dans un rattrapage. */
const declared = (id: string, date: string, amount: number, months: string[]): Payment =>
  ({ id, date, amount, months });

const student = (id: string, name: string, payments: Payment[], grade = '1A'): Student => ({
  id,
  name,
  grade,
  parentName: `Parent ${name}`,
  parentEmail: '',
  parentPhone: '',
  totalDue: 150000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  dueDate: '2027-06-30',
  notes: '',
  payments,
  academicYear: '2026-2027',
});

const YEAR = '2026-2027';

describe('silentReceipts — qui apparaît, et à quel rang', () => {
  it('ne garde que les élèves porteurs d’un reçu muet DE L’ANNÉE jugée', () => {
    const rows = silentReceiptRows([
      // Le plus gros montant non documenté, et son reçu le plus ANCIEN n'est pas
      // le premier de la liste : c'est le module qui doit le nommer.
      student('st-big', 'Awa Traoré', [silent('p-new', '2026-10-12', 30000), silent('p-old', '2026-09-15', 10000)]),
      student('st-small', 'Ali Diallo', [silent('p-small', '2026-09-20', 25000), declared('p-oct', '2026-10-05', 10000, ['2026-10'])]),
      // Déjà renseigné : rien à rattraper.
      student('st-ok', 'Fanta Keïta', [declared('p-ok', '2026-11-04', 60000, ['2026-09'])]),
      // Reçu muet d'une AUTRE année scolaire — le plus gros montant du jeu de
      // données, et il ne doit pas apparaître : c'est le piège du cas.
      student('st-past', 'Sékou Baré', [silent('p-past', '2025-10-01', 90000)]),
    ], YEAR);

    assert.deepEqual(rows.map((r) => r.student.id), ['st-big', 'st-small'],
      'les deux élèves à reçu muet de l’année, dans l’ordre du montant — ni le reçu déjà renseigné, ni celui d’une autre année');
    assert.deepEqual(rows[0]!.receipts.map((p) => p.id), ['p-old', 'p-new'],
      'les reçus d’une ligne sont rangés du plus ancien au plus récent');
    assert.equal(rows[0]!.amount, 40000, 'le montant additionne les DEUX reçus muets');
    assert.equal(rows[1]!.amount, 25000,
      'et seulement les muets : le reçu qui déclare ses mois n’entre pas dans la somme');
    assert.equal(rows[1]!.covered, 1, 'ce qui est déjà déclaré est compté comme couvert');
    assert.equal(rows[1]!.total, 12, 'l’année scolaire compte douze mois');
    assert.equal(silentReceiptsTotal(rows), 65000, 'le pied de liste additionne les lignes');
  });

  it('départage les égalités par le nombre de reçus, puis par le nom', () => {
    const rows = silentReceiptRows([
      // Même montant non documenté que la suivante : deux reçus valent deux gestes.
      student('st-two', 'Zoé Koné', [silent('a', '2026-09-02', 10000), silent('b', '2026-09-03', 10000)]),
      // Même montant ET même nombre de reçus : c'est le nom qui tranche.
      student('st-zed', 'Zoumana Bâ', [silent('c', '2026-09-04', 20000)]),
      student('st-ali', 'Ali Diallo', [silent('d', '2026-09-05', 20000)]),
    ], YEAR);

    assert.deepEqual(rows.map((r) => r.student.id), ['st-two', 'st-ali', 'st-zed'],
      'deux reçus passent devant un seul, puis les noms départagent — la liste ne dépend pas de l’ordre du tableau d’élèves');
  });

  it('un reçu sans mois du tout est muet — un reçu qui déclare les siens ne l’est pas', () => {
    // La règle est celle de `monthsCoverage().undeclared`, écrit par la même
    // fonction : « muet » n'est pas redécidé par l'écran École.
    assert.equal(isSilentReceipt(undefined), true, 'un reçu d’avant la colonne est muet');
    assert.equal(isSilentReceipt([]), true, 'un reçu envoyé sans cocher est muet');
    assert.equal(isSilentReceipt(['2026-09']), false, 'un reçu qui déclare un mois ne l’est plus');
    assert.equal(monthsCoverage([undefined, [], ['2026-09']], ['2026-09']).undeclared, 2,
      'le compte de la fiche et la liste de l’écran lisent le même critère');

    const rows = silentReceiptRows([student('st1', 'Ali Diallo', [silent('p1', '2026-09-10', 5000)])], YEAR);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.covered, 0, 'aucun mois déclaré : aucun mois couvert');
  });

  it('une année illisible ne juge rien : liste vide, pas une liste inventée', () => {
    const students = [student('st1', 'Ali Diallo', [silent('p1', '2026-09-10', 5000)])];
    for (const bad of ['', 'année inconnue', '2026']) {
      assert.deepEqual(silentReceiptRows(students, bad), [],
        `« ${bad} » ne donne pas de fenêtre, donc pas de jugement`);
    }
  });

  it('aucun reçu muet : aucune ligne, donc aucun total', () => {
    const rows = silentReceiptRows([
      student('st1', 'Ali Diallo', [declared('p1', '2026-09-10', 5000, ['2026-09'])]),
    ], YEAR);
    assert.deepEqual(rows, [], 'rien à rattraper : l’écran n’a rien à lister');
    assert.equal(silentReceiptsTotal(rows), 0);
  });
});

// ─── LE COMPTE DE L'ÉCOLE, ET DEPUIS QUAND (le chiffre du tableau de bord) ────
//
// Le tableau de bord ne liste pas : il publie un chiffre et une ancienneté. Ces
// cas tiennent les deux points où il pourrait mentir — compter autre chose que ce
// que l'écran École liste, et annoncer un âge qu'il n'a pas su lire.

describe('silentReceiptsCatchUp — le chiffre du tableau de bord', () => {
  it('compte les reçus de TOUTES les lignes, et nomme le plus ancien de l’école', () => {
    // Le plus ancien n'est pas dans la première ligne : st-1 mène au montant, mais
    // c'est le reçu de st-2 (10 septembre) qui attend depuis le plus longtemps.
    const rows = silentReceiptRows([
      student('st-1', 'Awa Traoré', [silent('p1', '2026-10-01', 30000), silent('p2', '2026-10-20', 5000)]),
      student('st-2', 'Ali Diallo', [silent('p3', '2026-09-10', 20000)]),
      // Un reçu déjà renseigné ne compte pas : ni en gestes, ni en ancienneté.
      student('st-3', 'Fanta Keïta', [declared('p4', '2026-09-01', 90000, ['2026-09'])]),
    ], YEAR);

    const catchUp = silentReceiptsCatchUp(rows, '2026-10-25');
    assert.equal(catchUp.receipts, 3, 'deux reçus muets pour st-1, un pour st-2');
    assert.equal(catchUp.students, 2, 'deux élèves concernés, jamais un total nu');
    assert.equal(catchUp.oldestDate, '2026-09-10', 'le plus ancien de l’école, pas celui de la première ligne');
    assert.equal(catchUp.oldestDays, 45, '20 jours jusqu’au 30 septembre, puis 25 : 45 jours d’attente');
  });

  it('un reçu daté dans le futur n’a pas d’ancienneté : l’âge est ramené à zéro', () => {
    const rows = silentReceiptRows([
      student('st-1', 'Awa Traoré', [silent('p1', '2026-11-05', 10000)]),
    ], YEAR);

    assert.equal(silentReceiptsCatchUp(rows, '2026-10-25').oldestDays, 0,
      'une saisie erronée ne fait pas publier « -11 jours »');
  });

  it('sans reçu muet : zéro partout, et aucune ancienneté inventée', () => {
    assert.deepEqual(silentReceiptsCatchUp([], '2026-10-25'),
      { receipts: 0, students: 0, oldestDate: null, oldestDays: null },
      'rien à rattraper : pas d’âge pour une date qui n’existe pas');
  });

  it('une année illisible ne publie rien — et une date de référence illisible, pas d’âge', () => {
    const students = [student('st-1', 'Awa Traoré', [silent('p1', '2026-09-10', 10000)])];
    const unreadable = silentReceiptsCatchUp(silentReceiptRows(students, 'année inconnue'), '2026-10-25');
    assert.deepEqual(unreadable, { receipts: 0, students: 0, oldestDate: null, oldestDays: null },
      'pas de fenêtre, pas de jugement : le tableau de bord n’annonce rien');

    const rows = silentReceiptRows(students, YEAR);
    const noClock = silentReceiptsCatchUp(rows, 'hier');
    assert.equal(noClock.oldestDate, '2026-09-10', 'la date du reçu, elle, reste lisible');
    assert.equal(noClock.oldestDays, null, 'mais un âge qu’on n’a pas su calculer ne se publie pas');
  });

  it('publie le MÊME compte que la somme de la liste de l’écran École', () => {
    const rows = silentReceiptRows([
      student('st-1', 'Awa Traoré', [silent('p1', '2026-09-02', 1000), silent('p2', '2026-10-02', 1000)]),
      student('st-2', 'Ali Diallo', [silent('p3', '2026-09-04', 6000)]),
    ], YEAR);
    const total = rows.reduce((sum, row) => sum + row.receipts.length, 0);
    assert.equal(silentReceiptsCatchUp(rows, '2026-10-25').receipts, total,
      'deux comptages séparés divergeraient : l’école lirait deux fois le même travail');
    assert.equal(silentReceiptsCatchUp(rows, '2026-10-25').students, rows.length);
  });
});

// ─── LA PASSE GROUPÉE : une classe, plusieurs élèves, un seul choix de mois ────

describe('silentReceipts — la passe groupée', () => {
  /** Trois élèves, deux classes, dont une fiche SANS classe (rendue « N/A »). */
  const ROWS = () => silentReceiptRows([
    student('st-10a', 'Dix A', [silent('p-10a', '2026-09-02', 1000)], '10A'),
    student('st-2a', 'Deux A', [silent('p-2a', '2026-09-03', 5000)], '2A'),
    student('st-2b', 'Deux B', [silent('p-2b-old', '2026-09-04', 3000), silent('p-2b-new', '2026-10-04', 3000)], '2A'),
    student('st-none', 'Sans classe', [silent('p-none', '2026-09-05', 2000)], ''),
  ], YEAR);

  it('groupe par classe, dans l’ordre NATUREL — et la fiche sans classe reste un groupe', () => {
    const classes = silentReceiptClasses(ROWS());
    assert.deepEqual(classes.map((c) => c.grade), ['', '2A', '10A'],
      '« 2A » avant « 10A » (l’ordre du dictionnaire les inverserait), et la classe absente n’est pas perdue');
    assert.deepEqual(classes.find((c) => c.grade === '2A')!.students.map((r) => r.student.id),
      ['st-2b', 'st-2a'], 'les élèves gardent l’ordre de la liste — montant décroissant (st-2b en a deux)');
  });

  it('ne retient, par élève coché, que son reçu muet LE PLUS ANCIEN', () => {
    const rows = ROWS();
    const classe = silentReceiptClasses(rows).find((c) => c.grade === '2A')!;
    const targets = silentReceiptTargets(classe.students, ['st-2b', 'st-2a']);

    assert.deepEqual(targets.map((t) => t.studentId), ['st-2b', 'st-2a'],
      'l’ordre est celui de la LISTE, jamais celui des clics : le compte rendu doit se relire comme l’écran');
    assert.deepEqual(targets.map((t) => t.payment.id), ['p-2b-old', 'p-2a'],
      'pour l’élève à deux reçus muets, c’est le PLUS ANCIEN qui part — le suivant reste à faire');
    assert.deepEqual(targets.map((t) => t.studentName), ['Deux B', 'Deux A'],
      'le nom voyage avec le plan : le compte rendu doit pouvoir nommer même après un rechargement de la liste');
  });

  it('ignore un élève qui n’est plus dans les lignes, et n’écrit rien sans reçu', () => {
    const rows = ROWS();
    assert.deepEqual(silentReceiptTargets(rows, ['st-inexistant']), [],
      'un identifiant périmé ne fabrique pas une cible');
    assert.deepEqual(silentReceiptTargets([], ['st-2a']), [],
      'plus de lignes (tous les reçus écrits) : plus rien à écrire');
  });

  it('le compte rendu sépare ce qui a été écrit de ce qui a été refusé', () => {
    assert.deepEqual(silentReceiptsPassSummary([{ ok: true }, { ok: true }, { ok: false }]),
      { written: 2, refused: 1, total: 3 }, 'un refus ne se fond pas dans le total');
    assert.deepEqual(silentReceiptsPassSummary([]), { written: 0, refused: 0, total: 0 },
      'rien tenté : rien publié');
  });
});

// ─── LE PARCOURS ÉLÈVE PAR ÉLÈVE : l'ordre du plan, et le verdict d'une étape ──
//
// Ce que ces cas tiennent, et pourquoi chacun peut casser en silence :
//
//   • **L'ORDRE** — les élèves suivent celui de la LISTE (montant non documenté
//     décroissant) et, chez un même élève, ses reçus muets suivent le calendrier.
//     Un parcours qui remettrait les reçus dans l'ordre de la fiche ou de la
//     mémoire ferait écrire l'école dans un ordre qu'elle n'a pas lu ;
//   • **LA VIVACITÉ** — le plan est pris au départ, la liste vit : un reçu
//     renseigné entre-temps a quitté les muets, donc il est ÉCARTÉ et jamais
//     écrasé. Un reçu sans identifiant est du même côté : on ne le touche pas ;
//   • **LES TROIS VERDICTS** — écrit, refusé, laissé de côté — sont DISJOINTS. Un
//     total unique ferait passer un refus pour une réussite, et un reçu laissé de
//     côté pour un geste.

describe('silentReceiptsWalk — le parcours élève par élève', () => {
  const ROWS = () => silentReceiptRows([
    student('st-big', 'Awa Traoré', [
      silent('p-big-new', '2026-10-12', 30000),
      silent('p-big-old', '2026-09-15', 10000),
    ]),
    student('st-small', 'Ali Diallo', [silent('p-small', '2026-09-20', 25000)]),
    student('st-ok', 'Fanta Keïta', [declared('p-ok', '2026-11-04', 60000, ['2026-09'])]),
  ], YEAR);

  it('déroule les ÉLÈVES dans l’ordre de la liste, et leurs reçus du plus ancien au plus récent', () => {
    const steps = silentReceiptsWalk(ROWS());

    assert.deepEqual(steps.map((s) => s.studentId), ['st-big', 'st-big', 'st-small'],
      'le plus gros montant d’abord — et l’élève à deux reçus muets en donne DEUX, l’un après l’autre');
    assert.deepEqual(steps.map((s) => s.payment.id), ['p-big-old', 'p-big-new', 'p-small'],
      'pour un même élève, le plus ANCIEN passe d’abord : c’est l’ordre du calendrier, pas celui des clics');
    assert.deepEqual(steps.map((s) => s.studentName), ['Awa Traoré', 'Awa Traoré', 'Ali Diallo'],
      'le nom voyage avec le plan : le compte rendu nomme encore si la liste a changé');
    assert.deepEqual(silentReceiptsWalk([]), [], 'rien à rattraper : aucun pas');
  });

  it('ne retient que des reçus ENCORE muets dans la liste vivante', () => {
    const rows = ROWS();
    const steps = silentReceiptsWalk(rows);
    assert.equal(walkTargetIsSilent(rows, steps[0]!), true,
      'le reçu est encore dans la ligne de son élève : il attend toujours');

    // Un collègue l’a renseigné pendant que le parcours était ouvert : la ligne ne
    // le porte plus, donc il a quitté les muets.
    const filled = silentReceiptRows([
      student('st-big', 'Awa Traoré', [
        silent('p-big-new', '2026-10-12', 30000),
        declared('p-big-old', '2026-09-15', 10000, ['2026-09']),
      ]),
      student('st-small', 'Ali Diallo', [silent('p-small', '2026-09-20', 25000)]),
    ], YEAR);
    assert.equal(walkTargetIsSilent(filled, steps[0]!), false,
      'le reçu a quitté la liste des muets : le parcours ne l’écrase pas');
    assert.equal(walkTargetIsSilent(filled, steps[1]!), true,
      'l’autre reçu du MÊME élève, lui, attend encore');
    assert.equal(walkTargetIsSilent(ROWS(), steps[2]!), true);
    assert.equal(walkTargetIsSilent([], steps[2]!), false, 'plus aucune ligne : plus rien à écrire');
  });

  it('un reçu SANS identifiant ne s’écrit pas — on ne peut pas le reconnaître', () => {
    const orphan: SilentReceiptTarget = {
      studentId: 'st-big',
      studentName: 'Awa Traoré',
      payment: { date: '2026-09-15', amount: 10000 },
    };
    assert.equal(walkTargetIsSilent(ROWS(), orphan), false,
      'sans id, ni la liste vivante ni `set_payment_months` ne peuvent le nommer — donc on le laisse');
  });

  it('le compte rendu sépare les TROIS verdicts, et ils sont disjoints', () => {
    assert.deepEqual(silentReceiptsWalkSummary([
      { ok: true, skipped: null },
      { ok: true, skipped: null },
      { ok: false, skipped: null },
      { ok: false, skipped: 'stale' },
      { ok: false, skipped: 'passed' },
    ]), { written: 2, refused: 1, skipped: 2, total: 5 },
      'un reçu laissé de côté n’est ni un écrit ni un refus : un total unique ferait passer un refus pour une réussite');
    assert.deepEqual(silentReceiptsWalkSummary([]), { written: 0, refused: 0, skipped: 0, total: 0 },
      'rien tenté : rien publié');
  });
});
