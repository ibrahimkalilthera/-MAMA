// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-prune.mjs — le sort des octets locaux de `release/`.
//
// `release/` est un atelier, pas un entrepôt : chaque build y ajoute un
// installeur, un portable et un blockmap, et rien ne les enlève. Mesuré le
// 13/09 : sept versions, 2,2 Go, vingt et un fichiers au même niveau — dont
// quatorze installeurs. C'est exactement là qu'on reprend le mauvais fichier à
// la main — le contrôle local
// les NOMME (un avertissement dans `check:release`), il ne les enlève pas, et un
// avertissement qu'on lit tous les jours ne se lit plus.
//
// La règle de suppression ne peut pas être « c'est vieux » : une version
// ancienne peut n'avoir JAMAIS été publiée, et sa copie locale est alors la
// seule au monde. Une suppression doit donc être une PREUVE, pas une intuition :
// un artefact local ne disparaît que si le canal déclare un actif du MÊME NOM,
// de la MÊME TAILLE et de la MÊME EMPREINTE — le digest que GitHub calcule sur
// les octets qu'il sert. C'est gratuit (métadonnées seules, aucun octet
// téléchargé) et ça se vérifie.
//
// Quatre refus qui comptent, et chacun protège d'une perte réelle :
//   • un BROUILLON ne peut rien autoriser — il est invisible pour un poste, donc
//     il ne « détient » pas les octets à l'endroit où un poste les lit ;
//   • une version ABSENTE du canal garde sa copie : c'est peut-être l'unique,
//     et ce cas cache DEUX situations opposées — un build d'une ancienne version
//     jamais livrée (mort : le publier ferait descendre la tête, ce que le
//     contrôle refuse) et un build qui ATTEND sa publication (l'unique
//     exemplaire d'une version encore livrable). Les confondre serait
//     dangereux, donc `unpublished` ne peut enlever que le premier ;
//   • une empreinte ABSENTE ne vaut pas une empreinte qui correspond — une
//     taille seule n'identifie pas des octets ;
//   • une empreinte qui DIFFÈRE n'est pas une suppression mais un ROUGE : des
//     octets locaux sous un numéro publié qui ne sont pas ceux du canal, c'est
//     précisément le piège « un même numéro ne se voit pas changer ».
//
// Le module est pur : les faits (noms, tailles, empreintes locales, état du
// canal) arrivent en paramètres, et la décision se teste sans disque ni réseau.
// La partie qui lit le dossier et interroge l'API vit dans
// scripts/prune-release-dir.mjs.
// ─────────────────────────────────────────────────────────────────────────────

// Le comparateur de versions vient du module du canal : un `1.0.10 > 1.0.9`
// chiffré n'existe qu'une fois dans ce dépôt, et « strictement plus basse que »
// ne se décide pas sur des chaînes.
import { compareVersions, versionParts } from './release-version.mjs';
// Le suffixe d'un manifeste d'arborescence vient de son PROPRIÉTAIRE : deux
// définitions de « comment se nomme un manifeste publié » finiraient par en
// désigner deux, et la preuve qui repose dessus ne mordrait plus.
import { MANIFEST_SUFFIX, isManifestAsset } from './unpacked-manifest.mjs';

/**
 * Les noms qui portent un numéro de version, écrits une fois.
 *
 * Trois formes d'artefact (`setup.exe` et son `.blockmap`, `portable.exe`) et le
 * manifeste d'arborescence : ce dernier porte son numéro exactement pareil, donc
 * il entre dans la MÊME preuve qu'un installeur — un manifeste publié dont les
 * octets sont ceux du disque local est redondant au même titre, et il est
 * minuscule, donc l'ignorer n'aurait rien protégé.
 */
const MANIFEST_TAIL = MANIFEST_SUFFIX.replace(/^-/, '').replace(/\./g, '\\.');
const ARTIFACT_VERSION = new RegExp(
  `-(\\d+\\.\\d+\\.\\d+)-(?:(?:setup|portable)\\.exe(?:\\.blockmap)?|${MANIFEST_TAIL})$`,
  'i',
);

/**
 * La version qu'un nom d'artefact porte, ou `null`.
 *
 * Le nom est la seule source : `latest.yml` ne décrit que le fichier de tête,
 * donc un portable et un blockmap n'y sont pas — les ignorer laisserait dans le
 * dossier exactement les octets les plus lourds. Le manifeste d'arborescence n'y
 * est pas non plus (aucun poste ne le lit), et c'est pour ça qu'il est reconnu
 * ici plutôt que dans une liste écrite ailleurs. `ARTIFACT_VERSION` ci-dessus est
 * l'unique définition de ces formes.
 *
 * @param {unknown} name
 * @returns {string|null}
 */
export function artifactVersion(name) {
  const match = ARTIFACT_VERSION.exec(String(name ?? ''));
  return match ? match[1] : null;
}

/**
 * Ce qui peut disparaître du dossier, et ce qui doit y rester.
 *
 * `unpublished` traite la seule catégorie sur laquelle le canal ne peut RIEN
 * prouver : une version qu'il n'a jamais eue. Aucune empreinte ne peut donc
 * autoriser quoi que ce soit, et la décision appartient à un humain — c'est
 * exactement ce que le drapeau reconnaît. Mais il la contraint à ce qui est
 * mort, par deux comparaisons chiffrées : un artefact ne part que s'il est
 * STRICTEMENT PLUS BAS que la version en préparation (ce n'est donc pas le
 * build qu'on s'apprête à livrer) ET strictement plus bas que tout ce que le
 * canal détient (le publier ferait donc DESCENDRE la tête — ce que le contrôle
 * du canal refuse, parce que ça coupe les postes installés au-dessus). Un build
 * publié était-il supérieur : il ne peut plus atteindre personne. Un build au
 * moins aussi haut que ce qu'on prépare, au contraire, ne peut être enlevé par
 * AUCUN drapeau : c'est peut-être celui qui attend sa publication, et sa copie
 * locale en est l'unique exemplaire. Une version illisible n'est jamais « plus
 * basse » : on ne devine pas un ordre à partir d'une chaîne libre.
 *
 * Chaque départ porte son `kind` — `digest` (le canal déclare ces octets), `stale`
 * (un numéro déjà publié), `unpublished` (une version qu'il n'a jamais eue) —
 * parce que trois autorisations différentes ne se résument pas d'une phrase, et
 * qu'un plan qui les confondrait dans son titre mentirait sur au moins une.
 *
 * `stale` traite la seule catégorie qu'une empreinte ne peut pas autoriser : un
 * artefact local qui porte un numéro DÉJÀ publié avec d'autres octets. Il ne
 * peut plus être livré (une republication n'atteint aucun poste, et le refus
 * d'avant-publication le dit), donc il n'est pas « peut-être l'unique copie » —
 * mais sa suppression ne s'autorise pas par empreinte, elle s'autorise par le
 * fait que le numéro est pris. Deux justifications différentes, donc deux actes
 * différents : par défaut il est CONSERVÉ et signalé (c'est aussi l'alarme d'un
 * canal qui servirait les mauvais octets), et `stale` est le geste qui dit « oui,
 * ce sont des reconstructions locales, enlevez-les ».
 *
 * @param {{ currentVersion?: string,
 *   local?: { name: string, size?: number, sha256?: string|null }[],
 *   dirs?: { name: string, size?: number }[],
 *   published?: { version?: string, tag?: string, draft?: boolean,
 *     assets?: { name?: string, size?: number, digest?: string|null }[] }[],
 *   stale?: boolean, unpublished?: boolean, unpacked?: boolean,
 *   provenDirs?: string[] }} input
 *
 *   `provenDirs` = les arborescences de build qu'une PREUVE condamne : un
 *   manifeste publié porte l'empreinte de leur description, donc le canal sert
 *   déjà ces octets, fichier par fichier. C'est la même famille qu'un digest de
 *   fichier (`kind: 'digest'`), et ça part sur le même acte — la preuve est
 *   calculée par l'appelant, qui seul lit le disque et le canal.
 * @returns {{ remove: { name: string, version: string, kind: 'digest'|'stale'|'unpublished', reason: string }[],
 *   keep: { name: string, version?: string, reason: string }[],
 *   ignored: { name: string, reason: string }[],
 *   divergences: { name: string, version: string, reason: string }[],
 *   unpublishedCandidates: { name: string, version: string }[],
 *   loose: { name: string, size: number, kind: 'unpacked'|'dir', reason: string }[],
 *   bytesFreed: number }}
 */
export function prunePlan({
  currentVersion = '',
  local = [],
  dirs = [],
  published = [],
  stale = false,
  unpublished = false,
  unpacked = false,
  provenDirs = [],
} = {}) {
  const remove = [];
  const keep = [];
  const ignored = [];
  const divergences = [];
  const unpublishedCandidates = [];
  const loose = [];
  let bytesFreed = 0;

  // Le canal, indexé par version — et seuls les releases PUBLIÉS y entrent. Un
  // brouillon n'est lu par aucun poste : il ne prouve rien sur ce qu'un poste
  // recevra, donc il ne peut pas autoriser une suppression.
  const channel = new Map();
  for (const release of published) {
    if (!release || release.draft === true) continue;
    const version = String(release.version ?? '').trim();
    if (version && !channel.has(version)) channel.set(version, release);
  }
  // La plus haute version que le canal détient : c'est elle qui rend un build
  // jamais publié définitivement mort (le publier ferait descendre la tête).
  let highestPublished = null;
  for (const version of channel.keys()) {
    if (!versionParts(version)) continue;
    if (highestPublished === null || compareVersions(version, highestPublished) === 1) highestPublished = version;
  }

  // ── Les DOSSIERS ────────────────────────────────────────────────────────
  // Mesuré le 13/09 sur le dossier réel : ils pesaient 508 Mo sur 754 Mo, et
  // le plan n'en disait pas un mot — les fichiers sont entrés ici, donc le
  // volume le plus gros était muet. « L'atelier devient compréhensible » veut
  // dire que ce qui reste a un nom, une taille et une raison, y compris ce qui
  // ne part pas.
  //
  // Le seul DOSSIER qu'un acte peut enlever est celui d'electron-builder : sa
  // convention de nom (`win-unpacked`, `linux-unpacked`) est la signature d'une
  // sortie de build décompressée, régénérable par `electron:dist`. Les autres
  // (ressources de build comme `.icon-ico`) sont des ENTRÉES : elles restent, et
  // le plan le dit au lieu de laisser croire qu'elles sont du déchet.
  // Ce qu'une PREUVE condamne, parmi les dossiers : un manifeste publié dont
  // l'empreinte est celle du manifeste recomposé ici décrit exactement cette
  // arborescence — donc le canal détient déjà ces octets, fichier par fichier.
  // C'est la même famille qu'un digest de fichier, et ça se traite pareil :
  // l'atelier l'OBJECTE, l'acte reste `--yes`.
  const proven = new Set((Array.isArray(provenDirs) ? provenDirs : []).map((name) => String(name)));
  for (const dir of dirs) {
    const name = String(dir?.name ?? '');
    const size = Number(dir?.size) || 0;
    if (!/-unpacked$/.test(name)) {
      loose.push({
        name,
        size,
        kind: 'dir',
        reason:
          'dossier de build (non versionné) — hors du sort de ce contrôle, mais nommé pour que le volume restant s’explique',
      });
      continue;
    }
    if (proven.has(name)) {
      remove.push({
        name,
        version: '',
        kind: 'digest',
        reason:
          'le canal PUBLIE un manifeste dont l’empreinte est celle de cette arborescence — chaque fichier, sa taille et son sha256 : ces octets-là sont déjà servis, et `electron:dist` la régénère',
      });
      bytesFreed += size;
      continue;
    }
    loose.push({
      name,
      size,
      kind: 'unpacked',
      reason:
        'sortie de build DÉCOMPRESSÉE (convention electron-builder) — elle n’est ni versionnée ni livrable, et `electron:dist` la régénère',
    });
    if (unpacked) {
      remove.push({
        name,
        version: '',
        kind: 'unpacked',
        reason:
          'sortie de build décompressée, régénérable par `electron:dist` — la retirer ne change RIEN pour un poste ; les preuves locales qui lancent son exe (preuve bureau, rejeu de mise à jour) demanderont un rebuild',
      });
      bytesFreed += size;
    }
  }

  for (const file of local) {
    const name = String(file?.name ?? '');
    const version = artifactVersion(name);
    if (!version) {
      ignored.push({
        name,
        reason:
          'ne porte pas de numéro de version — hors du sort de ce contrôle (flux, dossier de build, artefacts de configuration)',
      });
      continue;
    }

    // La sortie du build courant reste, même quand le canal la détient déjà :
    // c'est elle que les contrôles locaux lisent (`check:release`, la preuve
    // bureau, le rejeu de mise à jour). C'est aussi la seule entrée qui n'a pas
    // besoin d'empreinte, donc le CLI ne hache pas ces octets.
    if (version === String(currentVersion)) {
      keep.push({
        name,
        version,
        // Un manifeste n'est pas la sortie du build : il la DÉCRIT. Gardé pour la
        // même raison (il porte le numéro en cours), mais avec une raison
        // exacte — une conservation qui explique mal pourquoi est une
        // conservation qu'on ne saura pas relire demain.
        reason: isManifestAsset(name)
          ? 'manifeste du build en cours — écrit par `electron:build` et téléversé avec le lot'
          : 'version en cours de construction — c’est la sortie du build, et les contrôles locaux la lisent',
      });
      continue;
    }

    const release = channel.get(version);
    if (!release) {
      // Le canal n'a jamais eu cette version, donc aucune empreinte ne peut rien
      // autoriser. Mais « jamais publiée » recouvre deux situations opposées, et
      // les confondre serait dangereux.
      const belowCurrent = below(version, currentVersion);
      const belowHead = below(version, highestPublished);
      const deadWeight = belowCurrent && belowHead;
      if (deadWeight) unpublishedCandidates.push({ name, version });
      if (deadWeight && unpublished) {
        remove.push({
          name,
          version,
          kind: 'unpublished',
          reason:
            `jamais publiée, plus basse que la version en préparation (${currentVersion}) et que tout ce que le canal ` +
            `détient (${highestPublished}) — la publier ferait DESCENDRE la tête, ce que le contrôle du canal refuse, ` +
            'donc ces octets ne peuvent atteindre aucun poste',
        });
        bytesFreed += Number(file.size) || 0;
        continue;
      }
      keep.push({
        name,
        version,
        reason: deadWeight
          ? `jamais publiée, plus basse que la version en préparation (${currentVersion}) et que tout ce que le canal détient (${highestPublished}) : morte, mais aucune empreinte ne peut le prouver — un acte humain explicite (--unpublished) est requis`
          : belowCurrent
            ? 'jamais publiée et plus basse que la version en préparation, mais le canal ne détient RIEN de comparable : impossible d’établir qu’elle est morte, donc sa copie locale reste — elle peut être l’unique exemplaire'
            : 'jamais publiée, et au moins aussi haute que la version en préparation — c’est peut-être le build qui attend sa publication, et sa copie locale en est l’unique exemplaire : aucun drapeau ne peut autoriser sa suppression',
      });
      continue;
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (assets.length === 0) {
      keep.push({
        name,
        version,
        reason: `les actifs du release ${version} sont illisibles — on ne supprime pas sur un doute`,
      });
      continue;
    }

    const asset = assets.find((a) => String(a?.name ?? '') === name);
    if (!asset) {
      keep.push({ name, version, reason: `le release ${version} ne déclare pas « ${name} »` });
      continue;
    }

    const digest = String(asset.digest ?? '');
    if (!digest) {
      keep.push({
        name,
        version,
        reason: `le canal ne donne pas d’empreinte pour « ${name} » — une taille seule n’identifie pas des octets`,
      });
      continue;
    }

    const sameSize = Number(asset.size) === Number(file.size);
    const sameDigest = digest === `sha256:${String(file.sha256 ?? '')}`;
    if (!sameSize || !sameDigest) {
      const mismatch =
        `le canal dit d’AUTRES octets pour « ${name} » (taille ${asset.size} vs ${file.size}, ` +
        `empreinte ${digest.slice('sha256:'.length, 'sha256:'.length + 12)}… vs ${String(file.sha256 ?? '').slice(0, 12)}…)`;
      if (stale) {
        remove.push({
          name,
          version,
          kind: 'stale',
          reason:
            `${mismatch} et le canal sert DÉJÀ ${version} — ces octets-ci ne peuvent plus être livrés sous ce numéro ` +
            '(une republication n’atteint aucun poste)',
        });
        bytesFreed += Number(file.size) || 0;
      } else {
        keep.push({ name, version, reason: `${mismatch} — un même numéro ne se voit pas changer, donc ne republiez pas celui-ci` });
      }
      divergences.push({ name, version, reason: mismatch });
      continue;
    }

    remove.push({
      name,
      version,
      kind: 'digest',
      reason: `le canal déclare ces octets exacts (sha256 ${String(file.sha256).slice(0, 12)}…)`,
    });
    bytesFreed += Number(file.size) || 0;
  }

  return { remove, keep, ignored, divergences, unpublishedCandidates, loose, bytesFreed };
}

/**
 * À chaque octet du dossier son appartenance — et le NOM de ce qui n'en a pas.
 *
 * Le plan nommait déjà `win-unpacked` avec son poids, mais deux volumes lui
 * échappaient : les entrées « hors sujet » étaient listées **sans taille** (un
 * `latest-mac.yml` de trois octets et une archive oubliée de 400 Mo se lisaient
 * pareil), et rien ne disait que la somme des catégories **couvrait** le dossier.
 * Un volume invisible ne se remarque pas : il ne manque nulle part, il manque au
 * total que personne ne fait.
 *
 * D'où une attribution exhaustive : chaque entrée de surface reçoit une
 * catégorie, et ce qui n'en reçoit aucune est **nommé avec son poids** au lieu de
 * disparaître entre deux blocs. Un seul propriétaire par nom (première catégorie
 * qui le revendique) : une entrée peut figurer dans plusieurs LISTES du plan (une
 * divergence est aussi une conservation, un candidat `--unpublished` est aussi
 * une conservation), mais elle n'a qu'un poids, donc une seule case.
 *
 * @param {{ name: string, size?: number }[]} [entries] tout ce que le dossier contient en surface
 * @param {{ label: string, names?: Iterable<string> }[]} [buckets] les catégories, par ordre de priorité
 * @returns {{ total: number, buckets: { label: string, count: number, bytes: number }[],
 *   unattributed: { name: string, size: number }[] }}
 */
export function attributeVolume(entries = [], buckets = []) {
  const owner = new Map();
  for (const bucket of buckets) {
    for (const name of bucket?.names ?? []) {
      if (!owner.has(String(name))) owner.set(String(name), bucket.label);
    }
  }
  const slots = new Map(buckets.map((b) => [b.label, { label: b.label, count: 0, bytes: 0 }]));
  const unattributed = [];
  let total = 0;
  for (const entry of entries) {
    const name = String(entry?.name ?? '');
    const size = Number(entry?.size) || 0;
    total += size;
    const label = owner.get(name);
    const slot = label === undefined ? null : slots.get(label);
    if (!slot) {
      unattributed.push({ name, size });
      continue;
    }
    slot.count += 1;
    slot.bytes += size;
  }
  return { total, buckets: [...slots.values()], unattributed };
}

/**
 * La commande qui agit RÉELLEMENT, sur CE dossier, pour les actes demandés.
 *
 * Deux erreurs ont été payées ici, et la seconde était dangereuse.
 *
 * La première : un rappel figé sur `--yes`, qui n'applique que les départs
 * qu'une EMPREINTE autorise. Sur un plan de reconstructions (`--stale`) ou de
 * builds jamais livrés (`--unpublished`), il redemandait donc la commande qu'on
 * venait de taper — et l'appliquer n'enlevait RIEN. Un plan qu'on croit appliqué
 * ne se relit pas comme un plan vide : il se relit comme un ménage fait.
 *
 * La seconde, mesurée en montrant le plan d'un dossier de sonde : la commande ne
 * portait pas le DOSSIER. Un plan calculé sur `release-probe/` proposait donc
 * d'agir sur `release/` — aidant, et faux, c'est-à-dire la seule façon dont un
 * rappel peut être pire que rien.
 *
 * Le dossier et les actes passent donc par ici, et par ici seulement : un
 * troisième site qui recopierait la ligne rouvrirait les deux erreurs à la fois.
 *
 * Et le dossier est TOUJOURS écrit, y compris celui par défaut. Il a existé une
 * forme courte (`npm run release:prune -- --yes`) qui se taisait sur `release/`,
 * au motif que c'est la ligne que la documentation montre : elle faisait dépendre
 * la correction d'une convention de lecture (« quand il n'y a pas de `--dir`, le
 * dossier est le défaut »), donc le jour où un défaut changerait à un seul
 * endroit, le rappel viserait un dossier sans le nommer. Une ligne longue se lit
 * et se vérifie ; une ligne courte se devine.
 *
 * @param {Iterable<string>} [kinds] les actes présents dans le plan
 *   (`digest` | `stale` | `unpublished` | `unpacked`) — `--yes` est toujours là,
 *   il EST l'acte
 * @param {{ dir?: string }} [options] le dossier visé, TOUJOURS écrit ; vide ou
 *   absent, c'est le défaut du CLI (`DEFAULT_RELEASE_DIR`)
 * @returns {string} la ligne exacte à recopier
 */
/**
 * Le dossier d'atelier par défaut, écrit UNE fois.
 *
 * C'est le défaut du CLI, celui du contrôle de cohérence et celui du publieur, et
 * il est maintenant aussi le dossier qu'un rappel écrit noir sur blanc : trois
 * entrées qui le relisaient chacune de leur côté pouvaient diverger, et le rappel
 * se serait tu sur un dossier qu'il ne vise pas.
 */
export const DEFAULT_RELEASE_DIR = 'release';

export function pruneCommand(kinds = [], { dir = DEFAULT_RELEASE_DIR } = {}) {
  const acts = new Set(kinds);
  const flags = ['--yes'];
  if (acts.has('stale')) flags.push('--stale');
  if (acts.has('unpublished')) flags.push('--unpublished');
  if (acts.has('unpacked')) flags.push('--unpacked');
  const target = String(dir ?? '').trim() || DEFAULT_RELEASE_DIR;
  return `npm run release:prune -- --dir=${target} ${flags.join(' ')}`;
}

/**
 * Ce qu'un plan SANS départ doit dire — et pourquoi il ne peut pas dire autre
 * chose.
 *
 * La phrase précédente, « le dossier ne contient que ce que le canal ne détient
 * pas encore », était fausse sur les deux dossiers réels. Sur `release/`, elle
 * l'affirmait pendant que le bloc suivant nommait la 1.0.6 comme sortie du build —
 * et le canal la détient, c'est sa tête. Sur un dossier vide, elle nommait une
 * raison qui ne peut s'appliquer à rien. Deux lignes du même rapport se
 * contredisaient donc, et la rassurante était la fausse.
 *
 * Les raisons de chaque conservation sont déjà écrites ligne à ligne dans les
 * blocs qui suivent (`⛔ conservés`, `➖ hors sujet`, les candidats nommés) :
 * cette ligne n'a plus qu'à dire ce qu'elle sait, sans plaider.
 *
 * @param {number} fileCount ce que le dossier contient réellement
 * @returns {string}
 */
export function noRemovalMessage(fileCount = 0) {
  return Number(fileCount) === 0
    ? '✅ rien à décider — le dossier est vide.'
    : '✅ rien à supprimer — aucun fichier ne remplit une condition de départ.';
}

/**
 * `a` strictement plus basse que `b`.
 *
 * Une version illisible n'est JAMAIS « plus basse » : `compareVersions` rend
 * `null` quand l'une des deux n'est pas un numéro, et on ne devine pas un ordre à
 * partir d'une chaîne libre. Un `null` (canal sans version lisible, par exemple)
 * se traduit donc par « on ne supprime pas ».
 */
function below(a, b) {
  return compareVersions(a, b) === -1;
}

/** Une taille lisible, pour que le plan se lise sans compter des zéros. */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[unit]}`;
}
