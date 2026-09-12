#!/usr/bin/env node
/**
 * Garde-fou « une seule base pour tout le monde ».
 *
 *   npm run check:shared-db                      (dans la chaîne qualité)
 *   npm run check:shared-db -- --dist dist              (artefact web)
 *   npm run check:shared-db -- --dist electron-ui-dist  (UI du bureau)
 *
 * Ce qu'il refuse : qu'un build destiné à un utilisateur (l'installeur Windows,
 * le déploiement web) parte en pointant vers une AUTRE base Supabase que la base
 * partagée (`scripts/lib/shared-project.mjs` nomme la seule qui compte). Sans ce
 * contrôle, deux installations peuvent lire deux bases différentes et chaque
 * utilisateur croit que les autres voient la même chose — le pire des états,
 * parce qu'il ne produit aucune erreur, seulement des données absentes.
 *
 * DEUX LECTURES, PARCE QUE LA VÉRITÉ N'EST PAS LA MÊME
 * ---------------------------------------------------
 *   • les fichiers d'environnement (`--mode`), qui disent ce que Vite *lira* au
 *     prochain build — c'est là qu'une dérive se prépare ;
 *   • l'artefact construit (`--dist`), qui dit ce qui est *réellement embarqué*
 *     dans le JavaScript livré — c'est là qu'une dérive se prouve. Un `.env`
 *     peut être juste et le bundle faux (un `--mode` oublié, une variable
 *     injectée par la plateforme, un cache) : seule la lecture du paquet tranche.
 *
 * Un mode utilisateur dont l'environnement est INTROUVABLE n'est pas un échec :
 * sans `VITE_SUPABASE_URL` l'application refuse de démarrer
 * (`MISSING_CONFIG_MESSAGE`, aucun repli) — il n'existe donc aucun état où un
 * build sans ces variables pourrait pointer quelque part en silence. Le script
 * le dit au lieu de le taire.
 *
 * Sortie : 0 si tout ce qui est lisible est sur la bonne base, 1 sinon, 2 si
 * l'invocation est fautive (aucune source lisible du tout).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  ALLOWED_DIVERGENCE,
  SHARED_PROJECT_REF,
  SHARED_PROJECT_URL,
  USER_FACING_MODES,
  projectRefOf,
} from './lib/shared-project.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** Vite's own precedence: `.env.[mode].local` > `.env.[mode]` > `.env.local` > `.env`. */
function envFilesFor(mode) {
  return [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env'].map((f) => join(ROOT, f));
}

/**
 * The value a Vite build in `mode` would resolve for `key`, or null.
 * @param {string} mode
 * @param {string} key
 * @returns {string | null}
 */
function resolved(mode, key) {
  for (const file of envFilesFor(mode)) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${key}=`));
    if (!line) continue;
    // Vite keeps the quoted/unquoted value verbatim; only the surrounding
    // whitespace and optional quotes are stripped here.
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return null;
}

const problems = [];
const notes = [];
let readable = 0;

/** ── 1. What each user-facing mode would build with ─────────────────────── */
for (const mode of USER_FACING_MODES) {
  const url = resolved(mode, 'VITE_SUPABASE_URL');
  const exception = ALLOWED_DIVERGENCE.find((d) => d.mode === mode);
  if (!url) {
    notes.push(`mode ${mode} : aucun VITE_SUPABASE_URL lisible (rien à vérifier ici)`);
    continue;
  }
  readable += 1;
  const ref = projectRefOf(url);
  if (ref === SHARED_PROJECT_REF) {
    console.log(`✅ mode ${mode} → base partagée (${ref})`);
    continue;
  }
  if (exception && ref === exception.projectRef) {
    // The exception is only an exception when it says so itself.
    const mismatch = Object.entries(exception.requires ?? {}).find(
      ([key, expected]) => resolved(mode, key) !== expected,
    );
    if (mismatch) {
      problems.push(
        `mode ${mode} → ${ref} : l'exception « ${exception.because} » exige ` +
          `${mismatch[0]}=${mismatch[1]} (lu : ${resolved(mode, mismatch[0]) ?? 'absent'}) — ` +
          `sans quoi une base de test se présente comme la production`,
      );
      continue;
    }
    console.log(`➖ mode ${mode} → base déclarée hors production (${ref}, ${exception.because})`);
    continue;
  }
  problems.push(
    `mode ${mode} → ${ref ?? 'ref illisible'} au lieu de la base partagée ${SHARED_PROJECT_REF} : ` +
      `cette installation ne verrait pas les mêmes données que les autres`,
  );
}

/** ── 2. What the built bundle ACTUALLY embeds (`--dist`) ────────────────── */
const distFlag = process.argv.indexOf('--dist');
const distDirs =
  distFlag !== -1
    ? [process.argv[distFlag + 1]].filter(Boolean)
    : process.argv.includes('--dist')
      ? []
      : [];

for (const dir of distDirs) {
  const target = resolvePath(ROOT, dir);
  if (!existsSync(target)) {
    problems.push(`artefact introuvable : ${dir}`);
    continue;
  }
  const files = [];
  const walk = (p) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(?:js|html|json)$/i.test(entry)) files.push(full);
    }
  };
  walk(target);

  // The anon key is public by design and lives in the bundle too; what must NOT
  // appear is a different project's URL.
  const refs = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)/gi)) {
      refs.add(match[1]);
    }
  }
  if (refs.size === 0) {
    problems.push(
      `${dir} : aucune URL Supabase dans ${files.length} fichier(s) — l'artefact ne peut pas être vérifié ` +
        `(et une application qui ne joint aucune base ne sert personne)`,
    );
    continue;
  }
  const wrong = [...refs].filter((r) => r !== SHARED_PROJECT_REF);
  if (wrong.length > 0) {
    problems.push(
      `${dir} embarque une autre base : ${wrong.join(', ')} (attendu ${SHARED_PROJECT_REF}) — ` +
        `cet artefact ne partagera pas les données des autres installations`,
    );
    continue;
  }
  console.log(`✅ ${dir} embarque la base partagée (${files.length} fichier(s) lus, ${SHARED_PROJECT_URL})`);
  readable += 1;
}

/** ── Verdict ────────────────────────────────────────────────────────────── */
for (const note of notes) console.log(`⏳ ${note}`);

if (problems.length > 0) {
  console.error('\n❌ Base de données non partagée :');
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    `\n   La base partagée est ${SHARED_PROJECT_REF} (scripts/lib/shared-project.mjs). ` +
      `Tout build destiné aux utilisateurs doit y pointer, sinon chacun voit ses propres données.`,
  );
  process.exit(1);
}

if (readable === 0) {
  console.error(
    '\n❌ Rien à vérifier : aucun environnement lisible et aucun artefact fourni. ' +
      'Un contrôle qui n’examine rien n’est pas un contrôle vert — passez `--dist <dossier>` ' +
      'ou définissez VITE_SUPABASE_URL.',
  );
  process.exit(2);
}

console.log(`\n✅ Tout ce qui est livrable pointe vers la base partagée (${SHARED_PROJECT_REF}).`);
