/**
 * ─── UNE RELEASE PASSE PAR UNE PR, ELLE AUSSI ───────────────────────────────
 *
 * Monter la version est le seul geste humain qui reste dans la publication
 * (`desktop-release.yml` fait tout le reste dès qu'un numéro inédit apparaît
 * sur `main`). Ce geste était un commit poussé DIRECTEMENT sur `main` — le
 * dernier chemin par lequel l'administrateur pouvait encore contourner les
 * portes du dépôt, et la raison pour laquelle `enforce_admins` valait `false`.
 *
 * `enforce_admins: true` rend ce chemin impossible — y compris pour le
 * propriétaire. Il faut donc que la release ait le sien : une branche
 * `release/vX.Y.Z`, un commit qui ne touche QUE les deux fichiers de version,
 * une PR, le check requis, la fusion, puis la publication automatique.
 *
 * Ce module est la moitié PURE de ce chemin : il décide le numéro, la branche,
 * le message et le corps de la PR, et il réécrit la ligne de version sans
 * toucher au reste du fichier (les deux fichiers sont suivis en CRLF ; un
 * `JSON.stringify` les réécrirait en entier, et une release dont le diff fait
 * 10 000 lignes ne se relit pas).
 *
 * Le script `scripts/release-pr.mjs` fait le reste : git, le push, l'API.
 */

/** Le préfixe des branches de release — une seule définition. */
export const RELEASE_BRANCH_PREFIX = 'release/v';

/** Le seul check exigé par la protection de `main` (docs/PROTECTION_MAIN.md). */
export const REQUIRED_CHECK = 'Lint + tests + audit';

/** Un numéro de version, et rien d'autre : `X.Y.Z`, avec un `v` toléré. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `"v1.0.44"` → `"1.0.44"` ; tout le reste → `null` (on ne devine pas). */
export function normalizeVersion(value) {
  const match = VERSION.exec(String(value ?? '').trim());
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

/** Le numéro suivant : le correctif (`1.0.43` → `1.0.44`). `null` si illisible. */
export function nextPatchVersion(current) {
  const normalized = normalizeVersion(current);
  if (!normalized) return null;
  const [major, minor, patch] = normalized.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** Compare deux `X.Y.Z` : -1, 0, 1 — ou `null` si l'une n'est pas un numéro. */
export function compareTriples(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) return null;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (pa[index] !== pb[index]) return pa[index] > pb[index] ? 1 : -1;
  }
  return 0;
}

/**
 * La release demandée, jugée sans toucher à rien.
 *
 * @param {{ current?: string, requested?: string|null, summary?: string }} input
 * @returns {{
 *   ok: boolean, problems: string[], current: string|null, version: string|null,
 *   branch: string, commitMessage: string, prTitle: string, prBody: string
 * }}
 */
export function releasePlan({ current, requested, summary } = {}) {
  const problems = [];
  const from = normalizeVersion(current);
  if (!from) {
    problems.push(`la version de package.json est illisible (« ${String(current ?? '')} ») — attendu X.Y.Z`);
  }

  const asked = String(requested ?? '').trim();
  const version = asked ? normalizeVersion(asked) : nextPatchVersion(from);
  if (asked && !version) {
    problems.push(`la version demandée est illisible (« ${asked} ») — attendu X.Y.Z`);
  }
  if (from && version && compareTriples(version, from) <= 0) {
    problems.push(
      `la version doit être strictement supérieure à ${from} (demandé ${version}) : ` +
        'republier un numéro n’atteint aucun poste — il est déjà servi, ou il ne dit rien de neuf',
    );
  }

  const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
  const branch = version ? `${RELEASE_BRANCH_PREFIX}${version}` : '';
  const commitMessage = version ? `chore(release): ${version}${text ? ` — ${text}` : ''}` : '';

  return {
    ok: problems.length === 0,
    problems,
    current: from,
    version,
    branch,
    commitMessage,
    prTitle: commitMessage,
    prBody: version ? releaseBody({ version, from, summary: text }) : '',
  };
}

/** Le corps de la PR — ce qu'elle change, ce qui se passe après la fusion. */
export function releaseBody({ version, from, summary }) {
  const lines = [
    `# Release ${version}`,
    '',
    summary ? `**Pourquoi ce numéro.** ${summary}` : `**Pourquoi ce numéro.** Monter la version est le seul geste qui publie.`,
    '',
    `De ${from ?? '?'} à ${version}. Ce commit ne touche QUE \`package.json\` et \`package-lock.json\` :`,
    'la version, et le champ que npm duplique dans le verrou. Aucun code, aucune migration.',
    '',
    '## Après la fusion — rien d’autre à faire',
    '',
    '1. `Quality & performance guard` repasse sur `main` ;',
    '2. `Desktop release (Windows)` voit un numéro inédit, construit, signe (si `SIGNING_ENABLED`),',
    '   téléverse en brouillon, vérifie les octets, puis promeut sur le canal ;',
    '3. le parc reçoit la version au battement suivant.',
    '',
    `## Avant de fusionner`,
    '',
    `Le check requis \`${REQUIRED_CHECK}\` doit être vert. C’est le seul que la protection de`,
    '`main` exige — et avec `enforce_admins: true`, il vaut aussi pour le propriétaire.',
  ];
  return lines.join('\n');
}

/**
 * La ligne de version de `package.json` — la PREMIÈRE du fichier, celle de la
 * racine. Rien d'autre n'est touché : ni l'indentation, ni les fins de ligne.
 *
 * @param {string} text
 * @param {string} version
 * @returns {{ text: string, replaced: number } | null} `null` quand il n'y a
 *   rien à remplacer — l'appelant échoue au lieu d'écrire un fichier à moitié.
 */
export function bumpPackageJsonVersion(text, version) {
  const next = normalizeVersion(version);
  if (!next) return null;
  let replaced = 0;
  const bumped = String(text ?? '').replace(/"version"\s*:\s*"[^"]*"/, (match) => {
    replaced += 1;
    return `"version": "${next}"`;
  });
  return replaced === 1 ? { text: bumped, replaced } : null;
}

/**
 * Les DEUX versions de `package-lock.json` : celle de la racine et celle de
 * `packages[""]` — les seules que npm tient à jour avec `package.json`.
 *
 * Un verrou sans la section `packages` (lockfileVersion 1) n'en a qu'une :
 * c'est le seul cas où un remplacement unique suffit, et il est dit.
 *
 * @param {string} text
 * @param {string} version
 * @returns {{ text: string, replaced: number } | null}
 */
export function bumpPackageLockVersions(text, version) {
  const next = normalizeVersion(version);
  if (!next) return null;
  const source = String(text ?? '');
  const lines = source.split(/(?<=\n)/); // garde les fins de ligne avec leur ligne

  const versionLine = (line) => /^\s*"version"\s*:\s*"[^"]*"[,\r\n]*$/.test(line);
  const setVersion = (line) => line.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`);

  let rootDone = false;
  let packagesAt = -1;
  let packagesEmptyAt = -1;
  let packageDone = false;
  let replaced = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!rootDone && versionLine(line)) {
      lines[index] = setVersion(line);
      rootDone = true;
      replaced += 1;
      continue;
    }
    if (packagesAt < 0 && /"packages"\s*:\s*\{/.test(line)) {
      packagesAt = index;
      continue;
    }
    if (packagesAt >= 0 && packagesEmptyAt < 0 && /""\s*:\s*\{/.test(line)) {
      packagesEmptyAt = index;
      continue;
    }
    if (packagesEmptyAt >= 0 && !packageDone && versionLine(line)) {
      lines[index] = setVersion(line);
      packageDone = true;
      replaced += 1;
    }
  }

  if (!rootDone) return null;
  // Une section `packages` présente mais sans version dans `""` est une forme
  // qu'on ne connaît pas : on refuse plutôt que de laisser le verrou mentir.
  if (packagesAt >= 0 && packagesEmptyAt >= 0 && !packageDone) return null;
  return { text: lines.join(''), replaced };
}
