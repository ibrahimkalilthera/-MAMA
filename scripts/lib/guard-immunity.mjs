/**
 * ─── L'inventaire des immunités de chaque contrôle ─────────────────────────
 *
 * Chaque contrôle de ce dépôt lit quelque chose. Chaque chose lue est
 * falsifiable par quelque chose d'autre :
 *
 *   • un scan de SOURCE peut lire de la prose (un commentaire qui CITE la règle)
 *     ou ne rien lire du tout (racine déplacée, filtre cassé) ;
 *   • un contrôle qui lit des JOURNAUX peut être trompé par n'importe quoi qui
 *     IMPRIME la marque qu'il cherche — l'incident mesuré : `npm test` importait
 *     le script Dependabot, la marque d'inaction atterrissait dans le journal du
 *     job de tests, et l'audit accusait le mauvais workflow ;
 *   • une preuve peut parler du mauvais SUJET (même marque, autre workflow).
 *
 * Ce module ne vérifie pas des intentions : il porte **l'inventaire explicite**
 * des immunités attendues, pour que le silence ne puisse plus passer pour une
 * garantie. Un contrôle nouveau doit se déclarer ici — sinon
 * `scripts/check-guard-immunity.mjs` échoue — et une exemption doit dire
 * POURQUOI, sinon elle échoue aussi.
 *
 * Les faits vérifiables dans la source :
 *   • `non-vacuous`  → le contrôle refuse explicitement de rien lire
 *                      (`assertScanned(`, ou un `process.exit(2)` écrit à la
 *                      main quand le corpus est vide) ;
 *   • `prose-blind`  → le contrôle blanchit la prose par la couche partagée
 *                      (`scripts/lib/source-text.mjs`), ou déclare son propre
 *                      blanchiment avec sa raison ;
 *   • `stored-fields` → le contrôle lit des CHAMPS stockés (les annotations
 *                      d'un run, rendues par l'API), jamais le texte d'un
 *                      journal ;
 *   • `subject-identified` → la preuve porte le nom de son émetteur.
 */

import { existsSync, readFileSync } from 'node:fs';

/** Les immunités, nommées une fois pour être citées sans faute de frappe. */
export const IMMUNITY = {
  NON_VACUOUS: 'non-vacuous',
  PROSE_BLIND: 'prose-blind',
  STORED_FIELDS: 'stored-fields',
  SUBJECT_IDENTIFIED: 'subject-identified',
};

/** Ce qu'on exige d'un contrôle selon ce qu'il LIT, jamais selon son nom. */
export const GUARD_INVENTORY = [
  // ── Le contrôle des contrôles : il lit les autres, donc il peut être trompé
  //    par un inventaire vide ou par une immunité annoncée sans preuve.
  {
    check: 'check-guard-immunity.mjs',
    input: 'checks+inventory',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'il lit des sources de contrôles pour y chercher des preuves, il ne juge pas leur code' },
  },

  // ── Scans de source : les deux pièges classiques, et ils sont réels ───────
  { check: 'check-forbidden-any.mjs', input: 'source', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  { check: 'check-date-windows.mjs', input: 'source', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  { check: 'check-no-emoji-icons.mjs', input: 'source', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  { check: 'check-jsx-i18n.mjs', input: 'source', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  { check: 'check-css-selectors.mjs', input: 'source-css', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  {
    check: 'check-line-budget.mjs',
    input: 'source',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'ce contrôle COMPTE des lignes : retirer la prose fausserait le budget mesuré' },
  },
  { check: 'check-test-harness.mjs', input: 'tests', needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND] },
  {
    check: 'check-test-integrity.mjs',
    input: 'tests+source',
    needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND],
    via: 'test-integrity.mjs',
  },
  {
    check: 'check-gate-sentinels.mjs',
    input: 'tests+sentinels',
    needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND],
    via: 'gate-sentinels.mjs',
  },
  {
    check: 'check-import-effects.mjs',
    input: 'tests+source',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'il lit un AST TypeScript, jamais des lignes de texte' },
  },
  {
    check: 'check-component-props.mjs',
    input: 'fixed-files',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'il lit des interfaces TypeScript par motif, pas du texte libre à interpréter' },
  },
  {
    check: 'check-ci-commands.mjs',
    input: 'workflows+package.json',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'les `run:` sont découpés par le module partagé (scripts/lib/ci-commands.mjs)' },
  },
  {
    check: 'check-node-version.mjs',
    input: 'runtime+config',
    needs: [],
    exempt: {
      [IMMUNITY.NON_VACUOUS]: 'il compare trois définitions de version ; l’absence de l’une EST le verdict, il n’y a pas de corpus à lire',
    },
  },
  {
    check: 'check-shared-db.mjs',
    input: 'env+artifact+network',
    needs: [IMMUNITY.NON_VACUOUS],
    exempt: { [IMMUNITY.PROSE_BLIND]: 'il lit des variables d’environnement, pas du code' },
  },
  {
    check: 'check-automations.mjs',
    input: 'logs',
    needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.STORED_FIELDS, IMMUNITY.SUBJECT_IDENTIFIED],
    via: 'automation-evidence.mjs',
    exempt: { [IMMUNITY.PROSE_BLIND]: 'il ne lit pas de code source, il lit les annotations d’un run' },
  },
  {
    check: 'check-audit.mjs',
    input: 'process',
    needs: [],
    exempt: {
      [IMMUNITY.NON_VACUOUS]: 'le verdict vient du code de sortie de `npm audit`, pas d’un corpus lu',
    },
  },
  {
    check: 'check-performance.mjs',
    input: 'process+network',
    needs: [],
    exempt: {
      [IMMUNITY.NON_VACUOUS]: 'il mesure des durées sur un serveur lancé pour l’occasion ; mesurer zéro serait un échec de build, pas un vert silencieux',
    },
  },
  {
    check: 'check-vercel-pins.mjs',
    input: 'config+network',
    needs: [],
    exempt: {
      [IMMUNITY.NON_VACUOUS]: 'il interroge des épingles de déploiement ; l’absence de réponse est traitée comme un échec par le script lui-même',
    },
  },
  {
    check: 'check-e2e-writes.mjs',
    input: 'source',
    needs: [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND],
    // Ce contrôle lit des SCRIPTS et juge du texte : sa non-vacuité (aucun
    // fichier lu ⇒ sortie 2) et sa cécité à la prose (commentaires blanchis)
    // vivent dans le module qui juge, et elles y sont NOMMÉES.
    via: 'e2e-writes.mjs',
  },
  {
    check: 'check-release-coherence.mjs',
    input: 'artifact+network+config',
    needs: [IMMUNITY.NON_VACUOUS],
    // La garantie de non-vacuité (aucun fichier annoncé ⇒ refus) vit dans le
    // module qui compare, et elle est NOMMÉE ici plutôt que recopiée. Le module
    // s'appelait `release-coherence.mjs` jusqu'au 2026-09-13 : il portait cinq
    // métiers, et c'est `compareLatest` — donc `release-compare.mjs` — qui porte
    // cette preuve.
    via: 'release-compare.mjs',
    exempt: {
      [IMMUNITY.PROSE_BLIND]: 'il lit un fichier de données (latest.yml) et des octets d’installeur, jamais du code source',
    },
  },
];

/**
 * Ce qui, dans la source, prouve chaque immunité.
 *
 * Pour la vacuité, plusieurs formes sont recevables — elles refusent toutes de
 * conclure sur un corpus vide : la couche partagée (`assertScanned(`), les
 * sorties explicites (`process.exit(2)`), le refus d'une liste vide
 * (`if (!files.length)`), et le compteur déjà lu par les modules partagés
 * (`scanned.commands === 0`, `scanned.modules > 0`). Ce qui n'est PAS
 * recevable : ne rien dire, et imprimer un ✅ sur zéro élément.
 */
const PROOF = {
  [IMMUNITY.NON_VACUOUS]:
    /assertScanned\(|process\.exit\(2\)|!files\.length|files\.length === 0|COMPONENTS\.length === 0|scanned\.\w+\s*(?:===|>)\s*0/,
  [IMMUNITY.PROSE_BLIND]: /source-text\.mjs|maskProse|maskComments|readMasked|stripComments|maskTemplateLiterals|blankComments/,
  // La preuve est un APPEL, pas une phrase : une mention dans un commentaire ne
  // doit pas suffire à certifier l'immunité (c'est le défaut que ce dépôt
  // pourchasse — de la prose lue comme du code).
  [IMMUNITY.STORED_FIELDS]: /evidenceFromAnnotations\(|evidenceAnnotation\(/,
  [IMMUNITY.SUBJECT_IDENTIFIED]: /EVIDENCE_TITLE|"workflow"|'workflow'/,
};

/**
 * L'inventaire tient-il, vu du disque ?
 *
 * @param {{
 *   sources?: Record<string, string>,   // nom de script → source
 *   libs?: Record<string, string>,      // nom de lib → source
 *   present?: string[],                 // les scripts réellement présents
 *   inventory?: object[],               // l'inventaire à juger (défaut : celui du dépôt)
 * }} input
 * @returns {{ checked: number, problems: string[], exempted: { check: string, immunity: string, reason: string }[] }}
 */
export function auditGuardImmunity({ sources = {}, libs = {}, present = [], inventory = GUARD_INVENTORY } = {}) {
  const problems = [];
  const exempted = [];
  const entries = inventory ?? GUARD_INVENTORY;
  const inventoried = new Set(entries.map((e) => e.check));

  // 1. Un contrôle non déclaré est un contrôle dont personne ne sait ce qu'il
  //    prouve : un inventaire qui se laisse dépasser ne vaut rien.
  for (const script of present) {
    if (!inventoried.has(script)) {
      problems.push(`« ${script} » n’est pas déclaré dans l’inventaire — ajoutez son entrée (ce qu’il lit, ce qu’il doit immuniser).`);
    }
  }
  // 2. Une entrée périmée (le script a disparu) doit tomber aussi, sinon
  //    l'inventaire garde des garanties sur du code qui n'existe plus.
  for (const entry of entries) {
    if (!present.includes(entry.check) && present.length > 0) {
      problems.push(`l’inventaire déclare « ${entry.check} », introuvable dans scripts/ — retirez l’entrée.`);
    }
  }

  for (const entry of entries) {
    const source = sources[entry.check];
    // Une exemption est jugée MÊME quand la source est illisible : une raison
    // muette est un trou déclaratif, pas une conséquence de la lecture.
    for (const [immunity, reason] of Object.entries(entry.exempt ?? {})) {
      if (!String(reason ?? '').trim()) {
        problems.push(`${entry.check} : exemption « ${immunity} » sans raison — une exemption muette est un trou.`);
      } else {
        exempted.push({ check: entry.check, immunity, reason });
      }
    }
    if (source === undefined) continue;
    for (const need of entry.needs ?? []) {
      if (!PROOF[need]) {
        problems.push(`${entry.check} : immunité inconnue « ${need} » — elle ne peut être prouvée.`);
        continue;
      }
      if (PROOF[need].test(source)) continue;
      // Le fait doit être visible soit dans le contrôle, soit dans la lib qu'il
      // délègue explicitement (une garantie portée par un module partagé reste
      // une garantie — à condition qu'elle soit NOMMÉE).
      const via = entry.via ? libs[entry.via] : null;
      if (via !== null && via !== undefined && PROOF[need].test(via)) continue;
      problems.push(
        `${entry.check} : immunité « ${need} » non prouvée` +
          (entry.via ? ` (ni dans le contrôle, ni dans ${entry.via})` : '') +
          '. Ajoutez la preuve, ou une exemption motivée.',
      );
    }
  }
  return { checked: entries.length, problems, exempted };
}

/**
 * Lit l'inventaire depuis un dépôt réel : les scripts présents et leurs sources.
 * @param {{ root: string, readFile: (p: string) => string, list: (dir: string) => string[] }} input
 * @returns {{ present: string[], sources: Record<string, string>, libs: Record<string, string> }}
 */
export function readInventoryFromDisk({ root, readFile, list }) {
  const scriptsDir = `${root}/scripts`;
  const libsDir = `${scriptsDir}/lib`;
  const present = list(scriptsDir).filter((f) => /^check-.*\.mjs$/.test(f)).sort();
  const sources = {};
  for (const file of present) {
    try {
      sources[file] = readFile(`${scriptsDir}/${file}`);
    } catch {
      /* illisible : la vacuité du contrôle est son affaire, pas la nôtre */
    }
  }
  const libs = {};
  for (const file of list(libsDir)) {
    if (!/\.mjs$/.test(file)) continue;
    try {
      libs[file] = readFile(`${libsDir}/${file}`);
    } catch {
      /* idem */
    }
  }
  return { present, sources, libs };
}

/** Vrai quand le dépôt porte bien l'inventaire qu'il prétend (utilitaire de test). */
export function inventoryFileExists(root, name = 'guard-immunity.mjs') {
  return existsSync(`${root}/scripts/lib/${name}`);
}

/** Lit un fichier en texte, avec `null` plutôt qu'une exception (confiance nulle). */
export function safeRead(pathname) {
  try {
    return readFileSync(pathname, 'utf8');
  } catch {
    return null;
  }
}
