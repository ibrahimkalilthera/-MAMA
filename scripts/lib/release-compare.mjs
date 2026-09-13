// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-compare.mjs — confronter ce qu'on croit livrer à ce qui est
// réellement là (le paquet, `latest.yml`, les fichiers du dossier, les actifs du
// canal), et décider si une publication peut partir.
//
// Tout y est PUR : les faits entrent (des textes, des noms, des tailles), un
// verdict sort. La partie qui lit le disque et le réseau vit dans
// scripts/check-release-coherence.mjs — c'est ce qui permet d'asserter chaque
// branche de refus sans monter un dépôt.
// ─────────────────────────────────────────────────────────────────────────────
import { nameCarriesVersion, parseLatestYml } from './latest-yml.mjs';
import { releaseTag } from './release-version.mjs';

/**
 * Comparer le flux local, les artefacts du dossier, et la version du paquet.
 *
 * Le dossier est un PARAMÈTRE (`dir`), pas une constante : ce contrôle accepte
 * `--dir=`, donc un avertissement qui écrirait `release/` d'avance nommerait un
 * dossier qu'il n'a pas lu. Le nom vient de celui qui a lu le dossier, et d'un
 * seul côté.
 *
 * @param {{ latestText: unknown, packageVersion: string,
 *   assets?: Map<string, { size: number, sha512: string }>, dirNames?: string[],
 *   expectBlockmap?: boolean, dir?: string }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], latest: object|null }}
 */

export function compareLatest({
  latestText,
  packageVersion,
  assets = new Map(),
  dirNames = [],
  expectBlockmap = true,
  dir = 'release',
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
  //
  // Le dossier est nommé par celui qui l'a LU (`dir`), jamais écrit ici : la
  // version précédente disait `release/` en dur alors que le contrôle accepte
  // `--dir=` — mesuré sur `release-probe/`, il annonçait donc des fichiers
  // présents dans un dossier dont il ne parlait pas, et un lecteur pressé
  // cherchait au mauvais endroit. C'est la même faute que le rappel de
  // `release:prune` qui perdait son `--dir`, dans le seul autre producteur de
  // ces lignes.
  const leftovers = dirNames.filter(
    (name) => /\.exe$/i.test(name) && !nameCarriesVersion(name, latest.version),
  );
  if (leftovers.length) {
    warnings.push(
      `${leftovers.length} installeur(s) d'une AUTRE version traînent dans ${dir}/ (${leftovers.join(', ')}) — ` +
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
