// ─────────────────────────────────────────────────────────────────────────────
// Le RATTRAPAGE D'UN REÇU MUET — verrouillé sur la source du pixel-check E2E
// (mode `recu-muet`, scripts/verify-pdf-download.mjs) et sur son étape dans
// `.github/workflows/pdf-e2e.yml`.
//
// La demande qui a produit ce mode tient en une phrase : « ouvrir la fiche d'un
// élève, renseigner les mois d'un reçu muet, enregistrer, et vérifier APRÈS
// RECHARGEMENT que les mois sont déclarés ». Les trois moitiés de cette phrase
// sont exactement ce qu'on perd en silence :
//
//   • le RECHARGEMENT — un contrôle qui juge la fiche encore ouverte mesure la
//     mémoire de l'écran, pas ce que la base garde. Le mode `recu-mois` avait
//     déjà payé cette leçon avec sa RÉIMPRESSION (un reçu du moment peut porter
//     les mois sans qu'ils aient jamais été écrits) ; ici, c'est la fiche
//     elle-même qui est relue après un rechargement ;
//   • l'ÉTAT D'AVANT — sans lui, un reçu qui déclarerait déjà ses mois passerait
//     le mode pour un simple affichage : le contrôle se féliciterait d'avoir
//     complété ce qui était complet ;
//   • la LECTURE PAR CLÉ — un sélecteur qui viserait « Septembre » ou
//     « Enregistrer » casserait à la première traduction, et un contrôle qui ne
//     clique plus dans le vide accuse l'application d'une régression qu'elle
//     n'a pas.
//
// Le jugement est PUR et vit ici : la source est lue BLANCHIE de ses commentaires
// (`maskComments`), parce que ce fichier-ci cite tous ces marqueurs dans sa
// prose — un contrôle qui lirait la prose comme du code se contenterait de se
// lire lui-même. Et chaque règle est éprouvée par MUTATION sur une copie abîmée
// du fichier réel : une règle qu'aucune mutation ne fait rougir ne regarde rien.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from '../scripts/lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'scripts/verify-pdf-download.mjs';
const WORKFLOW = '.github/workflows/pdf-e2e.yml';

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
/** La source d'un fichier, commentaires blanchis (longueur et lignes gardées). */
const code = (rel: string) => maskComments(read(rel));

type Body = { found: boolean; body: string };

/**
 * Le corps d'une fonction de premier niveau, terminé par son accolade en
 * colonne 0. Une signature ABSENTE n'est pas une exception : c'est un constat,
 * que la règle qui la cherchait doit dire (une fonction supprimée ne doit pas
 * faire passer un contrôle en le faisant jeter).
 */
function bodyOf(source: string, signature: string): Body {
  const start = source.indexOf(signature);
  if (start < 0) return { found: false, body: '' };
  const rest = source.slice(start);
  const end = rest.indexOf('\n}');
  return { found: true, body: end >= 0 ? rest.slice(0, end) : rest };
}

/** Le premier index d'un motif, ou -1 — pour comparer des ORDRES dans un corps. */
const at = (body: string, needle: string) => body.indexOf(needle);

/** Les noms des vérifications d'un juge (`check('…'`), littéraux de la source. */
const checkNames = (body: string) =>
  [...body.matchAll(/check\(\s*[`']([^`']+)/g)].map((m) => m[1]);

/**
 * Les règles du mode `recu-muet`, appliquées à une source quelconque.
 * Rendues en clair : chaque message nomme ce qui manque, pas seulement « raté ».
 */
function judgeMuteFlow(source: string): string[] {
  const problems: string[] = [];
  const flow = bodyOf(source, 'async function runMuteFillFlow(page, target) {');
  const fill = bodyOf(source, 'async function fillMuteMonthsFromFile(page) {');
  const prove = bodyOf(source, 'async function proveMuteFilled(page, target, filled) {');
  const judge = bodyOf(source, 'async function checkMuteFilledPaper(pdf) {');

  if (!flow.found) problems.push('le flux du mode (`runMuteFillFlow`) doit exister');
  if (!fill.found) problems.push('le geste par la fiche (`fillMuteMonthsFromFile`) doit exister');
  if (!prove.found) problems.push('la moitié retour (`proveMuteFilled`) doit exister');
  if (!judge.found) problems.push('le jugement (`checkMuteFilledPaper`) doit exister');
  if (problems.length) return problems;

  // 1. L'état d'AVANT est capturé, et capturé avant le geste.
  const stripBefore = at(flow.body, 'readMonthsStrip(page)');
  const offeredBefore = at(flow.body, 'payment-months-fill');
  const gesture = at(flow.body, 'fillMuteMonthsFromFile(page)');
  if (stripBefore < 0) {
    problems.push('le flux doit LIRE la fiche avant le geste (état « avant »), sinon un reçu déjà complet passerait pour un rattrapage');
  } else if (gesture < 0 || stripBefore > gesture) {
    problems.push('la lecture « avant » doit précéder le geste : la fiche ne se juge pas après avoir écrit');
  }
  if (offeredBefore < 0 || (gesture >= 0 && offeredBefore > gesture)) {
    problems.push('le flux doit constater, AVANT le geste, que la fiche OFFRAIT de renseigner ce reçu');
  }

  // 2. Le RECHARGEMENT, et son ordre : recharger, puis relire la fiche.
  const reload = at(prove.body, 'page.reload(');
  const stripAfter = at(prove.body, 'readMonthsStrip(page)');
  if (reload < 0) {
    problems.push('la moitié retour doit RECHARGER la page : sans rechargement, la fiche jugée ne prouve que la mémoire de l’écran');
  } else if (stripAfter < 0 || reload > stripAfter) {
    problems.push('la fiche doit être relue APRÈS le rechargement (recharger d’abord, juger ensuite)');
  }

  // 3. Le papier vient après la fiche, et vient du chemin réel.
  const reprint = at(prove.body, 'downloadReceiptFromPreview(');
  if (reprint < 0 || stripAfter < 0 || stripAfter > reprint) {
    problems.push('la réimpression doit partir de la fiche relue (la fiche d’abord, le papier ensuite)');
  }
  if (at(prove.body, 'captureDownloadedPdf(') < 0) {
    problems.push('la réimpression doit être CAPTURÉE (les octets du reçu réimprimé, pas ceux d’un fichier d’avant)');
  }

  // 4. Les mois se cochent par leur CLÉ, jamais par leur libellé. Le motif
  //    attendu est celui de l'INTERPOLATION (`${m}`) : un sélecteur qui
  //    n'attacherait pas le mois cliqué pourrait désigner n'importe quelle
  //    pastille, et cochant au hasard il ferait passer le mode pour vert.
  if (at(fill.body, 'button[data-month="${m}"]') < 0) {
    problems.push('les mois doivent être cochés par leur CLÉ (`data-month`), jamais par un libellé traduit');
  }

  // 5. Le geste est jugé sur ce que l'écran PROMET, et l'écran n'écrit rien tant
  //    qu'aucun mois n'est coché.
  for (const marker of ['payment-months-editor', 'payment-months-line', 'payment-months-save']) {
    if (at(fill.body, marker) < 0) problems.push(`le geste doit lire le marqueur \`${marker}\``);
  }

  // 6. Le jugement regarde les faits qui font la demande. Deux d'entre eux sont
  //    LUS pendant le geste (la note des reçus muets par la brique partagée, le
  //    bouton offert) et JUGÉS ensuite : c'est l'ensemble des moitiés qui doit
  //    les porter, et la note est lue par son MARQUEUR, jamais par ses mots.
  const strip = bodyOf(source, 'async function readMonthsStrip(page) {');
  const runner = `${flow.body}\n${prove.body}\n${strip.body}`;
  for (const [needle, why] of [
    ['[data-slot="student-months-undeclared"]', 'la note des reçus « sans mois déclaré » (elle doit DISPARAÎTRE)'],
    ['payment-months-fill', 'le bouton qui n’est plus offert'],
  ] as [string, string][]) {
    if (at(runner, needle) < 0) problems.push(`le contrôle doit lire ${why}`);
  }
  for (const [needle, why] of [
    ['MONTHS_TICKED', 'les mois attendus, écrits en clair et non recalculés'],
    ['monthsOnPaper(', 'le PAPIER du reçu réimprimé'],
    ['amountPaid', 'le solde de l’élève (des mois ne sont pas de l’argent)'],
  ] as [string, string][]) {
    if (at(judge.body, needle) < 0) problems.push(`le jugement doit vérifier ${why}`);
  }
  const names = checkNames(judge.body);
  const afterReload = names.filter((n) => n.startsWith('APRÈS RECHARGEMENT')).length;
  if (afterReload < 4) {
    problems.push(`le jugement doit nommer ses vérifications d’après-rechargement (${afterReload} trouvée(s), 4 au moins)`);
  }

  // 7. Le PARCOURS DE RATTRAPAGE : la LISTE des reçus muets et son
  //    enchaînement. Il est lu par son marqueur, aux DEUX bouts : AVANT le geste
  //    (la fiche listait ce qu'il restait à rattraper) et APRÈS le rechargement
  //    (il n'y a plus rien à rattraper, donc plus de liste). Un mode qui ne
  //    lirait que la phrase ambre prouverait que la fiche a cessé de COMPTER le
  //    reçu muet, pas que l'écran a cessé de l'OFFRIR.
  const panel = bodyOf(source, 'async function readBackfillPanel(page) {');
  if (!panel.found) {
    problems.push('la lecture du parcours de rattrapage (`readBackfillPanel`) doit exister : c’est elle qui dit ce qui RESTE à renseigner');
  } else {
    // Les attributs COMPLETS, guillemet fermant compris : `payment-months-backfill`
    // est le PRÉFIXE de `payment-months-backfill-progress`, donc un motif nu
    // resterait satisfait par la ligne de progression — et la mutation qui
    // renommerait la racine ne prouverait rien.
    for (const marker of ['data-slot="payment-months-backfill"', 'data-slot="payment-months-backfill-progress"']) {
      if (at(panel.body, marker) < 0) {
        problems.push(`la lecture du parcours doit passer par le marqueur \`${marker}\`, jamais par un libellé traduit`);
      }
    }
  }
  const panelBefore = at(flow.body, 'readBackfillPanel(page)');
  if (panelBefore < 0 || (gesture >= 0 && panelBefore > gesture)) {
    problems.push('le flux doit lire le parcours de rattrapage AVANT le geste : c’est ce qui prouve que la fiche le LISTAIT');
  }
  const panelAfter = reload < 0 ? -1 : at(prove.body.slice(reload), 'readBackfillPanel(page)');
  if (panelAfter < 0) {
    problems.push('la moitié retour doit relire le parcours APRÈS le rechargement : plus rien à rattraper, donc plus de liste à offrir');
  }

  // 8. La REPRISE DE TRANSPORT — et c'est un rouge MESURÉ, pas une précaution.
  //    Le 2026-10-15 (runs `f0f9f07` et `9b0d030`), le geste a été perdu par le
  //    réseau (`TypeError: Failed to fetch` sur la RPC des mois) et le mode a
  //    conclu que l'APPLICATION ne déclarait rien, alors que la base répondait à
  //    toutes ses lectures : un rouge de transport pris pour un jugement sur
  //    l'application, la faute que ce dépôt a déjà payée le 2026-09-23.
  //
  //    La reprise doit exister, rejouer le GESTE (pas seulement le constater),
  //    repartir d'une page RECHARGÉE (après un envoi refusé l'éditeur peut porter
  //    les mois cochés EN MÉMOIRE), se NOMMER dans le récapitulatif des
  //    transients, et précéder TOUT verdict — sinon un échec rendu avant elle
  //    accuserait l'application d'une requête perdue.
  const replay = bodyOf(source, 'async function replayMuteGesture(page, target) {');
  if (!replay.found) {
    problems.push('la reprise de transport (`replayMuteGesture`) doit exister : une requête perdue n’est pas un verdict sur l’application');
  } else {
    if (at(replay.body, 'page.reload(') < 0) {
      problems.push('la reprise doit RECHARGER la page : après un envoi refusé, l’éditeur peut porter les mois cochés en mémoire, et le geste doit repartir de ce que la base dit');
    }
    if (at(replay.body, 'fillMuteMonthsFromFile(page)') < 0) {
      problems.push('la reprise doit rejouer le GESTE (`fillMuteMonthsFromFile`), pas seulement le constater');
    }
  }
  const retried = at(prove.body, 'replayMuteGesture(page, target)');
  const verdict = at(prove.body, 'throw new Error(');
  if (retried < 0) {
    problems.push('la moitié retour doit REPRENDRE le geste quand les mois ne sont pas en base (transport perdu)');
  } else if (verdict >= 0 && retried > verdict) {
    problems.push('la reprise doit précéder le verdict : un échec rendu AVANT elle accuserait l’application d’une requête perdue');
  }
  if (at(prove.body, 'noteTransient(') < 0) {
    problems.push('la reprise doit se NOMMER (`noteTransient`) : une reprise silencieuse se lirait comme un run sans histoire');
  }
  if (retried < 0 || at(prove.body.slice(retried), 'await readStoredMonths(target)') < 0) {
    problems.push('la reprise doit RELIRE les mois en base après le second geste : sans cette lecture, le second geste n’est pas jugé');
  }

  return problems;
}

/** Le reçu inséré pour ce mode doit être VRAIMENT muet : aucune clé `months`. */
function muteReceiptProblems(source: string): string[] {
  const start = source.indexOf("if (MODE === 'recu-muet') {");
  if (start < 0) return ['le mode recu-muet doit créer sa propre cible (élève + reçu muet)'];
  const branch = source.slice(start, source.indexOf("if (MODE === 'recu-parent') {", start));
  const problems: string[] = [];
  if (!/receipt_number:\s*`REC-MUET-/.test(branch)) {
    problems.push('le reçu de ce mode doit porter son propre numéro (REC-MUET-…), pour être relu sans confondre les cibles');
  }
  if (/\bmonths\s*:/.test(branch)) {
    problems.push('le reçu doit être inséré SANS la clé `months` — un tableau vide serait déjà une déclaration, et la fiche n’aurait rien à proposer');
  }
  if (!/student_id:\s*demoStudentId/.test(branch)) {
    problems.push('le reçu doit appartenir à l’élève de démo (supprimé au nettoyage, avec son paiement)');
  }
  return problems;
}

describe('mode recu-muet — la source du pixel-check', () => {
  it('le mode est déclaré comme un flux de reçu, et routé vers la fiche', () => {
    const src = code(SCRIPT);
    assert.match(src, /const RECEIPT_MODES = \[[^\]]*'recu-muet'/, 'le reçu des parents est le même papier');
    assert.match(src, /MODE === 'recu-muet'/, 'et le mode doit résoudre sa propre cible');
    assert.match(src, /mode: 'recu-muet'/, 'la cible doit se nommer, sinon la branche de jugement est inatteignable');
    assert.match(src, /mode === 'recu-muet'\) await checkMuteFilledPaper\(pdf\)/, 'et son jugement doit être celui du rattrapage');
  });

  it('le reçu de démo est VRAIMENT muet, et d’une date antérieure à la colonne', () => {
    const problems = muteReceiptProblems(code(SCRIPT));
    assert.deepEqual(problems, [], problems.join('\n'));
    // La date du reçu est celle du geste du guichet (2026-10-04) : antérieure à
    // la migration qui a créé la colonne, donc ce reçu est muet DE PLEIN DROIT.
    assert.match(code(SCRIPT), /const MUTE_RECEIPT_DATE = MONTHS_DATE;/, 'la date vient du littéral qui porte déjà ce sens');
  });

  it('le flux réel respecte toutes les règles', () => {
    const problems = judgeMuteFlow(code(SCRIPT));
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  it('PREUVE PAR MUTATION : chaque règle rougit sur une copie abîmée', () => {
    const real = code(SCRIPT);
    const start = real.indexOf('async function proveMuteFilled(page, target, filled) {');
    assert.ok(start > 0, 'la moitié retour doit exister');
    const head = real.slice(0, start);
    const tail = real.slice(start);
    const REISSUE_NOTICE = "await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });";
    const noReload = head + tail.replace(REISSUE_NOTICE, '');
    // `!==` plutôt que `deepEqual` : une source de 85 000 caractères recopiée
    // dans un message d'échec rend le diagnostic illisible.
    assert.ok(noReload !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noReload).some((p) => /RECHARGER/.test(p)),
      'retirer le rechargement doit rougir : sans lui, la fiche jugée ne prouve rien',
    );

    // Les mois cochés par un libellé plutôt que par leur clé.
    // Le motif COMPLET, guillemets inverses compris : la même forme de sélecteur
    // existe pour le formulaire du guichet, et viser la mauvaise laisserait
    // l'éditeur de la fiche intact — la mutation ne prouverait rien.
    const byLabel = real.replace('`[data-slot="payment-months-editor"] button[data-month="${m}"]`', '`[data-slot="payment-months-editor"] button`');
    assert.ok(byLabel !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(byLabel).some((p) => /CLÉ/.test(p)),
      `un sélecteur de libellé doit rougir : il casserait à la première traduction — ${judgeMuteFlow(byLabel).join(' | ')}`,
    );

    // L'état « avant » retiré du flux : le mode ne saurait plus ce qu'il rattrape.
    // Sans le `\n` final : la source de ce dépôt est en CRLF, et un motif qui
    // l'ignorerait ne s'appliquerait nulle part (le contrôle dirait alors
    // seulement que la mutation n'a pas eu lieu — ce qui est juste, mais ne
    // prouve pas la règle).
    const noBefore = real.replace('const before = await readMonthsStrip(page);', '');
    assert.ok(noBefore !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noBefore).some((p) => /état « avant »/.test(p)),
      'sans lecture « avant », un reçu déjà complet passerait pour un rattrapage',
    );

    // La note des reçus muets n'est plus relue : le mode ne dirait pas qu'elle a
    // disparu — donc il ne prouverait pas que la fiche a cessé de le compter muet.
    // Le marqueur est visé NU : il vit dans un sélecteur (`[data-slot="…"]`),
    // donc l'entourer de guillemets ne toucherait rien et la mutation ne
    // prouverait qu'elle-même.
    const noNote = real.replaceAll('student-months-undeclared', 'autre-marqueur');
    assert.ok(noNote !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noNote).some((p) => /sans mois déclaré/.test(p)),
      `ne plus relire la note doit rougir — ${judgeMuteFlow(noNote).join(' | ')}`,
    );

    // Un reçu qui déclarerait ses mois « pour de faux » (tableau vide) n'est plus
    // muet par construction : la mutation doit rougir sur la clé interdite.
    const declaresEmpty = real.replace('receipt_number: `REC-MUET-${TS}`,', 'receipt_number: `REC-MUET-${TS}`,\n      months: [],');
    assert.ok(declaresEmpty !== real, 'la mutation doit s’appliquer');
    assert.ok(
      muteReceiptProblems(declaresEmpty).some((p) => /SANS la clé/.test(p)),
      'écrire `months: []` doit rougir : la fiche n’aurait plus rien à proposer',
    );

    // Le parcours lu AVANT le geste : sans cette lecture, le mode ne saurait pas
    // ce que l'écran offrait de rattraper.
    const noPanelBefore = real.replace('const backfillBefore = await readBackfillPanel(page);', 'const backfillBefore = null;');
    assert.ok(noPanelBefore !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noPanelBefore).some((p) => /AVANT le geste/.test(p)),
      `ne plus lire le parcours avant le geste doit rougir — ${judgeMuteFlow(noPanelBefore).join(' | ')}`,
    );

    // Le parcours relu APRÈS le rechargement : sa DISPARITION est la moitié
    // écran de « plus rien à rattraper ». La mutation le remplace par un
    // littéral, donc l'appel disparaît sans que la variable manque.
    const noPanelAfter = real.replace('const backfillAfter = await readBackfillPanel(page);', 'const backfillAfter = null;');
    assert.ok(noPanelAfter !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noPanelAfter).some((p) => /APRÈS le rechargement/.test(p)),
      `ne plus relire le parcours après le rechargement doit rougir — ${judgeMuteFlow(noPanelAfter).join(' | ')}`,
    );

    // La REPRISE de transport retirée : le mode accuserait de nouveau
    // l'application d'une requête que le réseau a perdue.
    const noRetry = real.replace('gesture = await replayMuteGesture(page, target);', 'gesture = filled;');
    assert.ok(noRetry !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(noRetry).some((p) => /REPRENDRE le geste/.test(p)),
      `retirer la reprise doit rougir — ${judgeMuteFlow(noRetry).join(' | ')}`,
    );

    // La lecture par LIBELLÉ : le marqueur de la racine remplacé par un sélecteur
    // qui n'en dit plus rien. Le motif visé est celui de la racine (guillemet
    // fermant compris), donc la ligne de progression reste intacte et la
    // mutation ne prouve que la règle qu'elle vise.
    const byLabelPanel = real.replace('data-slot="payment-months-backfill"', 'un-parcours');
    assert.ok(byLabelPanel !== real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeMuteFlow(byLabelPanel).some((p) => /marqueur/.test(p)),
      `un sélecteur de libellé doit rougir — ${judgeMuteFlow(byLabelPanel).join(' | ')}`,
    );
  });
});

describe('mode recu-muet — ce que le geste juge à l’écran', () => {
  const editor = code('src/components/PaymentMonthsEditor.tsx');
  const modal = code('src/components/StudentDetailsModal.tsx');
  // Le CARNET des paiements, extrait de la fiche pour tenir le budget de 700
  // lignes par fichier : c'est lui qui porte le geste direct sur une ligne.
  const ledger = code('src/components/PaymentLedger.tsx');

  it('l’éditeur porte les marqueurs que le pixel-check lit', () => {
    assert.match(editor, /data-slot="payment-months-editor"/, 'la racine de l’éditeur');
    assert.match(editor, /data-month=\{month\}/, 'chaque pastille par sa CLÉ, comme le formulaire du guichet');
    assert.match(editor, /data-slot="payment-months-line"/, 'la ligne EXACTE que le reçu imprimera');
    assert.match(editor, /data-slot="payment-months-save"/, 'le bouton d’enregistrement, celui qui reste fermé sans mois coché');
  });

  it('la fiche porte le parcours de rattrapage, monté et gardé par le même droit', () => {
    const backfill = code('src/components/PaymentMonthsBackfill.tsx');
    // La racine et la progression, par leur marqueur : c'est ce que le mode lit.
    assert.match(backfill, /data-slot="payment-months-backfill"/, 'la racine du parcours');
    assert.match(backfill, /data-slot="payment-months-backfill-progress"/, 'la ligne de progression');
    assert.match(backfill, /data-slot="payment-months-backfill-fill"/, 'l’action d’une ligne');
    assert.match(backfill, /data-receipt=\{p\.id \?\? ''\}/, 'chaque ligne nomme le reçu qu’elle porte (lue par le mode)');
    // Il ouvre le MÊME éditeur que le carnet : aucune seconde UI de mois.
    assert.match(backfill, /<PaymentMonthsEditor/, 'le parcours réutilise l’éditeur, il n’en invente pas un second');
    // Et la fiche le monte SOUS le même droit que le geste direct : sans droit
    // d'écriture, il n'y a pas de parcours à offrir (la phrase, elle, reste).
    assert.match(modal, /canEditPaymentMonths && yearMonths\.length > 0 && silentPayments\.length > 0/,
      'le parcours est monté sous le droit d’écriture et seulement s’il reste des muets');
    assert.match(modal, /editorHost === 'backfill' \? editingMonthsPaymentId : null/,
      'et il n’héberge l’éditeur que quand c’est lui qui l’a ouvert');
  });

  it('le carnet offre le geste sur un reçu muet, et le marqueur de la note existe', () => {
    assert.match(ledger, /data-slot="payment-months-fill"/, 'le bouton « Renseigner les mois »');
    assert.match(modal, /data-slot="student-months-undeclared"/, 'la note qui compte les reçus sans mois déclaré');
    // Le geste n'est offert QUE sur un reçu sans mois : le marqueur posé plus
    // haut ne suffirait pas si la garde qui le conditionne disparaissait.
    assert.match(
      ledger,
      /!p\.months \|\| p\.months\.length === 0/,
      'le bouton doit rester fermé sur un reçu qui déclare ses mois',
    );
  });
});

describe('mode recu-muet — l’étape de CI', () => {
  const workflow = read(WORKFLOW);

  it('le job exécute le mode sur SA pile, sous mandat de preuve', () => {
    const step = workflow.indexOf('--mode recu-muet');
    assert.ok(step >= 0, 'l’étape du reçu muet doit exister');
    const block = workflow.slice(Math.max(0, workflow.lastIndexOf('- name:', step)), step + 200);
    assert.match(block, /127\.0\.0\.1:4173/, 'et viser la pile de recette servie par le job, jamais la production');
    assert.match(block, /AUTOMATION_EVIDENCE: '1'/, 'le mandat est posé par l’étape qui l’exécute : sans lui, la mesure ne part pas');
    assert.match(block, /CHROME_PATH/, 'un runner Linux n’a pas le Chrome de ce poste');
  });

  it('l’étape vient après les trois autres, et avant la garde anti-résidus', () => {
    const mute = workflow.indexOf('--mode recu-muet');
    assert.ok(workflow.indexOf('--mode recu-mois') < mute, 'le mode recu-muet vient après le geste du guichet');
    assert.ok(
      workflow.indexOf('verify-ephemeral-cleanup.mjs') > mute,
      'la garde anti-résidus doit rester la DERNIÈRE : elle vérifie que ce mode a nettoyé derrière lui',
    );
  });
});
