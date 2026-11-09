/**
 * ─── Quelles branches sont mortes, et sur quelle preuve ─────────────────────
 *
 * Ce module existe parce que le ménage des branches a été fait À LA MAIN le
 * 2026-11-09, et que deux réflexes y ont menti :
 *
 *   ① `git branch --merged` ne voit RIEN des fusions en squash. Le dépôt fusionne
 *     chaque PR en squash : le commit de la branche n'est jamais un ancêtre de
 *     `main`, donc dix-sept branches mortes ressortaient « non fusionnées ».
 *   ② `git log --grep "<sujet>"` ne voit rien non plus : le squash réécrit le
 *     sujet en `… (#127)`, et les branches de ce dépôt ont des titres qui ne
 *     survivent pas à la conversion.
 *
 * Reste ce qui a réellement tranché : une PR **fusionnée** (preuve exacte), un
 * tip déjà **ancêtre** de `main` (preuve exacte), et, pour le reste, la part des
 * lignes distinctives que la branche ajoute et que `main` contient déjà.
 *
 * ─── Ce que ce module refuse de faire ────────────────────────────────────────
 *
 * Il ne supprime rien, et il ne dit « supprimable » que sur une preuve exacte.
 * La couverture de contenu est un INDICE, jamais un verdict : mesurée sur les
 * branches déjà fusionnées de ce dépôt, elle valait 100 %, 93 %, 88 %… — la
 * dérive normale d'un fichier retouché après la fusion. Un seuil transformerait
 * ce chiffre en feu vert ; c'est précisément le faux vert que le dépôt traque
 * (« une surface non mesurée doit être une ligne, jamais un silence », et un
 * garde trompé est pire qu'un garde absent). Le tri reste donc humain ; ce
 * module lui donne les faits, dans l'ordre.
 *
 * ─── Les trois états ────────────────────────────────────────────────────────
 *
 *   • `supprimable` — preuve exacte : tip ancêtre de la base, ou PR fusionnée.
 *   • `garder`      — une PR est ouverte : du travail attend une revue.
 *   • `à relire`    — tout le reste, avec les indices : aucune PR, PR fermée
 *                     sans fusion, couverture de contenu, `gh` indisponible.
 */

/** Les trois verdicts, nommés une seule fois. */
export const VERDICT = {
  REMOVABLE: 'supprimable',
  KEEP: 'garder',
  REVIEW: 'à relire',
};

/** En dessous, une ligne n'est pas assez singulière pour prouver quoi que ce soit. */
const MIN_DISTINCTIVE = 25;

/**
 * Le verdict d'UNE branche, et ses raisons.
 *
 * @param {{
 *   tipInBase?: boolean,
 *   pr?: { number: number, state: 'open'|'closed', mergedAt?: string|null } | null,
 *   prUnknown?: boolean,
 *   coverage?: { ratio: number|null, sampled: number, missingFiles: string[] } | null,
 * }} input
 *   `pr` vaut `null` quand aucune PR n'existe ; `prUnknown` dit que la question
 *   n'a pas pu être POSÉE (gh absent) — deux choses différentes, jamais confondues.
 * @returns {{ verdict: string, reasons: string[] }}
 */
export function classifyBranch({ tipInBase = false, pr = null, prUnknown = false, coverage = null } = {}) {
  const reasons = [];

  if (tipInBase) reasons.push('le tip est déjà un ancêtre de la base');
  if (pr && pr.mergedAt) reasons.push(`PR #${pr.number} fusionnée`);

  // Preuves exactes : le contenu est dans la base, quoi qu'il arrive au reste.
  if (tipInBase || (pr && pr.mergedAt)) return { verdict: VERDICT.REMOVABLE, reasons };

  if (pr && pr.state === 'open') {
    reasons.push(`PR #${pr.number} ouverte`);
    return { verdict: VERDICT.KEEP, reasons };
  }

  if (prUnknown) reasons.push('PR non lues (gh indisponible) — le tri reste à faire');
  else if (!pr) reasons.push('aucune PR');
  else reasons.push(`PR #${pr.number} fermée sans fusion`);

  if (coverage) {
    if (coverage.missingFiles.length > 0) {
      reasons.push(
        `${coverage.missingFiles.length} fichier(s) absent(s) de la base : ${coverage.missingFiles
          .slice(0, 3)
          .join(', ')}${coverage.missingFiles.length > 3 ? '…' : ''}`,
      );
    }
    if (coverage.ratio === null) reasons.push('contenu : aucune ligne distinctive à comparer');
    else {
      reasons.push(
        `contenu : ${Math.round(coverage.ratio * 100)} % des lignes distinctives déjà dans la base ` +
          `(${coverage.sampled} mesurée(s)) — indice, pas preuve`,
      );
    }
  }

  return { verdict: VERDICT.REVIEW, reasons };
}

/**
 * La part des lignes distinctives d'une branche que la base contient DÉJÀ.
 *
 * Pour chaque commit absent de la base : on lit ses lignes AJOUTÉES (longues,
 * donc singulières), et on regarde si la version que la base a du même fichier
 * les porte mot pour mot. Les lignes trop courtes sont ignorées : `}`, un import
 * ou un `it(` se retrouvent partout et feraient un 100 % qui ne prouve rien.
 *
 * @param {{ git: (args: string[]) => string, base: string, ref: string }} input
 * @returns {{ commits: number, sampled: number, present: number, ratio: number|null, missingFiles: string[] }}
 */
export function contentCoverage({ git, base, ref }) {
  const commits = git(['log', '--format=%H', `${base}..${ref}`])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  // Les versions de la base, lues UNE fois par fichier : un commit par branche,
  // mais le même fichier revient d'un commit à l'autre.
  const baseFiles = new Map();
  const readFromBase = (path) => {
    try {
      return git(['show', `${base}:${path}`]);
    } catch {
      return null; // absent de la base : ce fichier n'a pas encore voyagé
    }
  };
  const baseLines = (path) => {
    if (!baseFiles.has(path)) baseFiles.set(path, readFromBase(path));
    const text = baseFiles.get(path);
    return text === null ? null : new Set(text.split(/\r?\n/));
  };

  const missingFiles = new Set();
  let sampled = 0;
  let present = 0;

  for (const commit of commits) {
    const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);

    for (const path of files) {
      const lines = baseLines(path);
      if (lines === null) {
        missingFiles.add(path);
        continue;
      }
      const patch = git(['show', commit, '--format=', '--unified=0', '--', path]);
      const added = patch
        .split(/\r?\n/)
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1))
        .filter((line) => line.trim().length >= MIN_DISTINCTIVE);
      for (const line of added) {
        sampled += 1;
        if (lines.has(line)) present += 1;
      }
    }
  }

  return {
    commits: commits.length,
    sampled,
    present,
    ratio: sampled === 0 ? null : present / sampled,
    missingFiles: [...missingFiles].sort(),
  };
}

/** Le libellé d'une PR, ou l'aveu qu'on n'en sait rien. */
export function describePr({ pr, prUnknown }) {
  if (prUnknown) return 'non lues';
  if (!pr) return 'aucune';
  if (pr.mergedAt) return `#${pr.number} fusionnée`;
  if (pr.state === 'open') return `#${pr.number} ouverte`;
  return `#${pr.number} fermée`;
}

const pad = (value, width) => String(value).padEnd(width);

/**
 * Le tableau, une ligne par branche, puis les deux listes demandées.
 *
 * L'ordre est celui des verdicts (supprimable d'abord) : la première ligne du
 * rapport est celle qu'on peut traiter, pas celle qui a l'air intéressante.
 *
 * @param {Array<{ name: string, local: boolean, remote: boolean, pr: any, prUnknown: boolean,
 *   coverage: ReturnType<typeof contentCoverage>, verdict: string, reasons: string[] }>} rows
 * @param {{ base: string }} options
 * @returns {string[]}
 */
export function formatReport(rows, { base }) {
  const order = { [VERDICT.REMOVABLE]: 0, [VERDICT.KEEP]: 1, [VERDICT.REVIEW]: 2 };
  const sorted = [...rows].sort(
    (a, b) => (order[a.verdict] - order[b.verdict]) || a.name.localeCompare(b.name),
  );

  const nameWidth = Math.max(7, ...sorted.map((r) => r.name.length));
  const lines = [];
  lines.push(`Base : ${base} — ${sorted.length} branche(s), ${base} exclue.`);
  lines.push('');
  lines.push(
    `${pad('branche', nameWidth)}  local  origin  PR                commits  contenu  verdict`,
  );
  for (const row of sorted) {
    const coverage =
      row.coverage.ratio === null ? '   —  ' : `${String(Math.round(row.coverage.ratio * 100)).padStart(3)} %`;
    lines.push(
      `${pad(row.name, nameWidth)}  ${pad(row.local ? 'oui' : '-', 5)}  ${pad(row.remote ? 'oui' : '-', 6)}  ` +
        `${pad(describePr(row), 16)}  ${pad(row.coverage.commits, 7)}  ${pad(coverage, 7)}  ${row.verdict}`,
    );
  }

  const withoutPr = sorted.filter((r) => !r.prUnknown && !r.pr);
  lines.push('');
  lines.push(
    withoutPr.length === 0
      ? 'Aucune branche sans PR.'
      : `Sans PR (${withoutPr.length}) : ${withoutPr.map((r) => r.name).join(', ')}`,
  );
  if (sorted.some((r) => r.prUnknown)) {
    lines.push('PR non lues : gh est indisponible ou non authentifié — cette colonne ne prouve rien.');
  }

  const landed = sorted.filter((r) => r.coverage.ratio === 1 && r.coverage.sampled > 0);
  lines.push(
    landed.length === 0
      ? 'Aucune branche dont toutes les lignes distinctives sont déjà dans la base.'
      : `Contenu déjà intégralement dans la base (indice) : ${landed.map((r) => r.name).join(', ')}`,
  );

  const counts = sorted.reduce((acc, r) => acc.set(r.verdict, (acc.get(r.verdict) ?? 0) + 1), new Map());
  lines.push('');
  lines.push(
    `Bilan : ${[...counts].map(([verdict, n]) => `${n} ${verdict}`).join(', ') || '0 branche'}.`,
  );
  lines.push('Ce rapport ne supprime rien : `supprimable` est une preuve, le reste demande une lecture.');
  return lines;
}
