// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/channel-installer.mjs — quel INSTALLEUR le canal sert-il vraiment ?
//
// WHY THIS EXISTS
// ---------------
// Prouver la fiche parent dans un bundle extrait ne prouve pas que les postes
// reçoivent la correction : l'octet qui voyage est l'installeur, et c'est lui
// qu'un administrateur double-clique. Il fallait donc une règle qui réponde, à
// partir de ce que le canal PUBLIE, à une seule question : **quel fichier un
// poste téléchargerait-il, et de quel numéro se réclame-t-il ?**
//
// Ce que le dépôt savait déjà faire : comparer des octets locaux à ceux d'une
// release (`release-compare.mjs`), lire le flux (`latest-yml.mjs`), dire si un
// canal atteint chaque version publiée (`release-reach.mjs`). Ce qui manquait :
// choisir l'installeur dans ce que le canal annonce, et refuser quand ce choix
// est ambigu. C'est ce fichier.
//
// Trois refus, et chacun a une raison mesurable :
//   • pas de flux lisible → il n'y a rien à choisir, et un objet vide se lirait
//     comme « rien à publier » ;
//   • aucune entrée `setup` → le canal ne sert aucun installeur, donc aucun poste
//     ne peut s'installer ;
//   • une entrée annoncée que la release ne porte pas → le flux promet un
//     fichier qui n'est pas téléchargeable, c'est-à-dire le pire des faux verts
//     (une promesse que personne ne vérifie avant qu'un poste ne la suive).
//
// Le module est PUR : il prend le texte du flux, la liste des actifs telle que
// l'API les rend, et le tag. La lecture vit dans `verify-installed-parent-form.mjs`,
// donc chaque branche de refus se prouve sans réseau ni release.
// ─────────────────────────────────────────────────────────────────────────────

import { nameCarriesVersion, parseLatestYml } from './latest-yml.mjs';

/** Un installeur NSIS parmi les entrées du flux (`…-setup.exe`). */
const SETUP = /-setup\.exe$/i;

/**
 * L'entrée du flux qui porte l'INSTALLEUR d'une version.
 *
 * `latest.yml` liste plusieurs fichiers (l'installeur, son `.blockmap`, les
 * archives différentielles). Un poste qui s'installe suit l'installeur : c'est
 * donc lui, et pas « la première entrée », qui doit être prouvé. Une liste qui
 * en porterait deux est un refus, pas un tirage au sort — deux installeurs pour
 * un même numéro est exactement l'ambiguïté qu'un poste ne doit jamais rencontrer.
 *
 * @param {{ files?: { url: string, sha512: string, size: number|null }[] }|null} feed
 * @returns {{ ok: boolean, problems: string[], entry: object|null }}
 */
export function installerEntry(feed) {
  const problems = [];
  const candidates = (feed?.files ?? []).filter((f) => SETUP.test(String(f?.url ?? '')));
  if (!candidates.length) {
    return {
      ok: false,
      entry: null,
      problems: [
        'le flux ne nomme AUCUN installeur (`…-setup.exe`) — un canal sans installeur ne peut pas équiper un poste',
      ],
    };
  }
  if (candidates.length > 1) {
    problems.push(
      `le flux nomme ${candidates.length} installeurs (${candidates.map((c) => c.url).join(', ')}) — ` +
        'un poste n’a pas à choisir, et ce contrôle non plus',
    );
  }
  // La plus récente annoncée gagne quand la liste est ambiguë : le refus est dans
  // `problems`, donc l'appelant ne peut pas s'en servir pour un vert.
  return { ok: problems.length === 0, entry: candidates[0], problems };
}

/**
 * L'article que canal sert pour une version : l'entrée du flux, son URL réelle,
 * et la version dont elle se réclame.
 *
 * @param {{ text?: string|null, assets?: { name: string, url?: string, browser_download_url?: string }[],
 *   tag?: string|null }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[],
 *   installer: { name: string, url: string, size: number|null, sha512: string, version: string }|null }}
 */
export function publishedInstaller({ text = null, assets = [], tag = null } = {}) {
  const problems = [];
  const warnings = [];
  const refuse = (why) => {
    problems.push(why);
    return { ok: false, problems, warnings, installer: null };
  };

  if (!text) {
    return refuse(
      "le flux du release publié n'a pas pu être lu — sans lui, personne ne sait quel fichier les postes téléchargent",
    );
  }
  const feed = parseLatestYml(text);
  if (!feed) {
    return refuse(
      `le flux publié${tag ? ` de ${tag}` : ''} est illisible (aucune version, ou aucun \`path\`) — ` +
        'un flux illisible ne se lit pas comme un flux vide',
    );
  }

  const picked = installerEntry(feed);
  if (!picked.entry) return refuse(picked.problems[0]);
  problems.push(...picked.problems);

  const name = String(picked.entry.url);
  if (!nameCarriesVersion(name, feed.version)) {
    problems.push(
      `l'installeur annoncé « ${name} » ne porte pas le numéro du flux (${feed.version}) — ` +
        'un poste recevrait un binaire qui n’est pas la version qu’on lui annonce',
    );
  }

  // L'URL réelle vient de la RELEASE, pas du flux : un nom sans URL n'est pas un
  // fichier téléchargeable, et le flux d'electron-builder ne porte que des noms.
  const asset = assets.find((a) => String(a?.name ?? '') === name);
  const url = asset?.browser_download_url ?? asset?.url ?? null;
  if (!url) {
    return refuse(
      `le flux annonce « ${name} » mais le release${tag ? ` ${tag}` : ''} ne le porte pas ` +
        `(${assets.length ? assets.map((a) => a.name).join(', ') : 'aucun actif'}) — ` +
        'le canal promet un fichier que personne ne peut télécharger',
    );
  }

  // Le `path` de tête nomme ce que `electron-updater` suit. S'il désigne autre
  // chose que l'installeur, c'est une incohérence de publication — nommée, pas
  // fatale, parce que c'est la LISTE que le poste parcourt.
  if (feed.path && feed.path !== name) {
    warnings.push(
      `le \`path\` de tête du flux nomme « ${feed.path} » alors que l'installeur est « ${name} » — ` +
        'les deux devraient désigner le même fichier',
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    installer: {
      name,
      url,
      size: picked.entry.size,
      sha512: picked.entry.sha512,
      version: feed.version,
    },
  };
}
