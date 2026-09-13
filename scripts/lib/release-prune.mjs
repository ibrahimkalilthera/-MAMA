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
import { compareVersions, versionParts } from './release-coherence.mjs';

/**
 * La version qu'un nom d'artefact porte, ou `null`.
 *
 * Le nom est la seule source : `latest.yml` ne décrit que le fichier de tête,
 * donc un portable et un blockmap n'y sont pas — les ignorer laisserait dans le
 * dossier exactement les octets les plus lourds.
 *
 * @param {unknown} name
 * @returns {string|null}
 */
export function artifactVersion(name) {
  const match = /-(\d+\.\d+\.\d+)-(?:setup|portable)\.exe(?:\.blockmap)?$/i.exec(String(name ?? ''));
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
 *   published?: { version?: string, tag?: string, draft?: boolean,
 *     assets?: { name?: string, size?: number, digest?: string|null }[] }[],
 *   stale?: boolean, unpublished?: boolean }} input
 * @returns {{ remove: { name: string, version: string, kind: 'digest'|'stale'|'unpublished', reason: string }[],
 *   keep: { name: string, version?: string, reason: string }[],
 *   ignored: { name: string, reason: string }[],
 *   divergences: { name: string, version: string, reason: string }[],
 *   unpublishedCandidates: { name: string, version: string }[],
 *   bytesFreed: number }}
 */
export function prunePlan({ currentVersion = '', local = [], published = [], stale = false, unpublished = false } = {}) {
  const remove = [];
  const keep = [];
  const ignored = [];
  const divergences = [];
  const unpublishedCandidates = [];
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
        reason: 'version en cours de construction — c’est la sortie du build, et les contrôles locaux la lisent',
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

  return { remove, keep, ignored, divergences, unpublishedCandidates, bytesFreed };
}

/**
 * La commande qui applique RÉELLEMENT ce plan.
 *
 * Un rappel qui dit « relance avec --yes » s'est déjà trompé ici, et de la pire
 * façon : en silence. `--yes` seul n'applique que les départs qu'une EMPREINTE
 * autorise ; sur un plan de reconstructions (`--stale`) ou de builds jamais
 * livrés (`--unpublished`), il redemandait donc exactement la commande qu'on
 * venait de taper — et l'appliquer n'enlevait RIEN. Un plan qu'on croit appliqué
 * et qui n'a rien fait ne se relit pas comme un plan vide : il se relit comme un
 * ménage fait. Les drapeaux sont donc DÉDUITS des catégories présentes, jamais
 * écrits d'avance.
 *
 * @param {{ remove?: { kind?: string }[] }} plan
 * @returns {string} la ligne exacte à recopier, `--yes` compris
 */
export function pruneCommand({ remove = [] } = {}) {
  const kinds = new Set(remove.map((item) => item?.kind));
  const flags = ['--yes'];
  if (kinds.has('stale')) flags.push('--stale');
  if (kinds.has('unpublished')) flags.push('--unpublished');
  return `npm run release:prune -- ${flags.join(' ')}`;
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
