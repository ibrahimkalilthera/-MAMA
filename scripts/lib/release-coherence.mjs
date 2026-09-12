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
 * Ce qu'on a besoin de savoir d'un release pour décider lequel les postes voient.
 * @typedef {{ tag_name?: string, draft?: boolean, published_at?: string, created_at?: string }} ReleaseLike
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
 * @param {ReleaseLike[]} [releases]
 * @returns {ReleaseLike|null} null si aucun release n'est publié — le canal est muet
 */
export function pickLatestPublished(releases = []) {
  const list = (Array.isArray(releases) ? releases : []).filter(
    (r) => r && r.draft !== true && typeof r.tag_name === 'string' && r.tag_name,
  );
  if (!list.length) return null;
  const when = (r) => {
    const ms = Date.parse(String(r.published_at || r.created_at || ''));
    return Number.isFinite(ms) ? ms : 0;
  };
  return list.slice().sort((a, b) => when(b) - when(a))[0];
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
