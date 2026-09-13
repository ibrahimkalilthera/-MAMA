#!/usr/bin/env node
/**
 * ─── La sauvegarde est-elle RÉELLE ? On la remet, et on recompte ─────────────
 *
 *   npm run backup:roundtrip -- --from .backup/live
 *   npm run backup:roundtrip -- --from .backup/live --url http://127.0.0.1:54321     (pile locale)
 *
 * Une sauvegarde qu'on n'a jamais REMISE est une hypothèse. Ce contrôle ferme
 * exactement ce trou, et il le fait comme un journal de bord : il ne croit ni le
 * script de sauvegarde, ni celui de restauration — il recompte la cible LUI-MÊME,
 * table par table, et compare avec ce que la sauvegarde DÉCLARE.
 *
 * Trois choses, et chacune a coûté quelque chose dans ce dépôt :
 *
 *   1. **Le sujet est la base PARTAGÉE.** Une sauvegarde de la mauvaise base
 *      restaure avec succès des données que personne n'utilise : le manifeste
 *      nomme le projet, et la preuve refuse une sauvegarde qui ne vient pas de
 *      `rpcjdohfxwukbqngbprw` — c'est la même règle que `check:shared-db`,
 *      appliquée à l'aller-retour.
 *   2. **Les lignes non restaurables sont NOMMÉES, pas tolérées.** Les comptes
 *      `auth.users` ne voyagent pas par l'API REST, donc les lignes qui les
 *      référencent (`user_profiles`, `app_settings.updated_by`,
 *      `calendar_notes.created_by`) ne peuvent pas toutes revenir dans une cible
 *      fraîche. Le contrôle calcule EXACTEMENT le même ensemble que la
 *      restauration, et exige l'égalité sur le reste : une ligne « oubliée »
 *      reste rouge même si le total a l'air bon.
 *   3. **Le vide est dit.** Une école sans données d'élèves produit une preuve
 *      verte et vide : le verdict nomme donc les tables MÉTIER qui étaient vides
 *      des deux côtés, pour qu'un vert ne se lise pas comme « vos données sont
 *      sauvées » quand il n'y a pas de données.
 *
 * Codes de sortie : 0 aller-retour prouvé · 1 divergence (une table ne concorde
 * pas) · 2 indécis (sauvegarde ou cible illisible — on ne félicite personne).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BACKUP_TABLES, BUSINESS_TABLES, tablesAreSound } from './lib/db-tables.mjs';
import { contentFingerprint, decryptPayload, payloadFingerprint, verifyManifest } from './lib/backup-manifest.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { SHARED_PROJECT_REF, projectRefOf } from './lib/shared-project.mjs';

const SPECS = new Map(BACKUP_TABLES.map((t) => [t.name, t]));

/**
 * Ce que la sauvegarde déclare, ce que la cible contient — et l'écart.
 *
 * Module PUR : aucune requête, aucun disque. C'est lui qui est éprouvé par les
 * tests, et c'est ce qui permet de fabriquer les cas d'échec (une table en
 * moins, une ligne non restaurable comptée à tort) sans réseau.
 *
 * Tous les champs sont facultatifs : le jugement a des valeurs par défaut, et
 * c'est ce qui permet aux cas de test de fabriquer un échec précis (une table en
 * moins, une ligne non restaurable comptée à tort) sans construire un dossier.
 *
 * @param {{
 *   manifest?: object|null,                               // manifeste de la sauvegarde
 *   backup?: Record<string, object[]>|null,               // tables telles que sauvegardées
 *   target?: Record<string, number|null>,                 // lignes réellement présentes dans la cible
 *   authIds?: Set<string>|string[],                       // comptes auth.users de la cible
 *   sharedRef?: string,                                   // projet partagé attendu
 *   specs?: Map<string, {name: string, pk: string, authRef?: string}>,
 * }} [input]
 * @returns {{
 *   problems: string[],
 *   rows: Array<{ name: string, declared: number, restorable: number, present: number|null|undefined, skipped: number, ok: boolean }>,
 *   emptyBusiness: string[],
 *   declared: number,
 *   restored: number,
 * }}
 */
export function judgeRoundtrip({
  manifest = null,
  backup = null,
  target = {},
  authIds = new Set(),
  sharedRef = SHARED_PROJECT_REF,
  specs = SPECS,
} = {}) {
  const problems = [];
  const rows = [];
  const empty = { problems, rows, emptyBusiness: [], declared: 0, restored: 0 };
  if (!manifest || typeof manifest !== 'object') {
    return { ...empty, problems: ['manifeste absent ou illisible — une sauvegarde sans manifeste ne dit pas ce qu’elle contient'] };
  }
  if (!backup || typeof backup !== 'object') {
    return { ...empty, problems: ['contenu absent ou illisible — rien à remettre'] };
  }
  if (!specs.size || !tablesAreSound([...specs.values()])) {
    return { ...empty, problems: ['inventaire de tables absent ou incohérent — on ne juge pas un aller-retour sans savoir quoi compter'] };
  }
  const known = new Set([...specs.keys()]);
  const ids = authIds instanceof Set ? authIds : new Set(authIds ?? []);

  // 1. Le sujet : la base partagée, sinon la preuve ne dit rien du parc.
  if (sharedRef && projectRefOf(manifest.project ?? '') !== sharedRef) {
    problems.push(
      `la sauvegarde vient de « ${manifest.project || '(projet inconnu)'} » — ` +
        `la base PARTAGÉE est ${sharedRef} : une restauration réussie sur une autre base ne prouve rien pour le parc`,
    );
  }

  let declared = 0;
  let restored = 0;
  for (const [name, tableRows] of Object.entries(backup)) {
    const list = Array.isArray(tableRows) ? tableRows : [];
    const spec = specs.get(name) ?? { name, pk: 'id' };
    // La même règle que la restauration, écrite ICI et pas empruntée : une ligne
    // n'est restaurable que si son compte de référence existe dans la cible.
    const restorable = spec.authRef
      ? list.filter((row) => {
          const ref = spec.authRef === 'id' ? row?.id : row?.[spec.authRef];
          return ref == null || ids.has(ref);
        })
      : list;
    const present = target[name];
    const skipped = list.length - restorable.length;
    if (present !== restorable.length) {
      problems.push(
        `« ${name} » : ${present ?? '(non comptée)'} ligne(s) dans la cible, ${restorable.length} attendue(s)` +
          (skipped ? ` (${skipped} non restaurable(s) — compte auth absent de la cible)` : ''),
      );
    }
    if (!known.has(name)) problems.push(`« ${name} » est dans la sauvegarde mais absente de l’inventaire — une table que rien ne compte`);
    declared += list.length;
    restored += restorable.length;
    rows.push({ name, declared: list.length, restorable: restorable.length, present, skipped, ok: present === restorable.length });
  }

  // 2. Une table de l'inventaire absente du contenu : le manifeste la déclarait,
  //    donc son absence est un trou, pas une table vide.
  for (const declaredTable of manifest.tables ?? []) {
    if (!(declaredTable.name in backup)) {
      problems.push(`« ${declaredTable.name} » est déclarée par le manifeste mais absente du contenu`);
    }
  }

  // 3. Le vide, nommé : c'est ce qui empêche un vert de se lire comme une
  //    promesse sur des données qui n'existent pas.
  // Seules les tables RÉELLEMENT jugées peuvent être dites « vides » : une table
  // absente du contenu est déjà un problème nommé plus haut, et la compter comme
  // vide ferait passer un trou pour une case vide.
  const emptyBusiness = BUSINESS_TABLES.map((t) => t.name).filter(
    (name) => name in backup && (backup[name]?.length ?? 0) === 0,
  );

  return { problems, rows, emptyBusiness, declared, restored };
}

/** Lit un `.env` sans écraser une variable déjà posée (convention du dépôt). */
function readEnvFile(pathname) {
  const out = {};
  if (!existsSync(pathname)) return out;
  for (const line of readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const valueOf = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };

  const FROM = valueOf('--from');
  if (!FROM) {
    console.error('❌ --from <dossier de sauvegarde> requis (celui écrit par `npm run backup:db`).');
    process.exit(2);
  }
  const dir = resolve(FROM);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`❌ ${manifestPath} introuvable — un contenu sans manifeste ne dit pas ce qu'il contient.`);
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const encryptedPath = join(dir, 'payload.json.enc');
  const plaintextPath = join(dir, 'payload.json');
  const sourcePath = existsSync(encryptedPath) ? encryptedPath : plaintextPath;
  if (!existsSync(sourcePath)) {
    console.error(`❌ ni payload.json.enc ni payload.json dans ${dir} — rien à juger.`);
    process.exit(2);
  }
  let payload;
  try {
    payload = sourcePath === encryptedPath
      ? decryptPayload(readFileSync(sourcePath), process.env.BACKUP_PASSPHRASE ?? '')
      : readFileSync(sourcePath);
  } catch (error) {
    console.error(`❌ déchiffrement impossible : ${error.message} — sans la phrase, la sauvegarde est un fichier mort.`);
    process.exit(2);
  }

  const env = { ...readEnvFile(join(dirname(import.meta.dirname), '.env')), ...process.env };
  const BASE = (valueOf('--url') || env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
  if (!BASE || !SERVICE) {
    console.error(
      '⚠️  cible illisible (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents) — RIEN n’a été jugé.\n' +
        '   Un contrôle qui ne peut pas regarder ne félicite personne.',
    );
    process.exit(2);
  }

  const backup = JSON.parse(payload.toString('utf8'))?.tables ?? null;
  // L'intégrité d'abord, et par le module qui la définit : un contenu retouché ou
  // tronqué doit être refusé AVANT qu'on parle d'aller-retour.
  const integrity = verifyManifest(manifest, {
    payloadSha256: payloadFingerprint(payload),
    tables: Object.entries(backup ?? {}).map(([name, rows]) => ({
      name,
      rows: Array.isArray(rows) ? rows.length : 0,
      sha256: contentFingerprint(Array.isArray(rows) ? rows : []),
    })),
  });
  if (integrity.length) {
    console.error('❌ la sauvegarde ne correspond pas à son manifeste :');
    for (const p of integrity) console.error(`   • ${p}`);
    process.exit(1);
  }

  const HDR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const target = {};
  const uncountable = [];
  for (const name of Object.keys(backup ?? {})) {
    const res = await fetch(`${BASE}/rest/v1/${name}?select=*&limit=0`, {
      headers: { ...HDR, Prefer: 'count=exact', Range: '0-0' },
    });
    const declared = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    if (!Number.isFinite(declared)) uncountable.push(`${name} (HTTP ${res.status})`);
    target[name] = Number.isFinite(declared) ? declared : null;
  }
  if (uncountable.length) {
    console.error(`❌ table(s) illisible(s) dans la cible : ${uncountable.join(', ')} — rien n’a été jugé.`);
    process.exit(2);
  }

  const ids = new Set();
  let authOk = true;
  for (let page = 1; page <= 20 && authOk; page += 1) {
    const res = await fetch(`${BASE}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers: HDR });
    if (!res.ok) {
      authOk = false;
      break;
    }
    const users = (await res.json())?.users ?? [];
    for (const u of users) ids.add(u.id);
    if (users.length < 1000) break;
  }
  if (!authOk) {
    console.error('❌ comptes de la cible illisibles (auth/v1/admin/users) — la part « non restaurable » serait devinée, donc rien n’est jugé.');
    process.exit(2);
  }

  const verdict = judgeRoundtrip({ manifest, backup, target, authIds: ids });

  console.log(`🔎 aller-retour — ${manifest.tables.length} table(s) déclarée(s), cible ${BASE}`);
  console.log(`   sauvegarde prise le ${manifest.takenAt} depuis ${manifest.project}`);
  for (const row of verdict.rows) {
    const skipped = row.skipped ? ` · ${row.skipped} non restaurable(s)` : '';
    console.log(
      `   ${row.ok ? '✅' : '❌'} ${row.name.padEnd(16)} ${String(row.present ?? '?').padStart(5)} dans la cible / ` +
        `${String(row.restorable).padStart(5)} attendue(s)${skipped}`,
    );
  }
  if (verdict.emptyBusiness.length) {
    console.log(
      `   ⚠️  tables métier VIDES des deux côtés : ${verdict.emptyBusiness.join(', ')} — ` +
        'la preuve dit que le tuyau marche, pas que des données d’école ont été sauvées',
    );
  }

  if (verdict.problems.length) {
    console.error(`\n❌ aller-retour NON prouvé (${verdict.problems.length} divergence(s)) :`);
    for (const p of verdict.problems) console.error(`   • ${p}`);
    process.exit(1);
  }

  // `--no-evidence` est une couture de test : une suite qui lance le script ne
  // doit pas déposer une preuve au nom du job qui la fait tourner (le mandat
  // `AUTOMATION_EVIDENCE` le fait déjà, mais un test qui l'exporterait par
  // accident ne doit pas pouvoir parler).
  publishEvidence({
    acted: true,
    count: verdict.restored,
    reason:
      `sauvegarde de la base PARTAGÉE (${SHARED_PROJECT_REF}) remise et recomptée table par table : ` +
      `${verdict.restored} ligne(s) attendues et retrouvées sur ${verdict.rows.length} table(s)` +
      (verdict.emptyBusiness.length ? ` ; tables métier vides : ${verdict.emptyBusiness.join(', ')}` : ''),
  });
  console.log(`\n✅ aller-retour prouvé : ${verdict.restored} ligne(s) sur ${verdict.rows.length} table(s) recomptées dans la cible.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
