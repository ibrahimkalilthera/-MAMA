#!/usr/bin/env node
/**
 * verify-electron-csp.mjs — la CSP du PAQUET WINDOWS est-elle réellement
 * appliquée ? On le mesure, on ne l'affirme pas.
 *
 *   npm run verify:electron-csp          (lance le vrai Electron, fenêtres cachées)
 *
 * ─── Pourquoi une preuve d'exécution ────────────────────────────────────────
 * `npm run check:csp-origins` juge la POLITIQUE (texte) et `tests/electron-csp-policy.test.ts`
 * juge le CÂBLAGE (fonctions pures, lecture de `main.cjs`). Aucun des deux ne dit
 * si un navigateur REFUSE vraiment un `@import` externe dans l'installeur. C'est
 * le même partage que pour le site : `check:csp-origins` lit, `verify-csp-guard`
 * visite le site déployé dans un vrai Chrome. Ici, le terrain est le disque.
 *
 * ─── Les trois épreuves, chacune contre un témoin ───────────────────────────
 *   1. le CANAL EN-TÊTE, sur une page sonde : `@import` externe et police
 *      externe bloqués, script/feuille/image/police LOCAUX intacts ;
 *   2. l'ARTEFACT RÉEL (`electron-ui-dist/index.html`) sous la même politique :
 *      zéro violation, et le bundle se charge (une requête `/assets/*.js` répond 200) ;
 *   3. le CANAL META SEUL : sur une copie de l'artefact, aucune politique n'est
 *      branchée — si un `@import` externe injecté est quand même bloqué, c'est la
 *      meta du document qui le bloque, et le second verrou existe vraiment.
 *
 * ─── Le refus de la vacuité, et ce qui n'est PAS mesuré ─────────────────────
 * Sans binaire Electron, sans artefact, ou si aucune violation n'est collectée
 * dans une épreuve où il en faut, la commande sort en **2** : « je n'ai pas pu
 * regarder » n'est pas un vert. Et elle DIT sa limite : elle ne mesure que des
 * documents LOCAUX. Le repli HTTPS reçoit sa politique de Vercel, hors de portée
 * d'un poste sans réseau — c'est `scripts/verify-csp-guard.mjs` qui l'éprouve, sur
 * l'origine servie.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { DESKTOP_CSP } = require('../electron/csp-policy.cjs');

const ARTIFACT = path.join(ROOT, 'electron-ui-dist', 'index.html');

/** Le binaire Electron du dépôt, ou null — et « pas de binaire » est un refus, pas un silence. */
function electronBinary() {
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) return resolved;
  } catch {
    /* le paquet n'est pas installé : on essaie le chemin standard juste après */
  }
  const fallback = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  return fs.existsSync(fallback) ? fallback : null;
}

/**
 * Le programme hôte : il tourne DANS Electron et ne fait que mesurer. Il lit la
 * vraie politique et le vrai `installCsp` — jamais une copie : une sonde qui
 * rejouerait la politique de son côté prouverait sa propre prose.
 */
function hostSource({ root, artifact }) {
  return `// Hôte JETABLE de la preuve CSP (écrit par scripts/verify-electron-csp.mjs).
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = ${JSON.stringify(root)};
const ARTIFACT = ${JSON.stringify(artifact)};
const { DESKTOP_CSP, installCsp } = require(path.join(ROOT, 'electron', 'csp-policy.cjs'));

const out = { phases: [], csp: DESKTOP_CSP };
const isViolation = (text) => /violates the following Content Security Policy|violation of.*Content.Security.Policy/i.test(String(text));

function watch(win, bucket) {
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    const text = String(typeof first === 'string' ? first : (first?.message ?? args[1]?.message ?? ''));
    if (isViolation(text)) bucket.violations.push(text.slice(0, 160));
  });
}

function load(win, target, ms = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      setTimeout(() => resolve({ why, url: win.webContents.getURL() }), 900);
    };
    win.webContents.once('did-finish-load', () => finish('loaded'));
    win.webContents.once('did-fail-load', (_e, code, desc) => finish('fail ' + code + ' ' + desc));
    setTimeout(() => finish('timeout'), ms);
    win.loadURL(target).catch((error) => finish('throw ' + error.message));
  });
}

async function measure(win) {
  try {
    return await win.webContents.executeJavaScript(
      '({ titre: document.title, couleur: getComputedStyle(document.body).color, image: document.querySelector("img") ? document.querySelector("img").naturalWidth : -1 })',
    );
  } catch (error) {
    return { erreur: String(error && error.message) };
  }
}

app.whenReady().then(async () => {
  // Les pages sonde vivent dans le dossier TEMPORAIRE du lancement (le dossier
  // de cet hôte, créé par le parent), jamais dans le dépôt : une sonde qui écrit
  // chez elle laisse un résidu si le processus meurt avant son nettoyage, et un
  // résidu non suivi dans l'arbre est exactement ce qu'on ne veut pas d'un
  // contrôle. (Pas d'accent grave dans ce commentaire : il vit dans un gabarit
  // de chaîne, et un accent grave le terminerait.)
  const tmp = path.join(__dirname, 'run');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'probe'), { recursive: true });

  // ── Épreuve 1 : le canal EN-TÊTE, sur une page sonde ──────────────────────
  fs.writeFileSync(path.join(tmp, 'probe', 'probe.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(tmp, 'probe', 'probe.woff2'), Buffer.alloc(2048, 7));
  fs.writeFileSync(path.join(tmp, 'probe', 'data.json'), '{"ok":true}');
  fs.writeFileSync(
    path.join(tmp, 'probe', 'probe.css'),
    '@import "https://external.invalid/ext.css";\\n' +
      '@font-face { font-family: Probe; src: url("./probe.woff2") format("woff2") }\\n' +
      '@font-face { font-family: Ext; src: url("https://external.invalid/ext.woff2") format("woff2") }\\n' +
      'body { color: rgb(1, 2, 3); font-family: Probe }\\n',
  );
  fs.writeFileSync(path.join(tmp, 'probe', 'probe.js'), 'document.title = "LOCAL_JS_RAN";');
  fs.writeFileSync(
    path.join(tmp, 'probe', 'page.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./probe.css"></head>' +
      '<body><img src="./probe.png"><script src="./probe.js"></script></body></html>',
  );

  installCsp(session.defaultSession);
  const headerWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const headerBucket = { violations: [] };
  watch(headerWindow, headerBucket);
  const headerLoad = await load(headerWindow, 'file:///' + path.join(tmp, 'probe', 'page.html').replace(/\\\\/g, '/'));
  out.phases.push({ name: 'en-tête', ...headerLoad, violations: headerBucket.violations, ...(await measure(headerWindow)) });

  // ── Épreuve 2 : l'artefact RÉEL, sous la même politique ───────────────────
  const assetWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const assetBucket = { violations: [] };
  watch(assetWindow, assetBucket);
  const assets = [];
  session.defaultSession.webRequest.onCompleted((details) => {
    if (/\\.js(\\?|$)/.test(details.url) && details.statusCode === 200) assets.push(details.url);
  });
  const artifactLoad = await load(assetWindow, 'file:///' + ARTIFACT.replace(/\\\\/g, '/'), 9000);
  out.phases.push({ name: 'artefact', ...artifactLoad, violations: assetBucket.violations, bundleCharge: assets.length });

  // ── Épreuve 3 : le canal META SEUL, session neuve, aucun en-tête branché ──
  const copy = path.join(tmp, 'copie');
  fs.cpSync(path.dirname(ARTIFACT), copy, { recursive: true });
  const copiedHtml = fs.readFileSync(path.join(copy, 'index.html'), 'utf8');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(copiedHtml);
  out.metaDansLArtefact = meta ? meta[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null;
  fs.writeFileSync(
    path.join(copy, 'index.html'),
    copiedHtml.replace(
      '</body>',
      '<link rel="stylesheet" href="https://external.invalid/injecte.css"><img src="https://external.invalid/injecte.png" alt=""></body>',
    ),
  );
  const metaSession = session.fromPartition('proof-meta-seule');
  const metaWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'proof-meta-seule' } });
  const metaBucket = { violations: [] };
  const metaAssets = [];
  watch(metaWindow, metaBucket);
  metaSession.webRequest.onCompleted((details) => {
    if (/\\.js(\\?|$)/.test(details.url) && details.statusCode === 200) metaAssets.push(details.url);
  });
  const metaLoad = await load(metaWindow, 'file:///' + path.join(copy, 'index.html').replace(/\\\\/g, '/'), 9000);
  out.phases.push({ name: 'meta-seule', ...metaLoad, violations: metaBucket.violations, bundleCharge: metaAssets.length });

  process.stdout.write('\\n__PROOF__' + JSON.stringify(out) + '__END__\\n');
  app.exit(0);
});

setTimeout(() => {
  process.stdout.write('\\n__PROOF__' + JSON.stringify({ ...out, globalTimeout: true }) + '__END__\\n');
  app.exit(0);
}, 60000);
`;
}

const checks = [];
const fail = (message) => checks.push({ ok: false, message });
const pass = (message) => checks.push({ ok: true, message });

function main() {
  const binary = electronBinary();
  if (!binary) {
    console.error('❌ Rien à mesurer : aucun binaire Electron (npm run electron:runtime).');
    process.exit(2);
  }
  if (!fs.existsSync(ARTIFACT)) {
    console.error(`❌ Rien à mesurer : l'artefact du poste est absent (${ARTIFACT}).\n   Construisez-le d'abord : npm run electron:ui`);
    process.exit(2);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mama-electron-csp-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"csp-proof","version":"0.0.0","main":"host.cjs"}\n');
    fs.writeFileSync(path.join(dir, 'host.cjs'), hostSource({ root: ROOT, artifact: ARTIFACT }), 'utf8');
    const run = spawnSync(binary, [dir], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    const stdout = String(run.stdout ?? '');
    const raw = /__PROOF__(.*?)__END__/s.exec(stdout);
    if (!raw) {
      console.error('❌ Aucun rapport rendu par Electron — la mesure n’a pas eu lieu.');
      console.error(String(run.stderr ?? '').slice(-800));
      process.exit(2);
    }
    const report = JSON.parse(raw[1]);
    judge(report);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('CSP du poste — deux canaux, mesurés dans Electron');
  for (const check of checks) console.log(`   ${check.ok ? '✅' : '❌'} ${check.message}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} épreuve(s) non tenue(s) : le paquet Windows n’est PAS protégé comme annoncé.`);
    process.exit(1);
  }
  console.log(`\n✅ La politique du poste est appliquée sur les deux canaux (en-tête et meta), ${checks.length} épreuve(s) tenue(s).`);
}

function judge(report) {
  const phase = (name) => report.phases.find((p) => p.name === name) ?? { violations: [] };
  const header = phase('en-tête');
  const artifact = phase('artefact');
  const metaOnly = phase('meta-seule');

  if (report.globalTimeout) fail('la mesure a dépassé son délai : rapport incomplet');
  if (report.csp !== DESKTOP_CSP) fail('la sonde n’a pas lu la politique du module — mesure invalide');

  // 1. L'en-tête bloque VRAIMENT l'externe, et laisse passer le local.
  // La forme du message est celle de Chromium, et on l'exige : la ressource EST
  // nommée, ET la directive qui l'a refusée. Une violation d'une autre ressource
  // ne doit pas pouvoir tenir lieu de preuve.
  const headerText = (header.violations ?? []).join(' | ');
  if (!(headerText.includes('https://external.invalid/ext.css') && headerText.includes('style-src'))) {
    fail('l’@import EXTERNE n’a pas été refusé par la politique du poste (canal en-tête)');
  } else pass('l’@import externe est refusé par l’en-tête (style-src)');
  if (!(headerText.includes('https://external.invalid/ext.woff2') && headerText.includes('font-src'))) {
    fail('la police EXTERNE n’a pas été refusée (canal en-tête)');
  } else pass('la police externe est refusée par l’en-tête (font-src)');
  if (header.titre !== 'LOCAL_JS_RAN') fail(`le script local n’a pas tourné (titre = ${header.titre}) — la politique éteint l’application`);
  else pass('le script local tourne sous la politique');
  if (header.couleur !== 'rgb(1, 2, 3)') fail(`la feuille locale ne s’est pas appliquée (couleur = ${header.couleur})`);
  else pass('la feuille locale s’applique sous la politique');
  if (header.image !== 1) fail(`l’image locale ne s’est pas chargée (naturalWidth = ${header.image})`);
  else pass('l’image locale se charge sous la politique');

  // 2. L'artefact réel démarre sans violation, et son bundle arrive.
  if ((artifact.violations ?? []).length > 0) {
    fail(`l’artefact réel produit ${artifact.violations.length} violation(s) sous sa propre politique :\n      ${artifact.violations.join('\n      ')}`);
  } else pass('l’artefact réel (electron-ui-dist) démarre sans aucune violation');
  if (!(artifact.bundleCharge > 0)) fail('le bundle de l’artefact n’a pas été chargé (aucune réponse 200 sur /assets/*.js)');
  else pass(`le bundle de l’artefact se charge (${artifact.bundleCharge} réponse(s) 200)`);

  // 3. La meta seule suffit : aucun en-tête branché sur cette session.
  if (!report.metaDansLArtefact) fail('l’artefact ne porte AUCUNE meta CSP — le second verrou n’existe pas');
  else if (report.metaDansLArtefact !== DESKTOP_CSP) fail('la meta de l’artefact ne dit pas la politique du module (les deux canaux ont divergé)');
  else pass('l’artefact porte la politique du module en meta');
  const metaText = (metaOnly.violations ?? []).join(' | ');
  if (!metaText.includes('injecte.css') || !metaText.includes('injecte.png')) {
    fail('sans en-tête, l’externe injecté dans la copie n’a PAS été bloqué — la meta ne protège pas l’installeur seule');
  } else pass('la meta SEULE refuse l’externe injecté (feuille et image)');
  if (!(metaOnly.bundleCharge > 0)) fail('sous la meta seule, le bundle local ne se charge plus : la politique casse l’application');
  else pass(`les ressources locales passent sous la meta seule (${metaOnly.bundleCharge} réponse(s) 200)`);
}

main();
