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
// Et parce que ces trois cas se réparent DIFFÉREMMENT, le module porte aussi le
// verdict du CANAL tel qu'un poste le voit : quel release est le plus récent
// parmi ceux qui sont publiés (`pickLatestPublished` — un brouillon est
// invisible, donc « le plus récent » n'est pas « le plus récent tag »), et le
// frein d'urgence est-il LISIBLE (`parseHoldsFile`) — un frein illisible ne
// freine rien, en silence.
//
// Il est pur : les faits (contenu du yml, taille et empreinte des fichiers
// présents, état du release distant, texte du frein) arrivent en paramètres. La
// partie qui lit un disque, un dépôt ou une URL vit dans le CLI, et la décision
// se teste sans réseau.
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
 *     latestMissing?: boolean, latestStatuses?: { via: string, status: number }[]|null,
 *     installer?: { name: string, size: number, sha512: string }|null,
 *     installerMissing?: boolean, installerStatuses?: { via: string, status: number }[]|null,
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
    // RÉELLEMENT absent, ou présent mais ILLISIBLE ? Les deux pannes se
    // réparent différemment, et les confondre fait accuser le canal d'un défaut
    // de lecture — ce qui a été mesuré : « latest.yml absent du release v1.0.6 »
    // alors qu'il était là, sur un runner anonyme bloqué par le quota de l'API.
    problems.push(
      remote.latestMissing === false
        ? `latest.yml du release « ${tag} » n’a pas pu être LU (${describeRead(remote.latestStatuses)}) — ` +
          'le canal n’est pas jugé tant que la lecture échoue, et une lecture ratée n’est pas un fichier absent'
        : `latest.yml absent du release « ${tag} » — un poste sans ce fichier ne voit rien`,
    );
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
      remote.installerMissing === false
        ? `« ${remote.announced.path} » est bien dans le release, mais ses octets n’ont pas pu être LUS ` +
          `(${describeRead(remote.installerStatuses)}) — la promesse est là et le fichier aussi, seul le téléchargement a échoué`
        : `« ${remote.announced.path} » annoncé par le latest.yml publié est introuvable parmi les artefacts ` +
          '— impossible de prouver que les octets servis sont ceux promis',
    );
  }
  return { ok: problems.length === 0, problems, warnings };
}

/**
 * Pourquoi une lecture d'actif a échoué — par voie, avec le statut de chacune.
 *
 * Un échec qui ne dit pas ce qu'il a reçu oblige à deviner, et deviner a déjà
 * coûté : « latest.yml absent » était une lecture bloquée, pas un fichier
 * manquant. Le statut est donc publié dans le verdict, pas jeté.
 *
 * @param {{ via: string, status: number }[]|null} statuses
 * @returns {string}
 */
function describeRead(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return 'aucune tentative de lecture n’a abouti';
  return statuses
    .map((s) => `${s.via === 'api' ? 'endpoint d’actif de l’API' : 'voie du poste'} HTTP ${s.status}`)
    .join(', ');
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
 * L'ensemble EXACT d'artefacts que le release doit porter à la fin.
 *
 * `assetsToPublish` répond à « qu'est-ce que CE DISQUE peut fournir ? ». Ce
 * n'est pas la même question que « qu'est-ce que le release doit contenir ? »,
 * et confondre les deux a une conséquence mesurable : l'ensemble publié devient
 * une propriété de ce qui traîne dans `release/`. Sur une machine dont le
 * dossier a été nettoyé — ou sur une reprise faite ailleurs — un artefact
 * qu'un brouillon porte DÉJÀ sort alors de l'ensemble attendu, et la
 * consolidation le supprime avec son brouillon : le blockmap disparaît sans que
 * rien ne rougisse, et chaque poste retélécharge l'installeur entier à chaque
 * mise à jour.
 *
 * D'où cet élargissement, et il est volontairement ÉTROIT : n'y entrent que les
 * noms qui appartiennent au flux de CETTE version — `latest.yml`, le `path`
 * annoncé et son blockmap, les fichiers listés et leurs blockmaps, et un
 * portable qui porte bien la version. Le reste d'un brouillon est un état à
 * réparer, pas une source : il n'entre pas dans l'ensemble attendu.
 *
 * Tout nom ainsi attendu qui n'est pas sur le disque sera RÉUNI depuis le
 * brouillon qui le porte (voir `publicationPlan`) — donc jamais perdu, et jamais
 * téléversé deux fois.
 *
 * @param {{ latest?: { version?: string, path?: string,
 *   files?: { url?: string }[] }|null, dirNames?: string[],
 *   releases?: { assets?: { name?: string }[] }[] }} [input]
 * @returns {string[]}
 */
export function expectedArtifacts({ latest = null, dirNames = [], releases = [] } = {}) {
  const names = [];
  const add = (name) => {
    if (name && !names.includes(name)) names.push(name);
  };
  for (const name of assetsToPublish({ latest, dirNames })) add(name);
  if (!latest) return names;

  // Les noms qui appartiennent au flux de cette version, indépendamment de ce
  // que ce disque possède : c'est ce qui rend l'ensemble indépendant du dossier.
  const flux = new Set(['latest.yml']);
  if (latest.path) {
    flux.add(latest.path);
    flux.add(`${latest.path}.blockmap`);
  }
  for (const file of latest.files ?? []) {
    if (!file?.url) continue;
    flux.add(file.url);
    flux.add(`${file.url}.blockmap`);
  }

  for (const release of Array.isArray(releases) ? releases : []) {
    for (const asset of release?.assets ?? []) {
      const name = asset?.name;
      if (!name) continue;
      if (flux.has(name)) add(name);
      // Le portable n'est pas dans `latest.yml` (il ne s'auto-installe pas),
      // donc c'est la version portée par son nom qui dit qu'il est du lot.
      else if (/-portable\.exe$/i.test(name) && nameCarriesVersion(name, latest.version)) add(name);
    }
  }
  return names;
}

/**
 * Ce qu'on a besoin de savoir d'un release pour décider lequel les postes voient.
 * @typedef {{ tag_name?: string, draft?: boolean, prerelease?: boolean,
 *   published_at?: string, created_at?: string }} ReleaseLike
 */

/**
 * Le release le plus récent que les POSTES peuvent réellement voir.
 *
 * « Le plus récent » n'est pas « le plus récent tag » : un brouillon est
 * INVISIBLE pour `electron-updater`, donc un brouillon plus récent qu'un release
 * publié ne change rien pour un poste — c'est même le cas normal d'une
 * publication en cours. Le tri porte donc sur les releases PUBLIÉS, et sur la
 * date de publication (celle que le poste voit), pas sur l'ordre de l'API.
 *
 * Et une PRÉ-VERSION n'est pas « publiée » au sens où un poste la lit : c'est
 * l'endpoint que l'updater interroge qui la met hors du canal stable
 * (`/releases/latest` ignore `prerelease`, comme le client lui-même). La garder
 * faisait donc désigner à NOTRE tri une version qu'aucun poste ne verra jamais.
 * Mesuré le 2026-09-13 avec une pré-version de sonde : la ligne de divergence
 * reprochait à l'endpoint du poste un désaccord qui venait d'ici — c'est-à-dire
 * qu'elle accusait le canal d'une imprécision qui était la nôtre, et un tri qui
 * désigne ce que personne ne peut voir ne juge plus ce que les postes lisent.
 *
 * @param {ReleaseLike[]} [releases]
 * @returns {ReleaseLike|null} null si aucun release n'est publié — le canal est muet
 */
export function pickLatestPublished(releases = []) {
  const list = (Array.isArray(releases) ? releases : []).filter(
    (r) => r && r.draft !== true && r.prerelease !== true && typeof r.tag_name === 'string' && r.tag_name,
  );
  if (!list.length) return null;
  const when = (r) => {
    const ms = Date.parse(String(r.published_at || r.created_at || ''));
    return Number.isFinite(ms) ? ms : 0;
  };
  return list.slice().sort((a, b) => when(b) - when(a))[0];
}

/**
 * « v1.0.5 » → [1, 0, 5]. Un tag qui n'est pas un numéro n'a pas de rang, donc
 * pas de comparaison : on ne devine pas un ordre à partir d'une chaîne libre.
 *
 * @param {unknown} value
 * @returns {number[]|null}
 */
export function versionParts(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+(?:\.\d+)*)$/);
  if (!match) return null;
  return match[1].split('.').map(Number);
}

/**
 * Comparer deux versions, chiffre par chiffre (donc sans comparer des chaînes :
 * « 1.0.10 » > « 1.0.9 », ce qu'un tri alphabétique se trompe à dire).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number|null} -1, 0, 1 — `null` si l'une des deux n'est pas lisible
 */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * ─── Un poste resté sur une ANCIENNE version recevrait-il la plus récente ? ──
 *
 * La question du canal n'est pas « la version en tête est-elle cohérente ? » mais
 * « les postes DÉJÀ INSTALLÉS reçoivent-ils quelque chose ? », et les deux ne se
 * confondent pas : chaque version publiée est une population de postes, et une
 * population qui n'est plus routée ne le dit jamais. Le défaut typique est
 * silencieux : une version publiée reste dans le canal, la tête change de sens
 * (elle est plus ancienne, ou hors canal stable), et les postes concernés ne
 * reçoivent plus RIEN — sans qu'aucun job ne rougisse, puisque la tête, elle,
 * est parfaitement cohérente.
 *
 * « Reçoit la plus récente » se décide exactement comme le fait le client, et
 * cette décision a deux moitiés :
 *   • **quelle version le canal NOMME** — `head`, tel que l'endpoint que le
 *     poste interroge (`/releases/latest`, `Accept: application/json`) le
 *     répond. Ce n'est pas forcément la plus haute version publiée, et c'est
 *     précisément là que les deux se séparent ;
 *   • **une comparaison de versions** — `electron-updater` ne propose la tête à
 *     un poste que si elle est STRICTEMENT supérieure à ce qu'il exécute. Un
 *     poste en 1.0.5 devant une tête 1.0.4 n'est pas « à jour » : il est
 *     définitivement en dehors du chemin.
 *
 * D'où un verdict PAR VERSION publiée, et pas un verdict sur la tête :
 *   • `head > poste`   → reçoit la tête (sauf retenue par le frein, et c'est un
 *                        état VOULU, donc nommé et non refusé) ;
 *   • `head === poste` → c'est la tête, il n'y a rien à installer ;
 *   • `head < poste` (ou tête illisible) → il ne reçoit PLUS RIEN, et c'est un
 *                        défaut, pas une opinion.
 *
 * Les pré-versions publiées sont comptées à part : elles sont invisibles pour le
 * canal stable (`/releases/latest` les ignore, comme l'updater), donc elles ne
 * portent aucun poste — mais elles sont NOMMÉES, parce qu'un release publié que
 * personne ne lit est exactement le genre de fait que ce dépôt refuse de taire.
 *
 * @param {{ published?: { tag_name?: string, draft?: boolean, prerelease?: boolean }[],
 *   headTag?: unknown, holds?: string[] }} [input]
 * @returns {{ head: string|null, newest: string|null,
 *   clients: { version: string, target: string|null, receives: boolean, held: boolean, detail: string }[],
 *   invisible: string[], problems: string[], warnings: string[] }}
 */
export function deliveryReach({ published = [], headTag = null, holds = [] } = {}) {
  const problems = [];
  const warnings = [];
  const list = (Array.isArray(published) ? published : []).filter((r) => r && r.draft !== true);
  const stableOf = (r) => (r.prerelease === true ? null : String(r.tag_name ?? '').replace(/^v/, '').trim());
  const readable = (version) => version && versionParts(version) !== null;

  const invisible = list.filter((r) => r.prerelease === true).map((r) => String(r.tag_name ?? '').trim());
  const versions = [];
  for (const release of list) {
    const version = stableOf(release);
    if (!readable(version)) continue;
    if (!versions.includes(version)) versions.push(version);
  }
  versions.sort((a, b) => compareVersions(b, a));

  const newest = versions[0] ?? null;
  const head = readable(String(headTag ?? '').replace(/^v/, '').trim())
    ? String(headTag ?? '').replace(/^v/, '').trim()
    : null;

  // Ce qui est refusé : un canal qui n'a plus de tête lisible (un poste ne peut
  // rien recevoir), ou une tête qui n'est pas un release publié du canal stable
  // (donc que personne ne lira — le cas d'un brouillon promu nulle part).
  if (!head) {
    problems.push(
      'aucune version nommée par le canal — l’endpoint que le poste interroge ne répond aucune version : ' +
        'il ne recevra RIEN (côté client : ERR_UPDATER_NO_PUBLISHED_VERSIONS)',
    );
  } else if (!versions.includes(head)) {
    problems.push(
      `le canal nomme « ${head} », qui n’est pas un release publié du canal stable — ` +
        'un poste lit donc une tête qui n’existe pour personne',
    );
  }

  const held = new Set((Array.isArray(holds) ? holds : []).map((v) => String(v ?? '').trim()));
  const clients = [];
  for (const version of versions) {
    if (version === head) {
      clients.push({ version, target: head, receives: true, held: false, detail: 'c’est la tête : rien à installer' });
      continue;
    }
    if (head && compareVersions(head, version) === 1) {
      const retained = held.has(head);
      clients.push({
        version,
        target: head,
        receives: !retained,
        held: retained,
        detail: retained
          ? `la tête ${head} est RETENUE par le frein d’urgence : ce poste ne la recevra pas tant que la retenue est là`
          : `reçoit ${head}`,
      });
      if (retained) {
        warnings.push(
          `les postes en ${version} ne recevront pas ${head} tant qu’elle est retenue par le frein ` +
            '(c’est le frein qui agit, pas le canal)',
        );
      }
      continue;
    }
    clients.push({
      version,
      target: head,
      receives: false,
      held: false,
      detail: head
        ? `ne reçoit PLUS RIEN : le canal nomme ${head}, qui n’est PAS plus récente que ${version}`
        : 'ne reçoit PLUS RIEN : le canal ne nomme aucune version',
    });
    problems.push(
      `un poste resté en ${version} ne recevrait plus rien : le canal nomme « ${head ?? '—'} » — ` +
        'chaque version publiée est une population de postes, et celle-là est sortie du chemin',
    );
  }

  // La tête n'est pas forcément la plus HAUTE version publiée : le tri du client
  // (l'endpoint) et la plus haute version ne se confondent pas, et quand ils
  // divergent, c'est une information de première importance — un poste sur la
  // version la plus haute ne verra jamais rien de plus récent.
  if (head && newest && compareVersions(head, newest) === -1) {
    problems.push(
      `la tête lue (${head}) n’est PAS la version la plus haute publiée (${newest}) — ` +
        'un poste sur cette dernière ne verra jamais de mise à jour',
    );
  }
  for (const tag of invisible) {
    warnings.push(`${tag} est publié en PRÉ-VERSION : invisible pour un poste, donc aucun poste ne le lit`);
  }

  return { head, newest, clients, invisible, problems, warnings };
}

/** Un numéro de version plausible — ce qu'une retenue doit nommer pour mordre. */
const VERSION_LIKE = /^\d+(\.\d+)*$/;

/**
 * Lire le frein d'urgence (`updates/holds.json`) tel que le POSTE le lit.
 *
 * Le frein est le seul mécanisme qui permet de retenir une version défectueuse
 * avant qu'elle n'atteigne tout le monde — et c'est un fichier que l'application
 * interroge à CHAQUE vérification de mise à jour. Sa panne est donc
 * silencieuse par construction : un fichier illisible ne retient rien, la mise
 * à jour reste seulement PROPOSÉE, et personne ne l'apprend jusqu'au jour où
 * quelqu'un compte sur le frein qui ne freine pas. C'est exactement la forme du
 * faux vert que ce dépôt refuse — d'où ce verdict, séparé du reste du canal.
 *
 * Ce qui est REFUSÉ (sinon le frein est mort en silence) : un fichier absent ou
 * vide, un JSON illisible, une racine qui n'est pas un objet, une liste `holds`
 * absente, une entrée qui ne nomme aucune version — ou qui en nomme une qui ne
 * peut correspondre à aucun release.
 *
 * Ce qui est seulement NOMMÉ : un motif absent (le frein retient quand même —
 * « c'est le motif qui manque, pas le frein ») et une retenue en double.
 *
 * @param {unknown} text
 * @returns {{ ok: boolean, holds: string[], entries: { version: string, reason: string }[],
 *   problems: string[], warnings: string[] }}
 */
export function parseHoldsFile(text) {
  const problems = [];
  const warnings = [];
  const empty = (why) => ({ ok: false, holds: [], entries: [], problems: [why], warnings });
  const raw = String(text ?? '').trim();
  if (!raw) {
    return empty(
      'frein illisible : fichier vide ou absent — le frein d’urgence ne retiendrait RIEN alors ' +
        'qu’un poste croit le contraire',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty('frein illisible : ce n’est pas du JSON — une version défectueuse ne pourrait pas être retenue');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty('frein illisible : la racine n’est pas un objet `{ holds: [...] }`');
  }
  if (!Array.isArray(parsed.holds)) {
    return empty(
      'frein illisible : la liste `holds` est absente — le fichier ne retiendrait rien, et le poste ' +
        'le lirait comme « aucune retenue »',
    );
  }
  const entries = [];
  const seen = new Set();
  for (const [index, entry] of parsed.holds.entries()) {
    const where = `holds[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where} n’est pas un objet « { version, reason } » — cette retenue est inerte`);
      continue;
    }
    const version = String(entry.version ?? '').trim();
    if (!version) {
      problems.push(`${where} ne nomme AUCUNE version — une retenue qui ne nomme rien ne retient rien`);
      continue;
    }
    if (!VERSION_LIKE.test(version)) {
      problems.push(
        `${where} nomme « ${version} », qui n’est pas un numéro de version — cette retenue ne ` +
          'correspondra jamais à un release',
      );
      continue;
    }
    if (seen.has(version)) warnings.push(`« ${version} » est retenue deux fois — une seule suffit`);
    seen.add(version);
    const reason = String(entry.reason ?? '').trim();
    if (!reason) {
      warnings.push(`« ${version} » est retenue sans motif — le frein tient, mais personne ne saura pourquoi`);
    }
    entries.push({ version, reason });
  }
  return { ok: problems.length === 0, holds: entries.map((e) => e.version), entries, problems, warnings };
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
