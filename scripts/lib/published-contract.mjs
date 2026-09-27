// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/published-contract.mjs — le contrat de mise à jour EST-IL celui
// que le build a scellé, dans les octets que le canal sert ?
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// `check-updater-trust.mjs` juge le build LOCAL : il lit
// `release/win-unpacked/resources/app-update.yml`. C'est la bonne question avant
// de publier, et la mauvaise après : ce que le parc télécharge n'est pas ce
// dossier, c'est un installeur NSIS posé sur le canal. Entre les deux, il y a
// une compression et un téléversement, et rien ne disait que le contrat
// réellement EMBARQUÉ dans l'installeur publié était celui-là.
//
// Ce module porte la moitié PURE de cette mesure : ce qu'on cherche dans une
// liste d'archive, ce qu'on confronte, et ce qu'on refuse. L'autre moitié —
// télécharger 129 Mo, lancer 7-Zip, interroger Windows — vit dans
// `scripts/check-published-updater-contract.mjs`, parce qu'un verdict qu'on ne
// peut pas prouver sans réseau ni binaire ne se teste pas.
//
// LA RÉFÉRENCE, ET POURQUOI ELLE VIT SUR LE CANAL
// -----------------------------------------------
// Le build publie, à côté de l'installeur, un manifeste d'arborescence
// (`<produit>-<version>-unpacked.manifest.json`) qui décrit `win-unpacked` :
// chemin, taille et sha256 de chaque fichier. Ce manifeste est l'empreinte
// SCELLÉE du dossier construit — donc la seule référence externe capable de
// dire si le contrat extrait des octets publiés est bien celui-là, et pas un
// fichier d'une autre version resté dans l'archive.
//
// Sans cette référence, une extraction ne prouve RIEN : elle montre un fichier,
// pas que c'est le bon. C'est pour ça que l'absence d'entrée dans le manifeste
// publié est un REFUS, jamais un vert.
// ─────────────────────────────────────────────────────────────────────────────

import { sha256 } from './unpacked-manifest.mjs';

/** Le contrat que le poste relit à chaque vérification, chemin dans le paquet. */
export const CONTRACT_IN_APP = 'resources/app-update.yml';

/**
 * Un chemin d'archive ou de manifeste, sous une forme comparable.
 *
 * Les deux sources n'écrivent pas la même chose : un manifeste de build écrit
 * `resources/app-update.yml` (séparateur de l'OS, donc `\` sur Windows), et 7-Zip
 * liste les entrées d'un installeur NSIS avec `$PLUGINSDIR\app-64.7z`. Comparer
 * les chaînes telles quelles ferait échouer la recherche d'un côté ou de
 * l'autre, et un « pas trouvé » se lirait comme « absent » — c'est-à-dire comme
 * un refus, sur un fichier parfaitement présent.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseEntryPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .trim();
}

/**
 * L'entrée du manifeste PUBLIÉ qui décrit le contrat embarqué.
 *
 * @param {{ files?: { path?: string, size?: number, sha256?: string }[] }|null} manifest
 * @returns {{ path: string, size: number, sha256: string }|null} null si le
 *   manifeste ne décrit pas ce chemin — il n'y a alors aucune promesse à tenir.
 */
export function contractEntryFromManifest(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const found = files.find((file) => normaliseEntryPath(file?.path) === CONTRACT_IN_APP);
  if (!found) return null;
  return {
    path: CONTRACT_IN_APP,
    size: Number(found.size) || 0,
    sha256: String(found.sha256 ?? '').trim(),
  };
}

/**
 * Le manifeste publié est-il bien celui dont l'actif du canal annonce l'empreinte ?
 *
 * GitHub publie un `digest` (`sha256:…`) par actif : c'est l'empreinte des octets
 * servis. Un manifeste dont l'empreinte recalculée diffère de celle annoncée est
 * un manifeste que le canal sert dans une autre version que celle qu'il déclare
 * — donc une référence qui ne décrit plus ce qu'elle prétend décrire, et
 * comparer un contrat à une telle référence ne prouverait rien.
 *
 * @param {{ assetDigest?: unknown, text?: unknown }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], digest: string|null }}
 */
export function manifestDigestVerdict({ assetDigest = null, text = null } = {}) {
  const computed = sha256(String(text ?? ''));
  const announced = String(assetDigest ?? '').trim();
  if (!announced) {
    return {
      ok: true,
      digest: computed,
      problems: [],
      warnings: [
        'l’actif du manifeste n’annonce aucune empreinte — la référence a été utilisée telle quelle, sans être scellée par le canal',
      ],
    };
  }
  if (announced !== `sha256:${computed}`) {
    return {
      ok: false,
      digest: computed,
      problems: [
        `le manifeste publié ne répond pas à l’empreinte que le canal annonce : le canal déclare ${announced.slice(0, 24)}…, ` +
          `les octets lus font sha256:${computed.slice(0, 16)}… — une référence non scellée ne peut pas servir de preuve`,
      ],
    };
  }
  return { ok: true, digest: computed, problems: [], warnings: [] };
}

/** Le nom d'archive sous lequel electron-builder range la charge utile du 64 bits. */
const PAYLOAD_64 = /^app-64\.7z$/i;

/**
 * Une liste de 7-Zip, réduite aux CHEMINS qu'elle porte.
 *
 * L'appelant demande la forme technique (`7z l -slt`), dont chaque entrée est
 * écrite `Path = <chemin>` : c'est la seule qui ne dépende ni de la largeur des
 * colonnes, ni de la version de 7-Zip, ni de la profondeur des chemins. Prendre
 * le DERNIER jeton de chaque ligne est ce qui la lit sans connaître le format —
 * les lignes d'en-tête et de synthèse (« Scanning the drive », séparateurs,
 * « Everything is Ok ») ne finissent jamais par quelque chose qui ressemble à
 * une entrée cherchée, donc elles tombent d'elles-mêmes sur les motifs qui
 * suivent.
 *
 * @param {unknown} listing la sortie texte de `7z l -slt`
 * @returns {string[]}
 */
export function archivePaths(listing) {
  const paths = [];
  for (const raw of String(listing ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const token = line.split(/\s+/).pop() ?? '';
    if (!token) continue;
    const path = normaliseEntryPath(token);
    if (path) paths.push(path);
  }
  return paths;
}

/**
 * La charge utile NSIS — l'archive `7z` que l'installeur porte sous `$PLUGINSDIR`.
 *
 * L'ambiguïté est REFUSÉE, jamais tranchée : un installeur qui porterait
 * plusieurs charges utiles (32 et 64 bits, par exemple) laisserait le choix
 * décider à la place de la mesure, et on ne saurait pas laquelle a été
 * interrogée. Le nom 64 bits est préféré quand il est là — c'est celui que le
 * parc installe — et ce choix est écrit, pas déduit.
 *
 * @param {unknown} listing la sortie texte de `7z l` sur l'installeur
 * @returns {{ ok: boolean, name: string|null, problems: string[], candidates: string[] }}
 */
export function payloadArchiveFromListing(listing) {
  const candidates = archivePaths(listing).filter((path) => /\.7z$/i.test(path));
  if (!candidates.length) {
    return {
      ok: false,
      name: null,
      candidates,
      problems: [
        'l’installeur ne porte AUCUNE archive `7z` — ce n’est pas un installeur NSIS d’electron-builder, ' +
          'et il n’y a donc aucun contrat embarqué à mesurer',
      ],
    };
  }
  const preferred = candidates.find((path) => PAYLOAD_64.test(path.split('/').pop() ?? ''));
  if (preferred) return { ok: true, name: preferred, problems: [], candidates };
  if (candidates.length === 1) return { ok: true, name: candidates[0], problems: [], candidates };
  return {
    ok: false,
    name: null,
    candidates,
    problems: [
      `l’installeur porte ${candidates.length} archives (${candidates.join(', ')}) et aucune n’est la charge 64 bits — ` +
        'choisir à la place de la mesure rendrait le verdict inexplicable',
    ],
  };
}

/**
 * Le contrat, tel que la charge utile le liste.
 *
 * @param {unknown} listing la sortie texte de `7z l` sur la charge utile
 * @returns {{ ok: boolean, name: string|null, problems: string[] }}
 */
export function contractFromArchiveListing(listing) {
  const found = archivePaths(listing).find((path) => path === CONTRACT_IN_APP);
  if (!found) {
    return {
      ok: false,
      name: null,
      problems: [
        `la charge utile ne porte pas \`${CONTRACT_IN_APP}\` — un binaire sans ce fichier ne se mettra jamais à jour, ` +
          'et il n’y a rien à comparer au manifeste publié',
      ],
    };
  }
  return { ok: true, name: found, problems: [] };
}

/**
 * Les octets servis tiennent-ils la promesse de `latest.yml` ?
 *
 * C'est le premier verrou du poste — `electron-updater` rehache le fichier
 * téléchargé avant toute installation — donc mesurer le contrat sur des octets
 * qui ne répondent pas à cette promesse serait mesurer autre chose que ce que
 * le parc recevra.
 *
 * @param {{ expected?: { size?: number|null, sha512?: string|null }|null,
 *   served?: { size?: number|null, sha512?: string|null }|null }} input
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function compareInstallerBytes({ expected = null, served = null } = {}) {
  const problems = [];
  if (!served || served.size == null || served.size === 0 || !served.sha512) {
    return {
      ok: false,
      problems: [
        'les octets de l’installeur n’ont pas pu être lus — sans eux, il n’y a pas de contrat embarqué à extraire',
      ],
    };
  }
  if (expected?.size != null && expected.size !== served.size) {
    problems.push(
      `taille de l’installeur : le flux annonce ${expected.size} octet(s), les octets téléchargés en font ${served.size}`,
    );
  }
  if (expected?.sha512 && expected.sha512 !== served.sha512) {
    problems.push(
      `sha512 de l’installeur : le flux promet ${String(expected.sha512).slice(0, 16)}…, les octets font ${String(served.sha512).slice(0, 16)}… ` +
        '— ce que le poste refuserait ne prouve rien sur ce qu’il installera',
    );
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Le contrat EXTRAIT des octets publiés est-il celui que le manifeste scelle ?
 *
 * Trois lectures, et chacune a sa raison : la présence (un contrat vide n'est
 * pas un contrat), la taille (une recompression d'une autre version ne pèse pas
 * le même poids), et le sha256 (le seul qui identifie les octets). La taille est
 * aussi une information de diagnostic — quand les deux empreintes diffèrent, dire
 * « 104 vs 149 octets » désigne tout de suite la promesse de test de la 1.0.8,
 * alors qu'une empreinte seule laisse chercher.
 *
 * @param {{ entry?: { path?: string, size?: number, sha256?: string }|null,
 *   extracted?: { text?: string|null, size?: number|null, sha256?: string|null }|null }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
export function compareContractBytes({ entry = null, extracted = null } = {}) {
  const problems = [];
  const warnings = [];
  if (!entry) {
    return {
      ok: false,
      warnings,
      problems: [
        'le manifeste publié ne décrit pas le contrat embarqué — sans référence scellée, une extraction ne prouve ' +
          'que l’existence d’un fichier, pas que c’est celui du build',
      ],
    };
  }
  if (!entry.sha256) {
    problems.push(
      'le manifeste publié décrit le contrat sans empreinte — une entrée sans sha256 ne peut rien sceller',
    );
  }
  const size = extracted?.size ?? null;
  const digest = String(extracted?.sha256 ?? '').trim();
  if (size == null || size === 0 || !digest) {
    return {
      ok: false,
      warnings,
      problems: [
        'le contrat n’a pas pu être EXTRAIT des octets publiés (fichier vide, ou extraction refusée) — ' +
          'il n’y a alors aucune mesure, et une mesure absente n’est pas un vert',
      ],
    };
  }
  if (entry.size && entry.size !== size) {
    problems.push(
      `taille du contrat embarqué : le manifeste publié en annonce ${entry.size} octet(s), l’installeur publié en porte ${size}`,
    );
  }
  if (entry.sha256 && digest !== entry.sha256) {
    problems.push(
      `sha256 du contrat embarqué : le manifeste publié scelle ${entry.sha256.slice(0, 16)}…, ` +
        `l’installeur publié porte ${digest.slice(0, 16)}… — les octets servis ne portent pas le contrat que le build a scellé`,
    );
  }
  if (!problems.length && entry.size && entry.size === size && entry.sha256 === digest) {
    warnings.push(
      `le contrat embarqué est celui du build scellé (${size} octet(s), sha256 ${digest.slice(0, 16)}…)`,
    );
  }
  return { ok: problems.length === 0, problems, warnings };
}
