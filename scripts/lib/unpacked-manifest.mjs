// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/unpacked-manifest.mjs — donner une EMPREINTE à une arborescence,
// pour qu'un dossier de sortie cesse d'être improuvable.
//
// `release/win-unpacked` pèse 507 Mo et n'a ni numéro ni empreinte : le canal ne
// peut donc rien dire de lui, et son sort reste une décision humaine — 507 Mo
// qu'on garde par prudence ou qu'on jette en espérant. C'est le dernier volume
// que le plan ne peut pas CONDAMNER.
//
// La preuve existe pourtant, et elle ne demande aucun téléchargement : si
// l'arborescence a été décrite par un manifeste PUBLIÉ, alors l'empreinte du
// manifeste recomposé localement EST la preuve. Un manifeste est une fonction
// déterministe de l'arbre (direction `path`, taille, sha256 de chaque fichier,
// triés), donc deux arbres identiques donnent deux fois les mêmes octets — et le
// canal en publie le digest. Comparer les deux dit « le canal détient déjà ce
// manifeste », donc « ces octets-là sont déjà servis ».
//
// Ce qui n'est PAS dans le manifeste, et c'est délibéré : la VERSION. La mettre
// ferait dépendre la preuve de ce qui est en préparation aujourd'hui, donc un
// `win-unpacked` construit pour 1.0.6 cesserait d'être prouvable dès qu'on
// prépare 1.0.7 — alors que ses octets n'ont pas changé. La version vit dans le
// NOM de l'actif publié (`<produit>-<version>-unpacked.manifest.json`), pas dans
// ce qu'il décrit.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Le suffixe qui range un manifeste parmi les actifs publiés. */
export const MANIFEST_SUFFIX = '-unpacked.manifest.json';

/**
 * Le nom de l'actif publié pour une arborescence, version comprise.
 *
 * C'est le produit et la version qui nomment l'actif — comme pour un installeur —
 * donc un manifeste ne peut pas se faire passer pour celui d'un autre numéro.
 *
 * @param {string} product le nom du produit (`MamaTheraFinance`)
 * @param {string} version la version du build
 * @returns {string}
 */
export function manifestAssetName(product, version) {
  return `${String(product ?? '').trim()}-${String(version ?? '').trim()}${MANIFEST_SUFFIX}`;
}

/** Un actif publié est-il un manifeste d'arborescence ? */
export const isManifestAsset = (name) => String(name ?? '').endsWith(MANIFEST_SUFFIX);

/**
 * Le manifeste d'une arborescence, canonique.
 *
 * Canonique veut dire : même arbre ⇒ mêmes octets. Les fichiers sont TRIÉS par
 * chemin et les clés sont posées dans un ordre fixe, parce que deux
 * sérialisations d'un même contenu donneraient deux empreintes différentes — et
 * la preuve repose entièrement sur cette égalité-là.
 *
 * @param {{ dir?: string, files?: { path?: string, size?: number, sha256?: string }[] }} input
 * @returns {{ dir: string, bytes: number, files: { path: string, size: number, sha256: string }[] }}
 */
export function buildManifest({ dir = '', files = [] } = {}) {
  const normalised = files
    .map((file) => ({
      path: String(file?.path ?? '').replace(/\\/g, '/'),
      size: Number(file?.size) || 0,
      sha256: String(file?.sha256 ?? ''),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    dir: String(dir ?? ''),
    bytes: normalised.reduce((sum, file) => sum + file.size, 0),
    files: normalised,
  };
}

/**
 * Les octets EXACTS du manifeste — c'est d'eux que l'empreinte est calculée.
 *
 * Volontairement pas d'indentation : la lisibilité d'un fichier qu'aucun humain
 * ne lit à la main ne vaut pas un octet de plus par ligne multiplié par des
 * milliers de fichiers.
 *
 * @param {ReturnType<typeof buildManifest>} manifest
 * @returns {string}
 */
export function manifestText(manifest) {
  const canonical = buildManifest(manifest);
  return JSON.stringify({
    dir: canonical.dir,
    bytes: canonical.bytes,
    files: canonical.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
  });
}

/** L'empreinte sha256 d'un contenu, telle que le canal la publie (sans préfixe). */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Décrire une arborescence TELLE QU'ELLE EST sur le disque.
 *
 * Un seul parcours pour les deux appelants — le build qui ÉCRIT le manifeste et
 * l'atelier qui le RECOMPOSE pour le comparer. La preuve repose entièrement sur
 * l'égalité des deux descriptions : deux parcours séparés finiraient par ne plus
 * décrire la même chose (un séparateur non normalisé, un type d'entrée retenu d'un
 * côté et pas de l'autre), et la comparaison deviendrait un faux négatif permanent.
 *
 * Les chemins sont ceux de l'OS (séparateur compris) : la forme canonique a UN
 * propriétaire, `buildManifest`, et c'est ce qui fait que deux OS produisent la
 * même empreinte — pas une convention que chaque appelant devrait respecter.
 *
 * @param {string} dir la racine de l'arborescence
 * @param {{ base?: string }} [options] la racine dont les chemins sont relatifs
 * @returns {{ path: string, size: number, sha256: string }[]}
 */
export function hashTree(dir, { base = dir } = {}) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Ce qui n'est ni dossier ni fichier (lien, jonction) n'est pas décrit :
      // sha256 n'a pas de sens sur autre chose que des octets, et un manifeste
      // qui contiendrait une entrée de type inconnu ne serait comparable à rien.
      if (!entry.isFile()) continue;
      const bytes = readFileSync(full);
      files.push({
        path: relative(base, full),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  };
  walk(dir);
  return files;
}

/**
 * Le manifeste d'une arborescence du disque, et son empreinte — la seule chose
 * qu'on compare à ce que le canal publie.
 *
 * @param {string} dir la racine à décrire
 * @param {{ label?: string }} [options] le nom que le manifeste donne à l'arbre
 *   (le nom du dossier, tel qu'il se lit dans `release/`)
 * @returns {{ manifest: ReturnType<typeof buildManifest>, text: string, digest: string }}
 */
export function manifestOfTree(dir, { label = '' } = {}) {
  const manifest = buildManifest({ dir: label, files: hashTree(dir) });
  const text = manifestText(manifest);
  return { manifest, text, digest: sha256(text) };
}

/**
 * L'actif publié qui correspond EXACTEMENT à cette arborescence, ou `null`.
 *
 * Le canal expose un `digest` (`sha256:…`) par actif : c'est l'empreinte des
 * octets qu'il sert. Un manifeste publié dont l'empreinte est celle du manifeste
 * recomposé localement dit donc, sans télécharger un octet, que le canal détient
 * déjà la description exacte de cette arborescence — donc ces octets-là.
 *
 * Un actif sans digest n'est pas une preuve (une taille seule n'identifie pas des
 * octets), et un actif qui n'est pas un manifeste n'entre pas dans cette
 * comparaison.
 *
 * Le résultat porte le NUMÉRO du manifeste qui a mordu (`version`), parce que
 * toute la décision n'est pas dans « ça correspond » : l'atelier doit encore dire
 * si ces octets sont ceux du build en cours ou ceux d'un build antérieur, et ces
 * deux lectures n'appellent pas le même sort.
 *
 * @param {{ digest?: string|null, name?: string }[]} assets les actifs des releases publiés
 * @param {string} localDigest l'empreinte du manifeste recomposé
 * @returns {{ name: string, digest: string, version?: string }|null}
 */
export function matchingManifestAsset(assets = [], localDigest = '') {
  if (!localDigest) return null;
  const wanted = `sha256:${localDigest}`;
  for (const asset of Array.isArray(assets) ? assets : []) {
    const name = String(asset?.name ?? '');
    if (!isManifestAsset(name)) continue;
    if (String(asset?.digest ?? '') === wanted) return { ...asset, name, digest: wanted };
  }
  return null;
}

/**
 * Tous les manifestes publiés, quel que soit le numéro — parce que la preuve ne
 * dépend pas de la version : un arbre construit pour 1.0.6 reste décrit par le
 * manifeste publié avec 1.0.6, même quand on prépare 1.0.7.
 *
 * @param {{ draft?: boolean, assets?: { name?: string, digest?: string|null }[] }[]} releases releases publiés
 * @returns {{ name: string, digest: string, version: string }[]}
 */
export function publishedManifests(releases = []) {
  const found = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft === true) continue;
    for (const asset of release.assets ?? []) {
      const name = String(asset?.name ?? '');
      if (!isManifestAsset(name)) continue;
      const digest = String(asset?.digest ?? '');
      // Le NUMÉRO du manifeste, lu dans son nom : il dit à quelle version du
      // produit cette arborescence appartenait, donc si la preuve décrit la
      // sortie de build d'aujourd'hui ou celle d'un build antérieur.
      const version = String(name.slice(0, -MANIFEST_SUFFIX.length)).replace(/^.*?-(\d+\.\d+\.\d+)$/, '$1');
      found.push({ name, digest, version });
    }
  }
  return found;
}
