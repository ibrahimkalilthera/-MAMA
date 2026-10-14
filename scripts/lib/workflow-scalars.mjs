/**
 * ─── UN WORKFLOW QUE YAML REFUSE NE TOURNE PAS : IL MEURT AU DÉMARRAGE ───────
 *
 * Ce que ce module cherche est une seule chose, et elle coûte très cher : un
 * scalaire NON QUOTÉ qui contient `:` suivi d'une espace. YAML y voit une clé
 * au milieu d'une valeur, refuse le fichier entier — et GitHub tue alors CHAQUE
 * run au démarrage : **zéro job, aucun log**, une conclusion « failure » que
 * personne ne peut lire, sur toutes les branches et pour tous les
 * déclencheurs. Un contrôle mort ne dit pas qu'il est mort ; il ressemble à un
 * contrôle qui ne trouve rien.
 *
 * C'est arrivé le 2026-10-14, et la facture est mesurable : `014baeb` (1.0.32) a
 * ajouté au fichier deux noms d'étape en français —
 * `- name: Gate — politiques RLS : la base porte-t-elle …` — et la veille « une
 * table de public sans RLS » est restée morte deux jours. Le dernier run vert
 * était le cron du matin, sur le commit d'AVANT ; tous les runs suivants étaient
 * des pushes, tous en échec au démarrage, y compris ceux des onze branches
 * Dependabot. Rien n'a pu le dire : la chaîne qualité lit ces fichiers pour y
 * comparer des commandes (`scripts/check-ci-commands.mjs`), jamais pour les
 * parser, et l'audit des automatisations lit des preuves — un workflow qui ne
 * démarre pas n'en publie aucune, donc il ne l'accuse pas non plus.
 *
 * ─── CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS ────────────────────────────
 *
 * Ce n'est PAS un parseur YAML, et il ne prétend pas l'être : réécrire YAML ici
 * serait un piège à lui seul. C'est un détecteur d'UNE classe — celle qui a tué
 * une veille —, calibré pour être propre sur l'arbre réel (les vingt workflows
 * du dépôt) : un garde qui rougit sur du code légitime est un garde qu'on
 * contourne.
 *
 * Les trois pièges qu'il connaît, et pourquoi :
 *
 *   • les GUILLEMETS — `run: echo "a: b"` est parfaitement valide : le `:` est
 *     dans une chaîne. On ne teste donc que le texte HORS guillemets ;
 *   • les BLOCS LITTÉRAUX — `run: |` fait que les lignes suivantes sont du
 *     TEXTE, pas du YAML : un `foo: bar` y est du shell, du JSON, n'importe quoi
 *     d'autre. Leurs lignes sont sautées jusqu'à la fin du bloc (l'indentation) ;
 *   • les COMMENTAIRES — `timeout-minutes: 10  # mesure : 8 min` finit par un
 *     commentaire, et un commentaire n'est pas du YAML. Il est coupé avant le
 *     jugement (un `#` précédé d'une espace, hors guillemets).
 */

/**
 * Le texte d'une valeur, MOINS ses segments quotés et son commentaire final.
 *
 * C'est exactement ce que YAML lit comme scalaire nu : ce qui reste hors
 * guillemets. Une valeur entièrement quotée rend donc une chaîne vide — et une
 * chaîne vide ne peut pas être cassée, ce qui est le verdict correct.
 *
 * @param {string} raw la valeur telle qu'écrite après `clé:`
 * @returns {string}
 */
export function bareScalar(raw) {
  const text = String(raw ?? '');
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '#' && /\s/.test(text[i - 1] ?? ' ')) break;
    out += ch;
  }
  return out.trim();
}

/** Une valeur qui ouvre une collection en ligne (`[a, b]`, `{a: b}`) peut porter `:` légitimement. */
const FLOW_START = /^[[{]/;

/** Une clé de mapping YAML en début de ligne, avec ou sans tiret de séquence. */
const MAPPING = /^(?:-\s+)?([A-Za-z_][\w.-]*)\s*:(?:\s+|$)(.*)$/;

/**
 * Les scalaires nus du fichier qui portent un `:` suivi d'une espace — ou qui
 * finissent par `:` —, c'est-à-dire les lignes qui font refuser le fichier
 * entier par YAML.
 *
 * @param {string} text le contenu d'un fichier de workflow
 * @returns {Array<{ line: number, key: string, text: string }>}
 */
export function findBrokenScalars(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const found = [];
  /** L'indentation de la clé qui a ouvert un bloc littéral (`|` ou `>`), sinon `null`. */
  let blockIndent = null;

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;

    if (blockIndent !== null) {
      if (indent > blockIndent) return; // contenu du bloc : ce n'est pas du YAML
      blockIndent = null;
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('---')) return;

    const matched = MAPPING.exec(trimmed);
    if (!matched) return;

    const rest = matched[2].trim();
    if (/^[|>]/.test(rest)) { blockIndent = indent; return; } // ouvre un bloc littéral
    if (!rest || FLOW_START.test(rest)) return;

    const bare = bareScalar(rest);
    if (!bare) return;
    if (/:\s/.test(bare) || bare.endsWith(':')) {
      found.push({ line: index + 1, key: matched[1], text: trimmed });
    }
  });

  return found;
}

/**
 * Combien de scalaires le lecteur a RÉELLEMENT regardés.
 *
 * C'est le compteur de non-vacuité de la porte : une règle qui examine zéro
 * scalaire — la forme des lignes a changé, le lecteur ne les atteint plus —
 * n'a rien prouvé, et doit sortir en 2 plutôt que se féliciter.
 *
 * @param {string} text le contenu d'un fichier de workflow
 * @returns {number}
 */
export function countMappingScalars(text) {
  let count = 0;
  let blockIndent = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
    const matched = MAPPING.exec(trimmed);
    if (!matched) continue;
    // La clé compte TOUJOURS, même quand sa valeur ouvre un bloc littéral : le
    // lecteur l'a vue et jugée (c'est un scalaire qu'il a traité). Seul le
    // CONTENU du bloc n'est pas un scalaire.
    count += 1;
    if (/^[|>]/.test(matched[2].trim())) blockIndent = indent;
  }
  return count;
}
