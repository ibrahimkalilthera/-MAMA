// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/latest-yml.mjs — lire les DEUX fichiers qu'un poste lit.
//
// `latest.yml` est le flux (`electron-updater` le lit à chaque vérification) et
// `updates/holds.json` est le frein d'urgence. Les deux sont du texte fourni par
// le dépôt, donc les deux se lisent ici, sans rien savoir du canal ni d'un
// numéro — et un fichier illisible est un REFUS nommé, jamais un objet vide qui
// laisserait croire à un fichier vide.
// ─────────────────────────────────────────────────────────────────────────────

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

