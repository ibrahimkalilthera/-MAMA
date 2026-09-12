#!/usr/bin/env node
/**
 * publish-release.mjs — LE PUBLIEUR.
 *
 *   npm run release:publish              → un seul release, les octets vérifiés, en brouillon
 *   npm run release:promote              → ... puis promotion, et le flux relu comme un poste
 *   node scripts/publish-release.mjs --dry-run      (dit ce qu'il ferait, ne touche à rien)
 *
 * ─── Ce qu'il remplace, et le défaut qu'il ferme « par construction » ────────
 * La publication passait par `electron-builder --publish always`, et ce chemin a
 * payé DEUX FOIS le même défaut : electron-builder ouvre **un release par
 * cible** (une passe pour le NSIS, une pour le portable), donc deux brouillons
 * pour un même tag — l'un portant le blockmap, l'autre `latest.yml` et les exe.
 * Les artefacts se retrouvent **répartis entre deux releases**, aucun outil ne
 * les rassemble, et promouvoir le mauvais publie un release SANS `latest.yml` :
 * une mise à jour que personne ne voit. Les deux fois, la réparation a été une
 * main humaine sur l'API (consolider, supprimer, promouvoir).
 *
 * Ici, c'est ce programme qui téléverse, un fichier à la fois, dans **un seul**
 * release : la forme du release n'est plus décidée par un outil tiers mais par
 * le plan testable de `scripts/lib/release-publish.mjs`. À la fin, le release
 * contient les octets vérifiés **et rien d'autre** — quel que soit l'état dans
 * lequel il a été trouvé (rien, un brouillon partiel, deux brouillons hérités).
 *
 * ─── Trois principes, et pourquoi ceux-là ────────────────────────────────────
 *   • **on téléverse ce qu'on a VÉRIFIÉ, pas ce qu'on espère** : la liste des
 *     artefacts vient de `assetsToPublish` (donc de `latest.yml`, donc de ce que
 *     les postes lisent), et un artefact annoncé mais absent du disque fait
 *     REFUSER la publication ;
 *   • **le brouillon n'est pas une formalité, c'est un sas** : rien n'est
 *     visible avant que les octets TÉLÉVERSÉS aient été rehachés DEPUIS LE
 *     DÉPÔT et comparés à `latest.yml` (`--draft`). C'est le gate du dépôt qui
 *     sert de passeport, pas ce script ;
 *   • **la preuve finale est SANS jeton** : après promotion, le flux est relu à
 *     la façon d'un poste (aucune autorisation), parce qu'un canal qu'on ne sait
 *     relire qu'authentifié n'est pas prouvé pour une machine qui ne
 *     s'authentifie jamais.
 *
 * Ce qui reste à une main humaine : **monter la version**. Republier un numéro
 * publié n'atteint aucun poste, et ce script le refuse — mais il ne décide pas
 * à votre place qu'une fonctionnalité mérite une 1.0.6.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetsToPublish, parseLatestYml, releaseTag } from './lib/release-coherence.mjs';
import { publicationPlan } from './lib/release-publish.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PROMOTE = args.includes('--promote');
const DRY = args.includes('--dry-run');
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || 'release';
const releaseDir = join(root, dirArg);
const gateScript = 'scripts/check-release-coherence.mjs';

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = releaseTag(version);
const repo = pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

function fail(title, problems = []) {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

/** L'API JSON. Publier est une ÉCRITURE : elle exige un jeton. */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'release-publisher',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status} — ${String(text).slice(0, 200)}`);
  }
  return json;
}

/** L'empreinte calculée EN FLUX : 129 Mo ne doivent pas tenir en mémoire. */
async function sha256OfFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Téléverser UN fichier, en flux.
 *
 * Le flux n'est pas une élégance : l'installeur fait 129 Mo, et le porter en
 * mémoire pour le donner à `fetch` ferait payer deux fois (le fichier, puis sa
 * copie) sur une machine qui, par ailleurs, compile.
 */
function uploadAsset({ name, file, releaseId }) {
  return new Promise((resolve, reject) => {
    const size = statSync(file).size;
    const req = httpsRequest(
      {
        hostname: 'uploads.github.com',
        method: 'POST',
        path: `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        headers: {
          'User-Agent': 'release-publisher',
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(size);
          else reject(new Error(`téléversement de « ${name} » → HTTP ${res.statusCode} — ${d.slice(0, 160)}`));
        });
      },
    );
    req.on('error', reject);
    createReadStream(file).on('error', reject).pipe(req);
  });
}

/** Une pause SYNCHRONE : l'enchaînement publication → preuve ne doit pas rendre
 *  la main tant que le verdict n'est pas rendu. */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Le gate du dépôt, tel quel — c'est LUI qui décide, jamais ce script.
 *
 * `withoutToken` pour la relecture finale : le flux publié doit être vérifiable
 * à la façon d'un poste, donc sans autorisation. Le gate du brouillon, lui,
 * tourne avec le jeton (il lit des annotations d'API qui restent privées).
 *
 * `attempts` existe pour un défaut MESURÉ : juste après la promotion, la liste
 * **publique** des releases n'est pas encore à jour — le gate relu sans jeton a
 * lu « 0 release pour v… » sur un release qui venait d'être rendu visible. Ce
 * n'est pas une incohérence du flux, c'est une propagation : le remède est une
 * reprise bornée, jamais d'ignorer le verdict. Ce qui reste illisible après la
 * dernière tentative est un ÉCHEC — « je n'ai pas pu lire » n'est pas « c'est
 * bon ».
 *
 * @param {string} flag
 * @param {{ withoutToken?: boolean, label?: string, attempts?: number, delayMs?: number }} [options]
 */
function runGate(flag, { withoutToken = false, label, attempts = 1, delayMs = 4000 } = {}) {
  console.log(`\n── ${label || flag} ──`);
  const env = withoutToken ? { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } : process.env;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const last = attempt === attempts;
    try {
      execFileSync(process.execPath, [gateScript, flag, `--dir=${dirArg}`], {
        cwd: root,
        // La dernière tentative parle en clair : c'est son verdict qu'on lit.
        // Les précédentes sont conservées hors écran, sinon une reprise
        // noierait la sortie utile sous ses propres messages d'attente.
        stdio: last ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
        env,
      });
      return;
    } catch {
      if (last) {
        fail(`le gate a refusé (${flag}) — RIEN n’a été promu`, [
          'corrigez ce que le gate nomme ci-dessus, puis relancez : ce script est idempotent.',
        ]);
      }
      console.log(`   ⏳ pas encore lisible (tentative ${attempt}/${attempts}) — on réessaie dans ${Math.round(delayMs / 1000)} s`);
      sleepMs(delayMs);
    }
  }
}

// ── 1. Ce qu'on a le droit de publier ────────────────────────────────────────
const latestFile = join(releaseDir, 'latest.yml');
if (!existsSync(latestFile)) {
  fail(`${dirArg}/latest.yml introuvable — rien à publier`, [
    'Lance `npm run electron:build` (ou `npm run electron:release`) d’abord.',
  ]);
}
const latestText = readFileSync(latestFile, 'utf8');
const latest = parseLatestYml(latestText);
if (!latest) fail('latest.yml illisible — le flux ne peut pas être vérifié', ['version ou `path` absente']);
if (latest.version !== String(version)) {
  fail('le flux ne décrit pas la version du paquet', [
    `latest.yml annonce ${latest.version}, package.json déclare ${version}`,
  ]);
}
const dirNames = existsSync(releaseDir)
  ? readdirSync(releaseDir).filter((name) => {
      const file = join(releaseDir, name);
      return existsSync(file) && statSync(file).isFile();
    })
  : [];
const expected = assetsToPublish({ latest, dirNames });

const local = new Map();
for (const name of expected) {
  const file = join(releaseDir, name);
  if (!existsSync(file)) continue;
  local.set(name, { size: statSync(file).size, sha256: await sha256OfFile(file) });
}

// ── 2. Le plan ───────────────────────────────────────────────────────────────
const all = await api('/releases?per_page=100');
const sameTag = (all || []).filter((r) => r.tag_name === tag);
const plan = publicationPlan({ version, releases: sameTag, expected, local });

if (plan.problems.length) {
  fail(`publication refusée pour ${tag}`, plan.problems);
}

console.log(`🔎 ${tag} — ${sameTag.length} release(s) pour ce tag · plan : ${plan.action}`);
console.log(`   à publier : ${expected.join(', ')}`);
if (plan.target) console.log(`   cible : release #${plan.target.id} (brouillon)`);
for (const name of plan.skip) console.log(`   ⏭  déjà en place, mêmes octets : ${name}`);
for (const name of plan.upload) console.log(`   ⬆️  à téléverser : ${name} (${mb(local.get(name)?.size ?? 0)})`);
for (const name of plan.remove) console.log(`   🗑  en trop, à retirer : ${name}`);
for (const id of plan.deleteIds) console.log(`   🗑  brouillon en double, à supprimer : release #${id}`);

if (DRY) {
  console.log('\nℹ️  --dry-run : rien n’a été touché.');
  process.exit(0);
}
if (!token) {
  fail('publier demande un jeton d’écriture', ['pose GH_TOKEN (droits Contents: read/write) dans l’environnement.']);
}

// ── 3. Un seul release, et exactement les octets vérifiés ────────────────────
// La cible est tenue ICI et pas dans le plan : quand le plan dit « create », le
// release n'a pas encore d'identifiant — c'est le créer qui le lui donne.
let target = plan.target;
try {
  if (plan.action === 'create') {
    target = await api('/releases', {
      method: 'POST',
      body: {
        tag_name: tag,
        name: `MamaTheraFinance ${version}`,
        draft: true,
        body:
          `Canal de mise à jour du poste installé — ne pas télécharger à la main.\n\n` +
          `Installeur vérifié : ${latest.path} (${latest.files[0]?.size ?? '?'} octets).\n` +
          `Empreinte publiée par latest.yml : \`${latest.sha512}\`.\n`,
      },
    });
    console.log(`\n✅ release #${target.id} créé en BROUILLON pour ${tag}`);
  }

  // Les brouillons en double partent AVANT tout téléversement : à partir d'ici
  // il n'existe plus qu'un release pour ce tag, et c'est la cible.
  for (const id of plan.deleteIds) {
    await api(`/releases/${id}`, { method: 'DELETE' });
    console.log(`🗑  brouillon en double supprimé : release #${id}`);
  }

  for (const name of plan.remove) {
    const asset = (target?.assets ?? []).find((a) => a.name === name);
    if (!asset) continue;
    await api(`/releases/assets/${asset.id}`, { method: 'DELETE' });
    console.log(`🗑  retiré du release : ${name}`);
    target.assets = target.assets.filter((a) => a.id !== asset.id);
  }

  // Un actif du même nom mais d'AUTRES octets doit partir avant le nouveau :
  // sinon GitHub reçoit un doublon de nom, ou refuse, et le release garderait
  // les octets d'une exécution précédente — exactement ce que ce script existe
  // pour rendre impossible.
  for (const name of plan.upload) {
    const stale = (target?.assets ?? []).find((a) => a.name === name);
    if (stale) {
      await api(`/releases/assets/${stale.id}`, { method: 'DELETE' });
      console.log(`🗑  octets périmés retirés avant remplacement : ${name}`);
    }
    const size = await uploadAsset({ name, file: join(releaseDir, name), releaseId: target.id });
    console.log(`⬆️  téléversé : ${name} (${mb(size)})`);
  }
} catch (error) {
  fail('le téléversement a échoué — le release reste un BROUILLON, donc invisible', [
    String(error?.message ?? error),
    'relancez : ce script reprend où il en est (ce qui est déjà en place n’est pas retéléversé).',
  ]);
}

// ── 4. Le passeport : les octets TÉLÉVERSÉS répondent-ils à latest.yml ? ─────
runGate('--draft', { label: 'gate du brouillon — rehaché depuis le dépôt, c’est le passeport' });

if (!PROMOTE) {
  console.log(`\n✅ ${tag} : brouillon complet et cohérent. La promotion est le geste séparé :`);
  console.log('   npm run release:promote');
  process.exit(0);
}

// ── 5. La promotion, puis la preuve SANS jeton ───────────────────────────────
const promoted = await api(`/releases/${target.id}`, { method: 'PATCH', body: { draft: false } });
console.log(`\n🚀 promu : ${promoted?.tag_name} est publié (${promoted?.published_at}) — c’est le seul geste qui rend une version lisible par l’updater`);

runGate('--live', {
  withoutToken: true,
  attempts: 6,
  label: 'flux publié, relu SANS jeton — comme le fait un poste',
});
runGate('--channel', {
  attempts: 6,
  label: 'canal vivant (release publié le plus récent) + frein d’urgence',
});
console.log('\n✅ publication vérifiée de bout en bout sur le canal public.');
