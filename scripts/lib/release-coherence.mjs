// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-coherence.mjs — le flux de mise à jour tient-il debout ?
//
// Trois sources doivent dire la MÊME chose pour qu'un poste se mette à jour :
// `package.json` (ce qu'on croit livrer), `latest.yml` (ce que les postes
// lisent) et l'installeur (ce qu'ils téléchargent). Rien ne le vérifiait, et ce
// dépôt a déjà payé l'incohérence trois fois :
//
//   • 1.0.1 publiée alors qu'**aucun release n'existait** : chaque poste
//     interrogeait un flux vide — le mécanisme était vert, le canal muet ;
//   • `electron-builder --publish always` créant **deux brouillons** (une passe
//     par cible), l'un portant `latest.yml`, l'autre le blockmap : un brouillon
//     est invisible pour l'updater, donc rien n'arrivait nulle part ;
//   • un installeur 1.0.1 reconstruit pour une 1.0.2 — un même numéro ne peut pas
//     changer de contenu, donc une republication n'aurait atteint AUCUN poste.
//
// Ce module porte la comparaison, et une règle lui donne son sens : **le flux
// est une promesse sur des octets**. `latest.yml` annonce une taille et un
// sha512 ; `electron-updater` refuse un téléchargement qui n'y répond pas. Donc
// vérifier la cohérence, c'est recalculer ces octets — pas relire les mêmes
// trois fichiers en espérant qu'ils se contredisent.
//
// Il est pur : les faits (contenu du yml, taille et empreinte des fichiers
// présents, état du release distant) arrivent en paramètres. La partie qui lit
// un disque ou un dépôt vit dans le CLI, et la décision se teste sans réseau.
// ─────────────────────────────────────────────────────────────────────────────

/** Le nom du tag d'un release, dérivé de la version — jamais écrit deux fois. */
export const releaseTag = (version) => `v${String(version ?? '').trim()}`;

/**
 * Lire `latest.yml` d'electron-builder (un sous-ensemble YAML fixe).
 *
 * Volontairement étroit : une version, une liste de fichiers (`url`, `sha512`,
 * `size`), un `path` et un `sha512` de tête. Un parseur YAML général avalerait
 * aussi ce qu'on ne veut pas voir ; ici, ce qui n'est pas reconnu est ignoré,
 * et ce qui manque est **dit** par les comparaisons qui suivent.
 *
 * @param {unknown} text
 * @returns {{ version: string, files: { url: string, sha512: string, size: number|null }[],
 *   path: string, sha512: string, releaseDate: string|null } | null} null si illisible
 */
export function parseLatestYml(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const result = { version: '', files: [], path: '', sha512: '', releaseDate: null };
  let inFiles = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const key = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const item = /^\s*-\s*([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const field = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (key && !/^\s/.test(line)) {
      inFiles = key[1] === 'files';
      const value = clean(key[2]);
      if (key[1] === 'version') result.version = value;
      if (key[1] === 'path') result.path = value;
      if (key[1] === 'sha512') result.sha512 = value;
      if (key[1] === 'releaseDate') result.releaseDate = value || null;
      continue;
    }
    if (inFiles && item) {
      // Le premier champ d'un élément n'est pas forcément `url` : le lire comme
      // tel poserait l'URL sur la mauvaise clé, et une entrée sans URL passerait
      // pour une entrée pleine.
      current = { url: '', sha512: '', size: null };
      result.files.push(current);
      assignField(current, item[1], clean(item[2]));
      continue;
    }
    if (inFiles && field && current) {
      assignField(current, field[1], clean(field[2]));
    }
  }
  // Un fichier sans `url` n'est pas un fichier : le garder ferait passer une
  // liste vide pour une liste pleine.
  result.files = result.files.filter((f) => f.url);
  if (!result.version || !result.path) return null;
  return result;
}

/** Retire les guillemets et les espaces d'une valeur YAML. */
function clean(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
}

/** Range un champ d'un élément de `files` — les inconnus sont ignorés. */
function assignField(entry, key, value) {
  if (key === 'url') entry.url = value;
  if (key === 'sha512') entry.sha512 = value;
  if (key === 'size') entry.size = Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * Le nom d'un artefact porte-t-il bien la version annoncée ?
 *
 * C'est la règle qui attrape le piège mesuré : un installeur 1.0.1 resté dans
 * `release/` pendant qu'on publie une 1.0.2 — publié, il enverrait à tous les
 * postes un binaire qui n'est pas la version annoncée.
 */
export const nameCarriesVersion = (name, version) =>
  new RegExp(`-${String(version).replace(/\./g, '\\.')}-`).test(String(name ?? ''));

/**
 * Comparer le flux local, les artefacts du dossier, et la version du paquet.
 *
 * @param {{ latestText: unknown, packageVersion: string,
 *   assets?: Map<string, { size: number, sha512: string }>, dirNames?: string[],
 *   expectBlockmap?: boolean }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], latest: object|null }}
 */
export function compareLatest({
  latestText,
  packageVersion,
  assets = new Map(),
  dirNames = [],
  expectBlockmap = true,
} = {}) {
  const problems = [];
  const warnings = [];
  const latest = parseLatestYml(latestText);
  if (!latest) {
    return {
      ok: false,
      problems: ['latest.yml illisible (version ou `path` absente) — le flux ne peut pas être vérifié'],
      warnings,
      latest: null,
    };
  }
  if (latest.version !== String(packageVersion)) {
    problems.push(
      `version incohérente : latest.yml annonce ${latest.version}, package.json déclare ${packageVersion} — ` +
        'un poste installerait une version que le paquet ne nomme pas',
    );
  }
  // Aucun fichier annoncé ⇒ rien à publier : conclure sur une liste vide serait
  // exactement le vert creux que ce contrôle existe pour empêcher.
  const files = latest.files;
  if (!files.length) problems.push('latest.yml ne liste AUCUN fichier — rien à télécharger');

  for (const file of latest.files) {
    if (!nameCarriesVersion(file.url, latest.version)) {
      problems.push(`artefact mal nommé : « ${file.url} » ne porte pas la version annoncée (${latest.version})`);
    }
    const asset = assets.get(file.url);
    if (!asset) {
      problems.push(`artefact manquant : « ${file.url} » est annoncé par latest.yml mais absent du dossier`);
      continue;
    }
    if (file.size !== null && asset.size !== file.size) {
      problems.push(
        `taille incohérente pour « ${file.url} » : latest.yml annonce ${file.size} octet(s), le fichier en fait ${asset.size}`,
      );
    }
    if (!file.sha512) {
      problems.push(`empreinte absente : « ${file.url} » n'a pas de sha512 dans latest.yml`);
    } else if (asset.sha512 !== file.sha512) {
      problems.push(
        `sha512 incohérent pour « ${file.url} » : latest.yml annonce ${file.sha512.slice(0, 16)}…, les octets font ${asset.sha512.slice(0, 16)}…`,
      );
    }
  }

  const pathFile = latest.files.find((f) => f.url === latest.path);
  if (!pathFile) {
    problems.push(`« ${latest.path} » (le fichier que le poste télécharge, champ \`path\`) n'est pas dans \`files\``);
  } else if (latest.sha512 && pathFile.sha512 && latest.sha512 !== pathFile.sha512) {
    problems.push('les deux empreintes de latest.yml (celle de tête et celle du fichier) ne concordent pas');
  }
  if (expectBlockmap && latest.path && !dirNames.includes(`${latest.path}.blockmap`)) {
    problems.push(
      `blockmap manquant : « ${latest.path}.blockmap » est absent — le poste retéléchargerait tout à chaque mise à jour`,
    );
  }

  // Les autres versions présentes dans le dossier ne sont PAS une erreur (le
  // dossier accumule) — mais c'est exactement là qu'on prend le mauvais fichier,
  // donc elles sont nommées au lieu d'être tues.
  const leftovers = dirNames.filter(
    (name) => /\.exe$/i.test(name) && !nameCarriesVersion(name, latest.version),
  );
  if (leftovers.length) {
    warnings.push(
      `${leftovers.length} installeur(s) d'une AUTRE version traînent dans release/ (${leftovers.join(', ')}) — ` +
        'ils ne sont pas annoncés par latest.yml, donc ne les publiez pas',
    );
  }
  return { ok: problems.length === 0, problems, warnings, latest };
}

/**
 * Le release distant (brouillon ou publié) dit-il la même chose que le local ?
 *
 * `mode: 'draft'` = le brouillon qu'on s'apprête à rendre visible ; `mode:
 * 'live'` = ce que les postes lisent réellement. Les deux règles qui importent :
 * un brouillon **ne doit pas** être lu par les postes (donc pas de promotion
 * avant vérification), et un release publié **doit** l'être (donc pas de
 * brouillon oublié, l'autre façon de ne rien livrer).
 *
 * @param {{ mode?: 'draft'|'live', version: string, expected?: string[], localLatestText?: string|null,
 *   remote: { count?: number, isDraft?: boolean, tag?: string,
 *     assets?: { name: string, size?: number }[], latestText?: string|null,
 *     installer?: { name: string, size: number, sha512: string }|null,
 *     announced?: { version?: string, path?: string, sha512?: string }|null }|null }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
export function compareRelease({ mode = 'live', version, expected = [], remote = null, localLatestText = null } = {}) {
  const problems = [];
  const warnings = [];
  const tag = releaseTag(version);
  if (!remote || !remote.count) {
    return {
      ok: false,
      problems: [`aucun release « ${tag} » : le canal est muet, aucun poste ne verra cette version`],
      warnings,
    };
  }
  if (remote.count > 1) {
    problems.push(
      `${remote.count} releases portent le tag « ${tag} » — ` +
        'les artefacts sont répartis entre eux, et aucun outil ne les rassemble : c\'est le brouillon en deux morceaux déjà mesuré',
    );
  }
  if (remote.tag && remote.tag !== tag) {
    problems.push(`tag incohérent : « ${remote.tag} » ne correspond pas à la version ${version}`);
  }
  if (mode === 'draft' && remote.isDraft === false) {
    problems.push(`« ${tag} » est DÉJÀ publié : des postes peuvent le lire, la vérification arrive trop tard`);
  }
  if (mode === 'live' && remote.isDraft === true) {
    problems.push(`« ${tag} » est un BROUILLON : aucun poste ne le voit (c'est un flux vide, pas une mise à jour)`);
  }

  const names = (remote.assets || []).map((a) => a.name);
  for (const want of expected) {
    if (!names.includes(want)) problems.push(`artefact manquant dans le release « ${tag} » : ${want}`);
  }
  // Un installeur d'une autre version dans le release n'est jamais un détail :
  // c'est le fichier qu'un humain téléchargera à la main.
  const foreign = names.filter((n) => /\.exe$/i.test(n) && !nameCarriesVersion(n, version));
  if (foreign.length) {
    problems.push(`release « ${tag} » contient des installeurs d'une autre version : ${foreign.join(', ')}`);
  }

  if (remote.announced && remote.announced.version && remote.announced.version !== String(version)) {
    problems.push(
      `le latest.yml PUBLIÉ annonce ${remote.announced.version} alors que le paquet est en ${version}`,
    );
  }
  if (remote.latestText === null || remote.latestText === undefined) {
    problems.push(`latest.yml absent du release « ${tag} » — un poste sans ce fichier ne voit rien`);
  } else if (mode === 'draft' && localLatestText !== null && remote.latestText !== localLatestText) {
    // Le geste qui rend visible ne doit publier QUE ce qui a été vérifié : un
    // brouillon dont le flux diffère du local (reprise d'une tentative
    // précédente, fichier retouché) ferait entrer en service autre chose que ce
    // qui vient d'être mesuré.
    problems.push(
      'le latest.yml du brouillon n’est pas celui du dossier local (octet pour octet) — ' +
        'ce qui serait rendu visible n’est pas ce qui vient d’être vérifié',
    );
  }
  if (remote.installer && remote.announced && remote.announced.sha512) {
    if (remote.installer.sha512 !== remote.announced.sha512) {
      problems.push(
        `les octets PUBLIÉS ne sont pas ceux annoncés : « ${remote.installer.name} » a pour sha512 ` +
          `${remote.installer.sha512.slice(0, 16)}…, latest.yml promet ${remote.announced.sha512.slice(0, 16)}…`,
      );
    }
  } else if (remote.announced && remote.announced.sha512) {
    problems.push(
      `« ${remote.announced.path} » annoncé par le latest.yml publié est introuvable parmi les artefacts ` +
        '— impossible de prouver que les octets servis sont ceux promis',
    );
  }
  return { ok: problems.length === 0, problems, warnings };
}

/**
 * Les fichiers qui DOIVENT être dans le release, dans l'ordre d'upload.
 *
 * Tout ce qui est annoncé par `latest.yml` (donc ce que les postes lisent), son
 * blockmap, le `latest.yml` lui-même — et le portable, qui n'est pas dans le flux
 * mais que les postes sans droits d'installation téléchargent à la main.
 *
 * @param {{ latest: { files: { url: string }[], path: string }|null, dirNames?: string[] }} input
 * @returns {string[]}
 */
export function assetsToPublish({ latest, dirNames = [] } = {}) {
  if (!latest) return [];
  const wanted = [];
  const push = (name) => {
    if (name && dirNames.includes(name) && !wanted.includes(name)) wanted.push(name);
  };
  // `latest.yml` d'abord : sans lui, un poste ne voit rien du tout.
  push('latest.yml');
  push(latest.path);
  push(`${latest.path}.blockmap`);
  for (const file of latest.files) {
    push(file.url);
    push(`${file.url}.blockmap`);
  }
  for (const name of dirNames) {
    // Le portable ne figure pas dans `latest.yml` (il ne s'auto-installe pas),
    // mais un poste sans droits d'installation le télécharge à la main : il est
    // donc publié, et seulement s'il porte bien la version annoncée.
    if (/-portable\.exe$/i.test(name) && nameCarriesVersion(name, latest.version)) push(name);
  }
  return wanted;
}

/**
 * Peut-on publier cette version ?
 *
 * Les deux refus qui comptent : un tag qui existe déjà (un même numéro ne peut
 * pas changer de contenu — republier n'atteindrait AUCUN poste, et laisserait
 * deux binaires sous le même numéro), et un flux incohérent (un poste
 * téléchargerait autre chose que ce qui est annoncé).
 *
 * @param {{ version: string, existingTag?: boolean, latestOk?: boolean,
 *   problems?: string[] }} input
 * @returns {{ publish: boolean, reason: string }}
 */
export function publishDecision({ version, existingTag = false, latestOk = true, problems = [] } = {}) {
  if (existingTag) {
    return {
      publish: false,
      reason:
        `le tag ${releaseTag(version)} existe déjà — un même numéro ne peut pas changer de contenu : ` +
        'aucun poste ne verrait la différence. Montez la version.',
    };
  }
  if (!latestOk) {
    return { publish: false, reason: `flux incohérent — ${problems[0] || 'voir le détail ci-dessus'}` };
  }
  return { publish: true, reason: 'flux cohérent et version inédite' };
}
