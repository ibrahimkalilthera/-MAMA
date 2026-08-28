#!/usr/bin/env node
/**
 * Contrôle de performance avant déploiement Vercel.
 *
 * Déroulé :
 *   1. `vite build` (build de production)
 *   2. `vite preview` (sert dist/ en local)
 *   3. Audit Lighthouse (mobile, catégorie performance)
 *   4. Échec (exit 1) si le score passe sous PERF_THRESHOLD (défaut : 0.7)
 *
 * Usage :
 *   node scripts/check-performance.mjs
 *   PERF_THRESHOLD=0.8 node scripts/check-performance.mjs
 *   CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" node scripts/check-performance.mjs
 */

import { spawn, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const THRESHOLD = Number(process.env.PERF_THRESHOLD ?? 0.7);
const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const URL = `http://localhost:${PORT}/`;
const CHROME_PATH = process.env.CHROME_PATH;

if (Number.isNaN(THRESHOLD) || THRESHOLD <= 0 || THRESHOLD > 1) {
  console.error(`❌ PERF_THRESHOLD invalide : ${process.env.PERF_THRESHOLD}`);
  process.exit(1);
}

const wait = promisify(setTimeout);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} a échoué (code ${code})`))));
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await wait(1000);
  }
  throw new Error(`Le serveur de preview ne répond pas sur ${url}`);
}

async function main() {
  console.log('🏗️  Build de production…');
  await run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'production'], { cwd: root });

  console.log(`🚀 Démarrage du serveur de preview sur le port ${PORT}…`);
  const preview = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let previewError = '';
  preview.stdout.on('data', (d) => { previewError += d; });
  preview.stderr.on('data', (d) => { previewError += d; });

  let chrome;
  try {
    await waitForServer(URL);

    console.log('🔍 Lancement de l\'audit Lighthouse (mobile)…');
    const flags = {
      output: 'json',
      onlyCategories: ['performance'],
      logLevel: 'error',
      port: undefined,
    };
    const chromeFlags = ['--headless=new', '--no-sandbox', '--disable-gpu'];
    chrome = await launch({
      chromePath: CHROME_PATH,
      chromeFlags,
    });
    flags.port = chrome.port;

    const result = await lighthouse(URL, flags, undefined);
    const score = result?.lhr?.categories?.performance?.score;
    const runtimeError = result?.lhr?.runtimeError?.code;

    if (runtimeError) {
      console.error(`❌ L'audit a échoué : ${runtimeError}`);
      process.exitCode = 1;
      return;
    }
    if (score === null || score === undefined) {
      console.error('❌ Score de performance introuvable dans le rapport Lighthouse.');
      process.exitCode = 1;
      return;
    }

    const pct = Math.round(score * 100);
    console.log(`📊 Score de performance : ${pct}/100 (seuil requis : ${Math.round(THRESHOLD * 100)})`);

    if (score < THRESHOLD) {
      console.error(`❌ Déploiement BLOQUÉ : performance ${pct}/100 < seuil ${Math.round(THRESHOLD * 100)}.`);
      console.error('   Améliorez la performance avant de redéployer, ou relancez avec PERF_THRESHOLD plus bas.');
      process.exitCode = 1;
    } else {
      console.log('✅ Performance au-dessus du seuil — déploiement autorisé.');
    }
  } catch (err) {
    console.error(`❌ Erreur pendant le contrôle : ${err.message}`);
    if (previewError) console.error('   Sortie du serveur preview :', previewError.slice(0, 300));
    process.exitCode = 1;
  } finally {
    if (chrome) {
      try { await chrome.kill(); } catch { /* ignore */ }
    }
    preview.kill('SIGTERM');
  }
}

main();
