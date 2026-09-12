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
 * « RIEN À JUGER » ET « ON M'A DEMANDÉ DE JUGER » SONT DEUX CHOSES DIFFÉRENTES
 * ---------------------------------------------------------------------------
 * Ce script tourne dans la chaîne qualité, donc AUSSI dans un checkout sans
 * aucun fichier d'environnement (le runner CI : `.env` est ignoré par git). La
 * première version traitait ce cas comme une faute et sortait en 2 — elle a fait
 * échouer quatre commits de suite sur le runner et bloqué le déploiement Vercel,
 * pour un contrôle qui prétendait lutter contre les faux verts. La règle juste
 * distingue donc :
 *   • **rien à juger** (aucun fichier d'environnement, aucun `--dist`, aucun
 *     `--live`) ⇒ not applicable, dit à voix haute, sortie 0. Il n'y a rien à
 *     diverger : un build ne peut même pas sortir de ce checkout ;
 *   • **on a demandé un avis et il est impossible** (un fichier d'environnement
 *     existe mais aucune valeur n'en sort ; un `--dist`/`--live` fourni mais
 *     illisible) ⇒ échec, sortie 2. Invérifiable n'est pas un vert.
 *
 * Sortie : 0 si tout ce qui est lisible est sur la bonne base (ou rien à
 * juger), 1 si quelque chose diverge, 2 si l'on a demandé un verdict impossible.
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
  assetUrlsIn,
  bareAssetRefs,
  projectRefOf,
  supabaseRefsIn,
} from './lib/shared-project.mjs';

// Racine surchargeable : les tests doivent pouvoir fabriquer un checkout SANS
// fichier d'environnement (c'est le cas du runner CI) et vérifier le verdict.
const ROOT = resolvePath(process.env.CHECK_SHARED_DB_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));

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

/**
 * Y a-t-il un fichier d'environnement dans ce checkout, quel qu'il soit ?
 * C'est ce qui sépare « rien à juger » de « on m'a demandé un verdict et je ne
 * peux pas le rendre » : un fichier présent qui ne résout rien est un problème,
 * son absence totale n'en est pas un.
 */
const anyEnvFilePresent = USER_FACING_MODES.some((mode) =>
  envFilesFor(mode).some((file) => existsSync(file)),
);

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

/** ── 3. Ce que sert le site DÉPLOYÉ (`--live`) ─────────────────────────────
 *
 * Les deux lectures précédentes portent sur ce que le dépôt produit. Celle-ci
 * porte sur ce que les utilisateurs reçoivent VRAIMENT, et elle est la seule à
 * pouvoir attraper une variable d'environnement posée dans le tableau de bord
 * de l'hébergeur — qui n'existe nulle part dans ce dépôt, donc qu'aucun fichier
 * ne peut contredire. Un site dont le paquet est juste et dont la variable a été
 * changée depuis sert l'ancienne base à tout le monde, sans un mot.
 */
const liveFlag = process.argv.indexOf('--live');
const liveTargets = liveFlag !== -1 ? [process.argv[liveFlag + 1]].filter(Boolean) : [];

/**
 * Télécharge une ressource en texte, avec un plafond de taille : un bundle
 * inattendu de 50 Mo ne doit pas transformer le contrôle en incident.
 * Injectable, donc testable sans réseau.
 */
async function fetchText(url, { fetchFn = fetch, maxBytes = 8 * 1024 * 1024 } = {}) {
  const res = await fetchFn(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error(`réponse trop volumineuse (${text.length} octets)`);
  return text;
}

for (const target of liveTargets) {
  const base = target.endsWith('/') ? target : `${target}/`;
  let html;
  try {
    html = await fetchText(base);
  } catch (e) {
    problems.push(`site déployé injoignable (${target}) : ${e?.message ?? e}`);
    continue;
  }
  // Largeur bornée et profondeur 2 : la page, puis ce que ses modules déclarent.
  // Un site juste se vérifie en quelques requêtes ; un site qui référence des
  // centaines de morceaux ne doit pas transformer ce contrôle en miroir complet.
  const MAX_ASSETS = 24;
  const queued = assetUrlsIn(html, base);
  const assets = new Set(queued);
  if (assets.size === 0) {
    problems.push(`${target} : aucun module trouvé dans la page — impossible de vérifier la base servie`);
    continue;
  }
  const seen = new Set();
  let refused = null;
  const queue = [...queued];
  while (queue.length > 0 && assets.size <= MAX_ASSETS) {
    const asset = queue.shift();
    let code;
    try {
      code = await fetchText(asset);
    } catch (e) {
      // Un morceau qui ne se télécharge pas n'est pas un verdict : la page peut
      // en référencer d'autres. Mais s'il n'en reste aucun de lisible, l'échec
      // ci-dessous le dira.
      refused = refused ?? `${asset} (${e?.message ?? e})`;
      continue;
    }
    for (const ref of supabaseRefsIn(code)) seen.add(ref);
    for (const rel of bareAssetRefs(code)) {
      const abs = new URL(rel, base).href;
      if (!assets.has(abs) && assets.size < MAX_ASSETS) {
        assets.add(abs);
        queue.push(abs);
      }
    }
  }
  if (seen.size === 0) {
    problems.push(
      `${target} : aucune référence Supabase lisible dans ${assets.size} module(s)` +
        (refused ? ` — premier refus : ${refused}` : '') +
        ` — un site dont on ne sait pas quelle base il sert n'est pas vérifié`,
    );
    continue;
  }
  const wrong = [...seen].filter((r) => r !== SHARED_PROJECT_REF);
  if (wrong.length > 0) {
    problems.push(
      `${target} SERT une autre base : ${wrong.join(', ')} (attendu ${SHARED_PROJECT_REF}) — ` +
        `tous les navigateurs qui ouvrent ce site voient des données séparées des autres postes`,
    );
    continue;
  }
  console.log(`✅ ${target} sert la base partagée (${assets.size} module(s) lus)`);
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
  const asked = anyEnvFilePresent || distDirs.length > 0 || liveTargets.length > 0;
  if (!asked) {
    // Cas du runner CI : aucun secret local, donc aucun build possible, donc
    // aucune dérive possible. Le dire clairement plutôt que de faire échouer
    // un commit pour un contrôle qui n'a rien à mesurer ici.
    console.log(
      '➖ non applicable : aucun fichier d’environnement dans ce checkout, aucun artefact ' +
        'fourni — un build ne peut pas sortir d’ici (l’application refuse de démarrer sans ces ' +
        'variables). La vérification qui compte pour les utilisateurs est faite ailleurs : sur ' +
        'l’artefact avant empaquetage, et sur le site déployé (workflow `shared-db-watch`).',
    );
    process.exit(0);
  }
  console.error(
    '\n❌ On a demandé un verdict, et il est impossible à rendre : ' +
      (anyEnvFilePresent ? 'un fichier d’environnement existe mais aucune valeur n’en sort. ' : '') +
      (distDirs.length > 0 ? 'un artefact a été fourni mais il ne contient aucune référence lisible. ' : '') +
      (liveTargets.length > 0 ? 'un site a été fourni mais il est injoignable ou muet. ' : '') +
      'Invérifiable n’est pas un vert.',
  );
  process.exit(2);
}

console.log(`\n✅ Tout ce qui est livrable pointe vers la base partagée (${SHARED_PROJECT_REF}).`);
