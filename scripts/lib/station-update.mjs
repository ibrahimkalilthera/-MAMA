// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/station-update.mjs — un poste PARTI d'une version antérieure
// atteint-il la version publiée, et sinon POURQUOI ?
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// La chaîne de mise à jour savait déjà se prouver contre un flux LOCAL
// (`verify-updater.mjs`) : vérification, disponibilité, progression,
// téléchargement, politique d'obligation. Ce qu'aucun contrôle ne disait, c'est
// ce que la question de l'école demande vraiment — **un poste déjà installé, sur
// une version PUBLIÉE antérieure, rejoint-il la dernière publiée, tout seul et
// contre le canal réel ?** Et quand la réponse est non, la cause n'est pas la
// même selon les cas : un frein d'urgence, un canal injoignable, des octets qui
// ne répondent pas au flux, un téléchargement qui casse, ou une installation qui
// se termine… sans rien changer. Chacune a un remède différent, et les confondre
// envoie chercher une panne qui n'existe pas.
//
// D'où deux verdicts PURS, testables sans binaire ni réseau : celui de la
// CHAÎNE (ce que le journal de preuve raconte, dans l'ordre) et celui du
// PARCOURS COMPLET (la chaîne, puis la version réellement installée après la
// fermeture de l'application). Les causes sont des jetons stables — un échec se
// rapporte AVEC la sienne, jamais avec « ça n'a pas marché ».
//
// La sélection de la version de départ est ici pour la même raison : « le poste
// part d'une version antérieure » est une propriété à vérifier, pas une
// supposition. Un run qui partirait de la tête ne prouverait rien, et un run sans
// version antérieure publiée doit le DIRE au lieu de ne rien mesurer.
// ─────────────────────────────────────────────────────────────────────────────

import { compareVersions, versionParts } from './release-version.mjs';

/**
 * Les causes d'échec, nommées une fois pour être citées sans faute de frappe.
 * Chacune a un remède distinct, et c'est pour ça qu'elles ne se confondent pas.
 */
export const CAUSE = {
  HEAD_HELD: 'head-held',
  CONTRACT_FROZEN: 'contract-frozen',
  BYTES_REFUSED: 'bytes-refused',
  DOWNLOAD_FAILED: 'download-failed',
  FEED_UNREACHABLE: 'feed-unreachable',
  NOT_OFFERED: 'no-update-offered',
  CHAIN_INCOMPLETE: 'chain-incomplete',
  INSTALL_BLOCKED_DIALOG: 'install-blocked-dialog',
  INSTALL_MISSING: 'install-missing',
  INSTALL_NOOP: 'install-noop',
  INSTALL_OTHER: 'install-other',
};

/** Ce que chaque cause veut dire, en clair — et où est son remède. */
export const CAUSE_DETAIL = {
  [CAUSE.HEAD_HELD]:
    'la version de tête est RETENUE par le frein d’urgence — aucun poste ne doit la recevoir, donc le run ne peut pas prouver une mise à jour',
  [CAUSE.CONTRACT_FROZEN]:
    'le contrat du poste de départ promet un signataire qu’il ne peut pas vérifier : ce poste-là est GELÉ, et ce n’est pas la mise à jour qui est cassée (remède : `npm run repair:frozen-updater`)',
  [CAUSE.BYTES_REFUSED]:
    'les octets servis par le canal ne répondent pas à la promesse du flux — le poste les a refusés, et le remède est sur le CANAL, pas sur le poste',
  [CAUSE.DOWNLOAD_FAILED]:
    'le téléchargement a échoué — réseau du poste, proxy, ou flux qui ne sert pas le fichier annoncé',
  [CAUSE.FEED_UNREACHABLE]:
    'le poste n’a pas pu lire le canal (flux ou release injoignable) — c’est la lecture qui a échoué, pas la mise à jour',
  [CAUSE.NOT_OFFERED]:
    'le canal n’a offert AUCUNE mise à jour à un poste pourtant antérieur : la tête publiée ne lui est pas accessible',
  [CAUSE.CHAIN_INCOMPLETE]:
    'le poste n’est jamais allé au bout du téléchargement, et son journal ne dit pas pourquoi',
  [CAUSE.INSTALL_BLOCKED_DIALOG]:
    'l’installateur de mise à jour attend un CLIC au lieu de s’installer : il a affiché une boîte au lieu de continuer — donc « sans geste de l’utilisateur » n’est PAS tenu. Ce que le poste devient est MESURÉ, pas supposé : `appStillThere` dit si l’ancienne application est encore là',
  [CAUSE.INSTALL_MISSING]:
    'aucune version n’a pu être lue dans l’installation après la fermeture de l’application — l’installation n’a rien produit, ou le binaire a disparu',
  [CAUSE.INSTALL_NOOP]:
    'l’application s’est fermée et l’installation s’est terminée… sur la MÊME version : le poste n’a pas bougé',
  [CAUSE.INSTALL_OTHER]:
    'l’installation a produit une version qui n’est pas celle de la tête — le canal et les octets ne disent pas la même chose',
};

/**
 * La version PUBLIÉE qui précède la tête — l'état de départ de la preuve.
 *
 * Ce n'est pas « la plus petite » ni « la première de la liste » : c'est la plus
 * HAUTE des versions strictement inférieures à la tête, parce que c'est ce qu'un
 * poste d'école est réellement — un cran en arrière, pas trois.
 *
 * @param {{ versions?: string[], head?: string }} input les versions publiées, dans n'importe quel ordre
 * @returns {{ ok: boolean, version: string|null, problems: string[], warnings: string[] }}
 */
export function previousPublishedVersion({ versions = [], head = '' } = {}) {
  const problems = [];
  const wanted = String(head ?? '').trim().replace(/^v/, '');
  if (!wanted || !versionParts(wanted)) {
    return { ok: false, version: null, problems: [`la tête « ${head} » n’est pas un numéro de version lisible`], warnings: [] };
  }
  const readable = [...new Set((Array.isArray(versions) ? versions : []).map((v) => String(v ?? '').trim().replace(/^v/, '')))]
    .filter((v) => versionParts(v) !== null);
  if (!readable.length) {
    return {
      ok: false,
      version: null,
      problems: ['aucune version PUBLIÉE n’est lisible — un poste de départ ne peut pas être choisi, donc rien ne serait mesuré'],
      warnings: [],
    };
  }
  const below = readable.filter((v) => compareVersions(v, wanted) === -1).sort((a, b) => compareVersions(b, a));
  if (!below.length) {
    return {
      ok: false,
      version: null,
      problems: [
        `aucune version publiée n’est ANTÉRIEURE à ${wanted} — sans version de départ, ce contrôle ne peut pas montrer un poste qui rejoint la tête`,
      ],
      warnings: [],
    };
  }
  return { ok: true, version: below[0], problems: [], warnings: [] };
}

/**
 * Les noms des codes de statut Windows qu'on est susceptible de rencontrer ici.
 *
 * Ils sont NOMMÉS parce qu'un numéro seul ne dit rien à personne : lire
 * « 0xC0000374 » et savoir que c'est STATUS_HEAP_CORRUPTION (le processus a
 * planté en sortant) oriente le remède ; lire « -1073740940 » n'oriente rien.
 */
const STATUS_NAMES = {
  '0x0': 'succès',
  '0x2': 'ERROR_FILE_NOT_FOUND',
  '0x3': 'ERROR_PATH_NOT_FOUND',
  '0x5': 'ERROR_ACCESS_DENIED',
  '0xC0000005': 'STATUS_ACCESS_VIOLATION',
  '0xC000013A': 'STATUS_CONTROL_C_EXIT (interrompu)',
  '0xC0000374': 'STATUS_HEAP_CORRUPTION (le processus a planté en sortant)',
  '0xC0000409': 'STATUS_STACK_BUFFER_OVERRUN',
  '0xC0000142': 'STATUS_DLL_INIT_FAILED',
};

/**
 * Un code de sortie lisible : signé, hexadécimal 32 bits, et son nom Windows.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function exitCodeLabel(value) {
  // `null` et `''` ne sont PAS « 0 » : `Number(null)` vaut 0, et rendre « succès »
  // pour un code qu'on n'a pas lu serait exactement le faux vert que ce module
  // existe pour empêcher.
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const hex = `0x${(number >>> 0).toString(16).toUpperCase()}`;
  return `${number} (${hex})${STATUS_NAMES[hex] ? ` — ${STATUS_NAMES[hex]}` : ''}`;
}

/**
 * Le texte par lequel electron-builder dit qu'il n'a pas pu retirer l'ancienne
 * version.
 *
 * Le motif s'accroche aux MOTS SANS ACCENT (« anciens fichiers ») : mesuré, la
 * sortie d'un cmdlet Windows revient mojibakée si l'encodage n'est pas forcé
 * (le « É` de « Échec » arrive en `?`), et un motif qui exigerait l'accent
 * laisserait passer le diagnostic par le mauvais chemin — c'est-à-dire
 * l'aurait raté exactement le jour où il compte.
 */
const OLD_UNINSTALL_FAILED = /anciens fichiers|old files|uninstall old|failed to uninstall/i;

/**
 * @typedef {{ visible?: boolean, title?: string, texts?: string[] }} Dialog
 */

/**
 * La boîte que l'installateur de mise à jour affiche AU LIEU de s'installer.
 *
 * C'est le mode de panne le plus trompeur de la chaîne : le poste a téléchargé,
 * la chaîne est complète, rien n'est rouge — et pourtant l'installation attend un
 * clic que personne ne donnera (l'utilisateur, lui, a déjà fermé la fenêtre).
 * Mesuré le 2026-09-22 sur la paire publiée 1.0.17 → 1.0.18 : l'ancien
 * désinstalleur rend `0xC0000374` (STATUS_HEAP_CORRUPTION) dès qu'il est lancé
 * EN PLACE (`_?=<dossier>`, ce que fait l'installateur), et electron-builder
 * affiche « Échec de désinstallation des anciens fichiers d'application » — une
 * boîte qui s'affiche MÊME en mode silencieux (`/S`) ; l'installation ne reprend
 * jamais.
 *
 * Ce que le POSTE devient ensuite n'est pas déduit, il est MESURÉ : c'est le rôle
 * de `appStillThere`, mesuré dans le dossier d'installation après le blocage.
 * Le fait vaut d'être dit, parce que les deux cas n'ont pas le même remède —
 * mesuré ici, la boîte s'affiche et l'ancienne application reste ENTIÈREMENT en
 * place (0 fichier sur 20 retiré), donc l'école continue de travailler pendant
 * qu'aucune mise à jour ne passe ; le cas inverse (plus aucun binaire) laisse un
 * poste sans application, et c'est celui qui exige un geste tout de suite.
 *
 * Le tout est documenté en UN seul paramètre : `station-update` est du JavaScript
 * et c'est ce que le compilateur lit — deux lignes séparées pour un objet
 * déstructuré font typer la fonction par le PREMIER des deux (`dialog`), donc
 * refuser `{ dialog: … }` à l'appel. Écrit ainsi, `tsc --noEmit` est d'accord avec
 * le code, et ce n'est pas cosmétique : le contrôle de types du dépôt passe par là.
 *
 * `appStillThere` absent (ou `null`) veut dire « NON mesuré » — et ce n'est pas la
 * même chose que mesuré à `false`.
 *
 * @param {{ dialog?: Dialog|null, previous?: string, target?: string, appStillThere?: boolean }} [input]
 * @returns {{ blocked: boolean, cause: string|null, code: string|null, problems: string[], notes: string[] }}
 */
export function installerDialogVerdict({ dialog = null, previous = '', target = '', appStillThere = null } = {}) {
  const notes = [];
  const problems = [];
  if (!dialog || dialog.visible !== true) return { blocked: false, cause: null, code: null, problems, notes };
  const texts = (Array.isArray(dialog.texts) ? dialog.texts : []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const joined = texts.join(' · ');
  if (!joined) return { blocked: false, cause: null, code: null, problems, notes };

  const title = String(dialog.title ?? '').trim();
  notes.push(`boîte affichée par l’installateur${title ? ` (« ${title} »)` : ''} : ${joined.slice(0, 300)}`);
  const failing = /(-?\d{6,})/.exec(joined);
  const code = failing ? exitCodeLabel(failing[1]) : null;
  if (code) notes.push(`code rendu par l’ancien désinstalleur : ${code}`);

  problems.push(`l’installateur de mise à jour attend un clic : ${joined.slice(0, 300)}`);
  if (OLD_UNINSTALL_FAILED.test(joined)) {
    problems.push(
      `l’ancienne version (${previous || '—'}) n’a pas pu être retirée${code ? ` — son désinstalleur a rendu ${code}` : ''} : l’installation s’arrête là, et ${target || 'la mise à jour'} n’est pas installée`,
    );
    // Le sort de l'ancienne installation est une MESURE. L'affirmer sans l'avoir
    // faite serait le pire des deux mondes : paniquer une école dont le poste
    // travaille très bien, ou rassurer une école dont le poste n'a plus rien.
    if (appStillThere === true) {
      problems.push(
        `l’ancienne application est TOUJOURS EN PLACE (mesuré dans le dossier d’installation après le blocage) : le poste continue de travailler en ` +
          `${previous || 'sa version'}, mais il n’a PAS reçu ${target || 'la tête'} — et il ne la recevra pas sans intervention`,
      );
    } else if (appStillThere === false) {
      problems.push(
        'PLUS AUCUN binaire d’application dans le dossier d’installation (mesuré) : le désinstalleur a retiré l’ancienne version et l’installation s’est arrêtée avant d’écrire la nouvelle — ce poste est SANS application et c’est celui-là qu’il faut remettre d’aplomb en premier',
      );
    } else {
      problems.push(
        'le sort de l’ancienne installation n’a PAS été mesuré : ne rien affirmer au-delà de ce qui a été lu — relancer avec la mesure du dossier d’installation',
      );
    }
    problems.push(
      'ce n’est pas la mise à jour qui est en cause : c’est le désinstalleur installé sur le poste. Vérifie-le seul ' +
        '(`Uninstall MamaTheraFinance.exe /S _?=<dossier>`) — s’il rend le même code, le remède est sur le POSTE (réinstaller proprement), pas sur le canal',
    );
  } else {
    problems.push('aucune installation ne reprendra tant que personne ne clique — la preuve « sans geste de l’utilisateur » est donc réfutée');
    if (appStillThere === true && previous) {
      notes.push(`l’ancienne application est toujours en place (mesuré) : le poste travaille encore en ${previous}`);
    }
  }
  return { blocked: true, cause: CAUSE.INSTALL_BLOCKED_DIALOG, code, problems, notes };
}

/** Le préfixe d'une ligne du journal de preuve, sans son horodatage. */
const body = (line) => String(line ?? '').replace(/^\S+\s+/, '').trim();

/**
 * Ce que le journal du poste raconte : chaîne parcourue, et cause si elle casse.
 *
 * Les lignes d'erreur sont cherchées AVANT tout jugement de complétude : une
 * chaîne qui n'est pas allée au bout a une cause inscrite plus souvent qu'on ne
 * le croit, et ne pas la lire reviendrait à rapporter « incomplet » là où le
 * poste a dit exactement ce qui n'allait pas.
 *
 * @param {{ lines?: string[], target?: string }} input
 * @returns {{ ok: boolean, cause: string|null, causeDetail: string|null,
 *   chain: { checking: boolean, available: boolean, progress: boolean, downloaded: boolean },
 *   checks: number, problems: string[], warnings: string[], notes: string[] }}
 */
export function updateChainVerdict({ lines = [], target = '' } = {}) {
  const wanted = String(target ?? '').trim().replace(/^v/, '');
  const messages = (Array.isArray(lines) ? lines : []).map(body).filter(Boolean);
  const has = (prefix) => messages.some((m) => m.startsWith(prefix));
  const all = (prefix) => messages.filter((m) => m.startsWith(prefix));
  const problems = [];
  const warnings = [];
  const notes = [];

  const checks = all('checking-for-update').length;
  const chain = {
    checking: checks > 0,
    available: messages.some((m) => m.startsWith('update-available') && (!wanted || m.includes(wanted))),
    progress: has('download-progress'),
    downloaded: messages.some((m) => m.startsWith('update-downloaded') && (!wanted || m.includes(wanted))),
  };
  const held = all('update-retenue').find((m) => !wanted || m.includes(wanted)) ?? null;
  const refusedBytes = has('octets non conformes au flux');
  const feedFailed = all('check-failed').length > 0;
  const downloadFailed =
    all('échec de téléchargement').length > 0 ||
    messages.some((m) => m.startsWith('poste bloqué (download'));
  const errors = all('error');
  const notAvailable = has('update-not-available');
  const heldAny = has('update-retenue');

  for (const line of errors) notes.push(`journal du poste : ${line}`);
  for (const line of all('poste bloqué')) notes.push(`journal du poste : ${line}`);

  // L'ordre EST le verdict : le frein d'abord (rien ne devait être livré), puis
  // les octets menteurs (remède sur le canal), puis le téléchargement, puis la
  // lecture du canal, puis l'absence d'offre, puis l'incomplétude muette.
  let cause = null;
  if (held || heldAny || refusedBytes || downloadFailed || feedFailed || notAvailable || !chain.downloaded) {
    if (held) cause = CAUSE.HEAD_HELD;
    else if (refusedBytes) cause = CAUSE.BYTES_REFUSED;
    else if (downloadFailed) cause = CAUSE.DOWNLOAD_FAILED;
    else if (feedFailed) cause = CAUSE.FEED_UNREACHABLE;
    else if (notAvailable && !chain.available) cause = CAUSE.NOT_OFFERED;
    else if (!chain.downloaded) cause = CAUSE.CHAIN_INCOMPLETE;
  }

  if (cause) {
    problems.push(`la chaîne de mise à jour n’a pas abouti (cause « ${cause} ») : ${CAUSE_DETAIL[cause]}`);
    if (held) problems.push(`ligne du journal : ${held}`);
    if (notAvailable && !chain.available) problems.push('le poste a répondu « update-not-available » alors qu’il est ANTÉRIEUR à la tête');
    if (!chain.available && !held) warnings.push('le poste n’a jamais vu la version de tête annoncée par le canal');
    if (!chain.progress) warnings.push('aucune progression de téléchargement dans le journal : rien n’a été téléchargé');
  } else {
    notes.push(`chaîne complète : checking → available ${wanted} → progress → downloaded ${wanted} (${checks} vérification(s))`);
  }

  return { ok: cause === null, cause, causeDetail: cause ? CAUSE_DETAIL[cause] : null, chain, checks, problems, warnings, notes };
}

/**
 * Le parcours COMPLET : la chaîne, puis la version réellement installée.
 *
 * Les deux moitiés ne se remplacent pas. Une chaîne complète qui se termine sur
 * la même version est le pire cas — un poste qui a l'air à jour de la mise à
 * jour, et qui n'a rien installé — et une version juste sans chaîne lue ne
 * dirait pas non plus que la station a rejoint la tête par ce chemin.
 *
 * @param {{ chain?: ReturnType<typeof updateChainVerdict>|null, before?: string|null,
 *   after?: string|null, target?: string }} input
 * @returns {{ ok: boolean, cause: string|null, causeDetail: string|null, problems: string[], warnings: string[], notes: string[] }}
 */
export function stationReach({ chain = null, before = null, after = null, target = '' } = {}) {
  const wanted = String(target ?? '').trim().replace(/^v/, '');
  const problems = [];
  const warnings = [];
  const notes = [];
  if (!chain) {
    return {
      ok: false,
      cause: null,
      causeDetail: null,
      problems: ['aucune lecture du journal du poste — sans elle, il n’y a pas de preuve, seulement une version installée'],
      warnings,
      notes,
    };
  }
  problems.push(...chain.problems);
  warnings.push(...chain.warnings);
  notes.push(...chain.notes);
  if (!chain.ok) return { ok: false, cause: chain.cause, causeDetail: chain.causeDetail, problems, warnings, notes };

  const readme = (v) => String(v ?? '').trim().replace(/^v/, '');
  const from = readme(before);
  const to = readme(after);
  // Le départ doit être ANTÉRIEUR à la tête : un poste déjà à jour qui « atteint »
  // la tête ne montre rien, et le dire vaut mieux que le laisser passer pour un
  // succès.
  if (from && wanted && compareVersions(from, wanted) !== -1) {
    notes.push(`poste de départ en ${from} : pas antérieur à la tête ${wanted} — ce parcours ne peut rien prouver`);
    return { ok: false, cause: null, causeDetail: null, problems, warnings, notes };
  }

  let cause = null;
  if (!to || !versionParts(to)) cause = CAUSE.INSTALL_MISSING;
  else if (to === from) cause = CAUSE.INSTALL_NOOP;
  else if (to !== wanted) cause = CAUSE.INSTALL_OTHER;
  if (cause) {
    problems.push(`le poste n’a pas atteint ${wanted} (cause « ${cause} ») : ${CAUSE_DETAIL[cause]}`);
    problems.push(`version lue dans l’installation : ${to || '—'} (départ ${from || '—'}, cible ${wanted || '—'})`);
    return { ok: false, cause, causeDetail: CAUSE_DETAIL[cause], problems, warnings, notes };
  }
  notes.push(`le poste est passé de ${from} à ${to} : la tête publiée est installée`);
  return { ok: true, cause: null, causeDetail: null, problems, warnings, notes };
}

/**
 * Une installation de la MÊME application est-elle déjà présente ?
 *
 * Cette preuve INSTALLE puis DÉSINSTALLE l'application. Or une installation
 * silencieuse réécrit l'entrée de désinstallation du système pour la même
 * application : lancée sur une machine qui en porte déjà une, elle laisserait
 * l'installation réelle orpheline (fichiers présents, plus aucune entrée de
 * désinstallation) — un dégât qu'aucun nettoyage de ce script ne répare. Le refus
 * est donc POSÉ, pas déduit : on refuse si une entrée existe et qu'elle ne
 * désigne pas un dossier de travail temporaire.
 *
 * @param {{ entries?: { key?: string, displayName?: string, installLocation?: string }[] }} input
 * @returns {{ ok: boolean, installs: { key: string, displayName: string, installLocation: string }[], problems: string[] }}
 */
export function existingInstallVerdict({ entries = [] } = {}) {
  const installs = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      key: String(entry?.key ?? ''),
      displayName: String(entry?.displayName ?? '').trim(),
      installLocation: String(entry?.installLocation ?? '').trim(),
    }))
    .filter((entry) => entry.installLocation || entry.displayName);
  const real = installs.filter((entry) => !/\\Temp\\|\\tmp\\|AppData\\Local\\Temp/i.test(entry.installLocation));
  if (!real.length) {
    return { ok: true, installs, problems: [] };
  }
  return {
    ok: false,
    installs,
    problems: [
      `une installation de cette application est DÉJÀ présente : ${real
        .map((e) => `${e.displayName || e.key}${e.installLocation ? ` (${e.installLocation})` : ''}`)
        .join(', ')}`,
      'cette preuve installe puis désinstalle la même application : la lancer ici réécrirait l’entrée de désinstallation du système et laisserait l’installation existante orpheline',
      'lance-la sur une machine sans installation (elle est faite pour ça : job CI, ou poste de recette) — et n’installe jamais cette preuve sur un poste d’école',
    ],
  };
}
