// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/signing-transition.mjs — QUE FAIT UN CHANGEMENT DE SIGNATURE AU
// PARC QUI TOURNE DÉJÀ ?
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// `updaterTrustVerdict` (updater-trust.mjs) répond à une question sur UN
// artefact : « ces octets promettent-ils une signature, et la tiennent-ils ? ».
// Il ne peut pas répondre à la question de la BASCULE, et c'est une autre
// question : **quand on se met à signer (ou qu'on cesse), les postes qui
// tournent déjà acceptent-ils la version suivante ?**
//
// Le fait mesuré qui rend la question nécessaire (2026-09-13) : le nom promis
// n'est pas dans l'installeur téléchargé, il est dans le contrat DU POSTE —
// `resources/app-update.yml` de la version installée. `electron-updater` lit ce
// fichier-là, sur le disque, à chaque vérification
// (`ElectronAppAdapter.js` → `resourcesPath`), et sans `publisherName` il ne
// vérifie AUCUNE signature (`NsisUpdater.js` : `if (publisherName == null)
// return null`). Trois conséquences, et elles ne se déduisent pas l'une de
// l'autre :
//
//   • **avant la première version signée**, le parc ne vérifie rien : un
//     installeur signé s'installe donc sans difficulté, et c'est le SEUL moment
//     où la bascule est gratuite ;
//   • **après**, chaque poste qui a installé la version signée promet le nom
//     gravé dans son contrat — et n'acceptera plus jamais autre chose, y compris
//     du non signé. Couper la signature, renommer l'éditeur ou changer de
//     fournisseur gèle alors le parc, machine par machine ;
//   • le nom gravé est le **CN du certificat** (mesuré dans
//     `windowsSignToolManager.js` : `publisherName = [certInfo.commonName]`
//     quand `win.publisherName` n'est pas configuré), donc ce qui doit rester
//     stable pendant des années est le CN demandé à l'autorité — pas le
//     certificat, qui se renouvelle.
//
// D'où les deux refus qui portent le plus, et qu'aucun autre contrôle ne
// prononce : **refuser de publier non signé quand le parc promet un signataire**
// (`unsigned-after-commitment`), et **refuser un nom promis différent de celui
// que le parc a déjà gravé** (`promise-changed`). Les autres cas sont couverts
// pour être nommés, pas pour être tolérés en silence.
//
// CE QUI EST DÉCIDABLE SANS LIRE LES OCTETS DU CANAL
// --------------------------------------------------
// Le contrat est un fichier de données de quelques lignes. Comparer son
// EMPREINTE ne dit pas ce qu'il contient — mais si l'empreinte du contrat qu'on
// s'apprête à livrer est celle d'un contrat déjà publié, alors ce contrat-là EST
// celui qu'on a sous les yeux, et sa promesse est connue. C'est ce
// raisonnement-là que porte `signingTransitionVerdict` : sans contenu lisible,
// un changement d'empreinte est un REFUS DE CONCLURE, jamais un vert.
// ─────────────────────────────────────────────────────────────────────────────

import { sha256 } from './unpacked-manifest.mjs';
import { looksLikeTestSigner, parsePublisherNames } from './updater-trust.mjs';

/**
 * Les causes d'un verdict de bascule, nommées une fois — chacune a un remède
 * différent, et les confondre enverrait chercher au mauvais endroit.
 */
export const TRANSITION = {
  UNCHANGED: 'contract-unchanged',
  UNPROVEN: 'field-change-unproven',
  UNSIGNED_UNCHANGED: 'unsigned-unchanged',
  UNSIGNED_AFTER_COMMITMENT: 'unsigned-after-commitment',
  FIRST_COMMITMENT: 'first-commitment',
  SAME_COMMITMENT: 'commitment-unchanged',
  PROMISE_CHANGED: 'promise-changed',
  PROMISE_EMPTY: 'promise-empty',
  TEST_COMMITMENT: 'test-commitment',
};

/** Ce que chaque cause veut dire, et où est son remède. */
export const TRANSITION_DETAIL = {
  [TRANSITION.UNCHANGED]:
    'le contrat qu’on livre a la même empreinte qu’un contrat déjà publié : le parc reçoit EXACTEMENT le contrat qu’il exécute déjà, donc rien ne change pour lui',
  [TRANSITION.UNPROVEN]:
    'le contrat change et sa promesse n’a pas été LUE : une empreinte qui change ne dit pas ce qui a changé, et conclure sans le contenu serait une supposition — la suite nomme les deux façons de lire cette promesse',
  [TRANSITION.UNSIGNED_UNCHANGED]:
    'aucune promesse nulle part : le poste juge les octets par le `sha512` du flux, et un installeur non signé reste accepté — c’est l’état de référence du parc depuis la 1.0.9',
  [TRANSITION.UNSIGNED_AFTER_COMMITMENT]:
    'des postes promettent un signataire : livrer des octets NON signés fait refuser la mise à jour chez eux (`ERR_UPDATER_INVALID_SIGNATURE`), et ils resteront sur leur version — c’est le gel du parc par la porte de derrière',
  [TRANSITION.FIRST_COMMITMENT]:
    'première version signée : les postes actuels ne vérifient rien, donc ils l’acceptent — mais chacun d’eux gravera ce nom, et TOUTE version suivante devra être signée par un sujet portant ce nom',
  [TRANSITION.SAME_COMMITMENT]:
    'le nom promis est celui que le parc a déjà gravé : la chaîne reste satisfiable',
  [TRANSITION.PROMISE_CHANGED]:
    'le nom promis DIFFÈRE de celui gravé dans les postes : ceux qui promettent l’ancien nom refusent la nouvelle version (le sujet du certificat est comparé au nom promis), donc ils gèlent — garder le même CN, ou réparer ces postes, mais ne pas publier en espérant que ça passe',
  [TRANSITION.PROMISE_EMPTY]:
    'le contrat promet une liste VIDE : aucun certificat ne peut satisfaire une liste vide, donc aucune mise à jour ne s’installerait sur un poste qui l’installerait',
  [TRANSITION.TEST_COMMITMENT]:
    'le nom promis se déclare lui-même de TEST : un certificat auto-signé n’est approuvé que sur la machine qui l’a créé, donc graver ce nom gèle chaque poste qui installe cette version',
};

/**
 * Ce qu'un contrat `app-update.yml` pèse et vaut, pour être comparé à un
 * contrat publié sans avoir à lire son contenu.
 *
 * @param {unknown} text
 * @returns {{ size: number, sha256: string }}
 */
export function contractFingerprint(text) {
  const value = String(text ?? '');
  return { size: Buffer.byteLength(value, 'utf8'), sha256: sha256(value) };
}

/**
 * La promesse d'un contrat, sous la forme qui décide : `null` quand la clé
 * `publisherName` est ABSENTE (le poste ne vérifie alors aucune signature),
 * un tableau quand elle est là (`[]` = promesse vide, qui n'est satisfiable par
 * aucun certificat).
 *
 * @param {unknown} text
 * @returns {string[]|null}
 */
export function contractPromise(text) {
  const { promised, names } = parsePublisherNames(text);
  return promised ? names : null;
}

/**
 * Le parc, regroupé par contrat RÉELLEMENT installé.
 *
 * Les manifestes publiés donnent, par version, l'empreinte du contrat embarqué.
 * Deux versions qui partagent une empreinte partagent donc ce contrat — et
 * compter les groupes, c'est compter les comportements de mise à jour distincts
 * qui existent dans le parc. C'est la seule lecture possible sans télécharger
 * 129 Mo par version, et elle suffit à la question de la bascule : ce qui compte
 * est de savoir si le contrat qu'on livre est DÉJÀ celui de quelqu'un.
 *
 * @param {{ versions?: { version: string, contract?: { size?: number, sha256?: string }|null }[] }} input
 * @returns {{ digest: string, size: number, versions: string[] }[]} — les groupes,
 *   du plus récent au plus ancien, sans les versions dont le contrat n'est pas décrit.
 */
export function fieldContractGroups({ versions = [] } = {}) {
  const groups = new Map();
  for (const entry of Array.isArray(versions) ? versions : []) {
    const digest = String(entry?.contract?.sha256 ?? '').trim();
    const version = String(entry?.version ?? '').trim();
    if (!digest || !version) continue;
    if (!groups.has(digest)) {
      groups.set(digest, { digest, size: Number(entry?.contract?.size) || 0, versions: [] });
    }
    groups.get(digest).versions.push(version);
  }
  return [...groups.values()];
}

/**
 * Un nom promis et un nom que le certificat portera sont-ils le MÊME nom ?
 *
 * La comparaison est celle du poste, à la casse et aux espaces près : c'est un
 * CN qui est gravé, et `subjectMatchesPublisher` cherche `CN=<nom>` dans le
 * sujet du certificat. Comparer ici des chaînes « propres » évite de prononcer
 * un `promise-changed` sur une différence d'espace.
 */
const sameName = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Le verdict de la BASCULE : si l'on livre ce contrat-ci à un parc qui exécute
 * ceux-là, que se passe-t-il ?
 *
 * @param {{
 *   candidate: { promises: string[]|null, fingerprint?: { size?: number, sha256?: string }|null,
 *     simulated?: boolean },
 *   field: { promises?: (string[]|null)[]|null, digests?: string[]|null, evidence?: string },
 *   previous?: string, target?: string,
 * }} input
 *   `candidate.promises` : `null` = le contrat qu'on livre ne promet aucun
 *   signataire ; `[]` = promesse vide ; sinon les noms (CN) que le certificat
 *   portera. `candidate.simulated` : le contrat n'existe pas encore (répétition
 *   « et si le CN était X ? »), donc sa signature réelle n'est pas mesurable ici.
 *   `field.promises` : `null` = promesse inconnue (non lue), sinon une entrée
 *   par contrat du parc (`null` = ce contrat ne promet rien). `field.digests` :
 *   les empreintes de contrats publiées, si connues.
 * @returns {{ ok: boolean, cause: string, conclusion: string, commitment: string[]|null,
 *   frozen: { version: string|null, names: string[] }[], problems: string[], notes: string[], warnings: string[] }}
 */
export function signingTransitionVerdict({ candidate = {}, field = {}, previous = '', target = '' } = {}) {
  const problems = [];
  const notes = [];
  const warnings = [];
  const promises = candidate?.promises ?? null;
  const fingerprint = candidate?.fingerprint ?? null;
  const candidateDigest = String(fingerprint?.sha256 ?? '').trim();
  const fieldPromises = field?.promises ?? null;
  const fieldDigests = (Array.isArray(field?.digests) ? field.digests : []).map((d) => String(d ?? '').trim());
  const evidence = String(field?.evidence ?? '').trim();
  const version = String(previous ?? '').trim();
  const targetVersion = String(target ?? '').trim();
  const where = version ? ` ${version}` : '';
  const simulated = candidate?.simulated === true;

  // Un contrat qui promet un nom de TEST est déjà cassé : aucun certificat
  // publiable ne le satisfera. Il n'est donc PAS une faute du contrat qu'on
  // livre — c'est ce que ces postes-là ont gravé, et leur remède vit sur eux
  // (`repair:frozen-updater`). Le confondre avec un renommage ferait refuser
  // toutes les publications futures à cause de machines qu'un script répare.
  const frozen = (fieldPromises ?? [])
    .filter((names) => Array.isArray(names) && names.length > 0 && names.every(looksLikeTestSigner))
    .map((names) => ({ version: null, names }));
  const testOnly = (names) => Array.isArray(names) && names.length > 0 && names.every(looksLikeTestSigner);

  const verdict = (ok, cause, conclusion, extra = {}) => ({
    ok,
    cause,
    conclusion,
    commitment: null,
    frozen,
    problems,
    notes,
    warnings,
    ...extra,
  });

  if (simulated) {
    notes.push(
      'répétition : le contrat n’existe pas encore, donc la SIGNATURE des octets n’est pas mesurée ici — ' +
        'elle est jugée par `npm run check:updater-trust` sur le build réel, avant publication',
    );
  }

  // ── 1. Le contrat qu'on livre a-t-il déjà été publié ? ────────────────────
  // C'est la seule question décidable SANS lire le contenu : même empreinte =
  // mêmes octets = même promesse que celle qu'on a sous les yeux.
  if (candidateDigest && fieldDigests.includes(candidateDigest)) {
    const names = promises == null ? 'aucune promesse' : promises.map((n) => `« ${n} »`).join(' / ') || 'promesse vide';
    return verdict(
      true,
      TRANSITION.UNCHANGED,
      `le contrat livré (${names}) porte l’empreinte d’un contrat déjà publié — le parc reçoit exactement ce qu’il exécute déjà`,
    );
  }

  // ── 2. Le contenu du parc est-il lisible ? ────────────────────────────────
  if (fieldPromises == null) {
    problems.push(
      `le contrat${where ? ` de${where}` : ''} qu’on s’apprête à livrer n’a PAS la même empreinte que ceux du parc, ` +
        'et la promesse de ces contrats n’a pas été lue — une empreinte qui change ne dit pas CE QUI a changé',
    );
    problems.push(
      targeted(version, targetVersion) ||
        'lire la promesse du parc : sur un poste (`--station="%LOCALAPPDATA%\\Programs\\MamaTheraFinance"`), ' +
          'dans des octets publiés déjà téléchargés (`--field-installer=<chemin>`), ou en interrogeant le canal (`--channel`)',
    );
    return { ok: false, cause: TRANSITION.UNPROVEN, conclusion: TRANSITION_DETAIL[TRANSITION.UNPROVEN], commitment: null, frozen, problems, notes, warnings };
  }

  const known = fieldPromises.filter((names) => Array.isArray(names) && names.length > 0);

  // ── 3. On livre sans promesse ─────────────────────────────────────────────
  if (promises == null || promises.length === 0) {
    if (promises != null && promises.length === 0) {
      problems.push(
        'le contrat qu’on livre promet une liste de signataires VIDE — aucun certificat ne peut satisfaire une liste vide : ' +
          'un poste qui l’installerait n’accepterait plus jamais de mise à jour',
      );
      return { ok: false, cause: TRANSITION.PROMISE_EMPTY, conclusion: TRANSITION_DETAIL[TRANSITION.PROMISE_EMPTY], commitment: null, frozen, problems, notes, warnings };
    }
    if (!known.length) {
      const frozenCount = frozen.length;
      return verdict(
        true,
        TRANSITION.UNSIGNED_UNCHANGED,
        `aucun signataire promis de part et d’autre — un installeur non signé reste accepté par le parc${
          frozenCount ? `, sauf les ${frozenCount} contrat(s) déjà gelés, qui demandent \`npm run repair:frozen-updater -- --apply\`` : ''
        }`,
      );
    }
    for (const names of known) {
      problems.push(
        `des postes promettent ${names.map((n) => `« ${n} »`).join(' / ')} : livrer des octets SANS signature ` +
          'les fait refuser la mise à jour (`ERR_UPDATER_INVALID_SIGNATURE`) — ils resteraient sur leur version',
      );
    }
    problems.push(
      'ne pas couper la signature une fois qu’une version signée est en service : signer la nouvelle version avec un sujet ' +
        'portant le nom promis (ou, si ces postes doivent revenir au `sha512`, retirer la promesse SUR CHAQUE POSTE — `npm run repair:frozen-updater -- --apply`)',
    );
    return { ok: false, cause: TRANSITION.UNSIGNED_AFTER_COMMITMENT, conclusion: TRANSITION_DETAIL[TRANSITION.UNSIGNED_AFTER_COMMITMENT], commitment: null, frozen, problems, notes, warnings };
  }

  // ── 4. On livre avec une promesse ─────────────────────────────────────────
  const testNames = promises.filter(looksLikeTestSigner);
  if (testNames.length) {
    problems.push(
      `le contrat promettrait ${testNames.map((n) => `« ${n} »`).join(' / ')}, un signataire de TEST : ` +
        'un certificat auto-signé n’est approuvé que sur la machine qui l’a créé, donc chaque poste qui installerait ' +
        'cette version refuserait ensuite toutes les suivantes',
    );
    return { ok: false, cause: TRANSITION.TEST_COMMITMENT, conclusion: TRANSITION_DETAIL[TRANSITION.TEST_COMMITMENT], commitment: null, frozen, problems, notes, warnings };
  }

  // Seules les promesses QU'UN CERTIFICAT PUBLIABLE POURRAIT SATISFAIRE font
  // refuser ici : celles qui promettent un nom de test sont déjà gelées (voir
  // ci-dessus), donc elles restent nommées sans bloquer le reste du parc.
  const unsatisfied = known
    .filter((names) => !testOnly(names))
    .filter((names) => !names.some((n) => promises.some((c) => sameName(n, c))));
  if (unsatisfied.length) {
    for (const names of unsatisfied) {
      problems.push(
        `des postes promettent ${names.map((n) => `« ${n} »`).join(' / ')} — le contrat qu’on livre promet ` +
          `${promises.map((n) => `« ${n} »`).join(' / ')} : le sujet du certificat sera comparé à l’ANCIEN nom chez eux, ` +
          'donc ils refuseront cette version',
      );
    }
    problems.push(
      'garder le même CN d’un certificat à l’autre (c’est lui qui est gravé), ou réparer les postes concernés ' +
        '(`npm run repair:frozen-updater -- --apply` retire une promesse qu’aucun certificat ne peut honorer), mais ne pas publier ' +
        'en espérant que le parc suive un renommage',
    );
    return { ok: false, cause: TRANSITION.PROMISE_CHANGED, conclusion: TRANSITION_DETAIL[TRANSITION.PROMISE_CHANGED], commitment: null, frozen, problems, notes, warnings };
  }

  const commitment = promises.map((n) => String(n).trim());
  // « Première fois » se compte sur les promesses qu'un certificat PUBLIABLE
  // pourrait honorer : un parc dont TOUS les contrats promettent un nom de test
  // n'a rien à comparer (ces postes sont gelés, un script les répare), et lire
  // ça comme « l'engagement est déjà pris » ferait passer la première signature
  // réelle pour une continuité.
  const firstTime = !known.filter((names) => !testOnly(names)).length;
  const commitmentNote =
    `engagement : dès qu’un poste installe cette version, son contrat promet ${commitment
      .map((n) => `« ${n} »`)
      .join(' / ')} — toute version SUIVANTE devra être signée par un sujet portant ce nom (le CN du certificat), ` +
    'et couper `SIGNING_ENABLED` gèlera ce poste';
  notes.push(commitmentNote);
  if (frozen.length) {
    notes.push(
      `${frozen.length} contrat(s) du parc promettent un signataire de test et sont donc déjà gelés — ` +
        '`npm run repair:frozen-updater -- --apply` sur ces postes, puis un redémarrage de l’application',
    );
  }
  const conclusion = firstTime
    ? 'première version signée : le parc actuel ne vérifie aucune signature, donc il l’accepte — et c’est le moment ' +
      'le moins cher pour le faire, parce qu’il n’y a rien à renommer ensuite'
    : 'le nom promis est celui que le parc a déjà gravé — la chaîne reste satisfiable';
  return verdict(true, firstTime ? TRANSITION.FIRST_COMMITMENT : TRANSITION.SAME_COMMITMENT, conclusion, { commitment });
}

/** Une suite concrète, quand l'appelant a nommé les versions qu'il compare. */
function targeted(previous, target) {
  if (!previous || !target) return '';
  return (
    `lire la promesse de ${previous} : \`npm run check:signing-transition -- --field-installer=<installeur ${previous}>\`, ` +
    `ou \`npm run check:updater-contract:live\` pour l’extraire des octets publiés de ${target}`
  );
}
