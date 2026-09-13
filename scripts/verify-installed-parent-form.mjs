#!/usr/bin/env node
/**
 * verify-installed-parent-form.mjs — la fiche parent, dans l'application
 * INSTALLÉE depuis l'installeur que le CANAL sert.
 *
 * ─── Pourquoi cette preuve, et pas une autre ────────────────────────────────
 * Le correctif « l'adresse n'est plus obligatoire » a d'abord été prouvé dans un
 * `app.asar` extrait d'un installeur et ouvert à la main. Cette preuve-là a une
 * faiblesse précise : elle lit des octets, elle n'exécute rien. Ce que
 * l'utilisateur a signalé, lui, est un COMPORTEMENT — un formulaire qui refuse
 * l'enregistrement — et un comportement ne se prouve qu'en le déclenchant.
 *
 * Cette preuve fait donc ce qu'un administrateur fait, sur le runner :
 *   1. elle demande au CANAL ce qu'un poste téléchargerait (`/releases/latest`,
 *      sans jeton — un canal qu'on ne sait relire qu'authentifié n'est pas prouvé) ;
 *   2. elle télécharge cet installeur et vérifie, EN FLUX, la TAILLE et le SHA512
 *      que le flux annonce (les octets qu'un poste recevra, pas d'autres) ;
 *   3. elle l'INSTALLE en silence, et lance le binaire installé ;
 *   4. elle se connecte par l'interface réelle, ouvre Parents → « Ajouter
 *      Parent/Tuteur », et demande au NAVIGATEUR ce qu'il impose ;
 *   5. elle nettoie : désinstallation, compte éphémère supprimé, processus purgés.
 *
 * ─── Ce qu'elle refuse, et pourquoi ─────────────────────────────────────────
 * Elle refuse de conclure sur un dialogue qu'elle n'a pas ouvert, sur un champ
 * qu'elle n'a pas trouvé, et sur un « le navigateur laisse passer » qui serait
 * vrai même quand le nom manque : sans la preuve inverse, un gate lu de travers
 * rendrait le même verdict que la correction. Le verdict lui-même est pur
 * (`scripts/lib/parent-form-contract.mjs`), donc chaque refus se prouve sans
 * navigateur ni runner.
 *
 * Secrets requis : SUPABASE_SERVICE_ROLE_KEY (compte éphémère, supprimé en fin de
 * run). VITE_SUPABASE_URL est publique. Aucun jeton GitHub : le canal est relu
 * exactement comme un poste le relit.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

import { publishedInstaller } from './lib/channel-installer.mjs';
import { assertEphemeralTarget, ephemeralEmail, pickEphemeralUser } from './lib/ephemeral-accounts.mjs';
import { sweepOrphanElectron } from './lib/orphan-chrome.mjs';
import { PARENT_FIELD_PATTERNS, parentFormVerdict } from './lib/parent-form-contract.mjs';
import { replayableWrite } from './lib/transient-http.mjs';

const UA = 'mama-installed-proof';
const PASS = 'Audit-Pass-2026!';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const envFile = readFileSync('.env', 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.replace(/^["']|["']$/g, '');
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const BASE = (get('VITE_SUPABASE_URL') || '').replace(/\/$/, '');
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const REPO =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';

const WORK = join(tmpdir(), `mama-installed-${Date.now()}`);
const INSTALL_DIR = join(WORK, 'app');
const SETUP = join(WORK, 'setup.exe');
const USER_DATA = join(tmpdir(), `mama-installed-ud-${Date.now()}`);
const PORT = 9600 + Math.floor(Math.random() * 300);

let uid = null;
let app = null;
let browser = null;
let installed = null;

/** Une lecture Supabase sous la forme `{ status, body }`, ce que le rejeu exige. */
async function raw(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: HDR, ...init });
  const text = await r.text();
  try {
    return { status: r.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: r.status, body: null };
  }
}

/**
 * Rien ne survit à ce run : une application installée non désinstallée, un
 * compte éphémère non supprimé ou un processus Electron orphelin sont exactement
 * ce qu'un run suivant découvre — et un résidu non nommé passe pour un succès.
 */
async function cleanup() {
  try {
    if (browser) await Promise.race([browser.close().catch(() => {}), wait(5000)]);
  } catch {
    /* déjà fermé */
  }
  browser = null;
  try {
    app?.kill();
  } catch {
    /* déjà mort */
  }
  app = null;
  await sweepOrphanElectron().catch(() => {});
  if (installed?.uninstaller) {
    spawnSync(installed.uninstaller, ['/S'], { stdio: 'ignore', timeout: 180000 });
    await wait(4000);
  }
  if (uid) {
    const del = await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: HDR }).catch(() => null);
    console.log(`🧹 compte éphémère supprimé${del ? ` (HTTP ${del.status})` : ' (réponse illisible)'}`);
    uid = null;
  }
  rmSync(WORK, { recursive: true, force: true });
  rmSync(USER_DATA, { recursive: true, force: true });
}

/** Un refus qui nettoie d'abord : un échec ne doit pas laisser d'application installée. */
async function fail(title, problems = [], warnings = []) {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  for (const w of warnings) console.error(`   ⚠️  ${w}`);
  await cleanup();
  process.exit(1);
}

/**
 * Ce qu'un POSTE demande au canal : la tête publiée, ses actifs, et le flux.
 * Tout est anonyme — c'est la seule façon de prouver ce que voit une machine qui
 * n'a pas de jeton, et c'est aussi celle qui ne dépend d'aucun secret du dépôt.
 */
async function channelFacts() {
  const head = await fetch(`https://github.com/${REPO}/releases/latest`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    redirect: 'follow',
  });
  if (!head.ok) return { error: `l'endpoint du poste a répondu HTTP ${head.status} (/releases/latest)` };
  const tag = String((await head.json().catch(() => null))?.tag_name ?? '').trim();
  if (!tag) return { error: "l'endpoint du poste n'a nommé aucune version (/releases/latest)" };

  const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA },
  });
  if (!rel.ok) return { error: `le release ${tag} est injoignable (HTTP ${rel.status})` };
  const body = await rel.json();
  const assets = (body.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url }));

  const feedAsset = assets.find((a) => a.name === 'latest.yml');
  if (!feedAsset) {
    return { error: `le release ${tag} ne porte pas de latest.yml (actifs : ${assets.map((a) => a.name).join(', ') || 'aucun'})` };
  }
  const feedRes = await fetch(feedAsset.browser_download_url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!feedRes.ok) return { error: `latest.yml du release ${tag} illisible (HTTP ${feedRes.status})` };

  return { tag, assets, feedText: await feedRes.text() };
}

/**
 * Télécharger l'installeur EN FLUX et vérifier, chemin faisant, la taille et le
 * SHA512 que le flux annonce. Relire le fichier après coup ne prouverait rien du
 * canal : c'est le chemin qui doit être celui d'un poste.
 */
async function downloadAndVerify(installer) {
  const res = await fetch(installer.url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) return { error: `l'installeur annoncé est injoignable (HTTP ${res.status})` };
  // Le dossier doit exister AVANT d'écrire : la première version de ce script
  // téléchargeait 129 Mo et mourait sur un `ENOENT` de son propre dossier —
  // mesuré sur le premier run du runner, pas en relecture.
  mkdirSync(WORK, { recursive: true });
  // Écrit en flux (129 Mo ne tiennent pas deux fois en mémoire pour rien) et
  // haché chemin faisant, donc rien n'est relu après coup.
  const hash = createHash('sha512');
  const fd = openSync(SETUP, 'w');
  let size = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      writeSync(fd, chunk);
      size += chunk.length;
    }
  } finally {
    closeSync(fd);
  }
  const sha512 = hash.digest('base64');
  if (installer.size !== null && installer.size !== size) {
    return { error: `taille servie ${size} ≠ taille annoncée ${installer.size} pour ${installer.name}` };
  }
  if (sha512 !== installer.sha512) {
    return {
      error: `sha512 servi ${sha512.slice(0, 12)}… ≠ sha512 annoncé ${installer.sha512.slice(0, 12)}… pour ${installer.name}`,
    };
  }
  return { size, sha512 };
}

/** Installer en silence, puis rendre le binaire INSTALLÉ (un nom absent est un refus). */
function installSilently() {
  const r = spawnSync(SETUP, ['/S', `/D=${INSTALL_DIR}`], { stdio: 'ignore', timeout: 300000 });
  if (r.error) return { error: `lancement de l'installeur impossible : ${r.error.message}` };
  if (!existsSync(INSTALL_DIR)) return { error: `l'installeur a rendu ${r.status} sans créer ${INSTALL_DIR}` };
  const entries = readdirSync(INSTALL_DIR);
  const exe = entries.find((f) => /^MamaTheraFinance\.exe$/i.test(f));
  if (!exe) return { error: `aucun binaire installé dans ${INSTALL_DIR} (${entries.join(', ') || 'vide'})` };
  const uninstaller = entries.find((f) => /^Uninstall.*\.exe$/i.test(f)) ?? null;
  return { exe: join(INSTALL_DIR, exe), uninstaller: uninstaller ? join(INSTALL_DIR, uninstaller) : null, entries };
}

try {
  console.log(`🔎 canal — https://github.com/${REPO}/releases/latest (sans jeton)`);
  const facts = await channelFacts();
  if (facts.error) await fail('le canal n’a pas pu être lu', [facts.error]);

  const verdict = publishedInstaller({ text: facts.feedText, assets: facts.assets, tag: facts.tag });
  if (!verdict.ok) await fail(`le canal ${facts.tag} n’annonce pas un installeur utilisable`, verdict.problems, verdict.warnings);
  const { installer } = verdict;
  console.log(`   ✅ tête publiée ${facts.tag} · le flux annonce ${installer.name} (version ${installer.version})`);
  console.log(`   ✅ ${installer.size} octet(s) · sha512 ${installer.sha512.slice(0, 12)}… annoncés par le flux`);
  for (const w of verdict.warnings) console.log(`   ⚠️  ${w}`);

  const dl = await downloadAndVerify(installer);
  if (dl.error) await fail('les octets servis par le canal ne répondent pas à la promesse du flux', [dl.error]);
  console.log(`   ✅ téléchargé et rehaché : ${dl.size} octet(s), sha512 ${dl.sha512.slice(0, 12)}… — identiques au flux`);

  // S'arrêter ici sert quand l'INSTALLATION casse : la moitié « canal » se prouve
  // alors seule, au lieu d'être accusée avec elle. Aucune écriture en base n'a eu
  // lieu à ce stade, donc rien à nettoyer d'autre que le dossier de travail.
  if (process.argv.includes('--download-only')) {
    console.log('⏹  arrêt demandé après la vérification du flux (--download-only)');
    await cleanup();
    process.exit(0);
  }

  installed = installSilently();
  if (installed.error) await fail('l’installeur publié n’a pas produit d’application installée', [installed.error]);
  console.log(`🖥  installé : ${installed.exe}`);
  console.log(`   ✅ ${installed.entries.length} entrée(s), désinstalleur ${installed.uninstaller ? 'présent' : 'ABSENT'}`);

  // ── un admin éphémère, le temps d'ouvrir l'interface réelle ───────────────
  const email = ephemeralEmail('verify-installed');
  const created = await replayableWrite(
    () => raw('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PASS, email_confirm: true }) }),
    async () => {
      // `?email=` est ignoré par cette version de GoTrue (mesuré le 2026-09-13) :
      // on liste, puis on compare l'email exactement côté client.
      const probe = await raw('/auth/v1/admin/users?per_page=1000');
      const found = pickEphemeralUser(probe.body?.users, email);
      return found?.id ? { status: 200, body: { id: found.id } } : null;
    },
    { label: 'POST /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
  );
  if (!created.body?.id) await fail('compte éphémère non créé', [`${created.status} ${JSON.stringify(created.body ?? null).slice(0, 120)}`]);
  uid = created.body.id;
  assertEphemeralTarget(email); // jamais un compte réel, même si la sonde se trompait
  console.log(`✅ compte éphémère ${email}`);
  await wait(2500);
  const up = await fetch(`${BASE}/rest/v1/user_profiles?id=eq.${uid}`, {
    method: 'PATCH',
    headers: HDR,
    body: JSON.stringify({ role: 'admin' }),
  });
  console.log(up.status < 300 ? '✅ profil promu admin' : `⚠️ promotion profil HTTP ${up.status}`);

  // ── lancer le binaire INSTALLÉ, profil isolé, session vierge ─────────────
  console.log('🚀 lancement de l’application installée (session vierge, profil isolé)…');
  const swept = await sweepOrphanElectron();
  if (swept) console.log(`🧹 ${swept} processus Electron orphelin(s) purgé(s)`);
  app = spawn(installed.exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`], { stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 90 && !ws; i++) {
    try {
      ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      /* pas encore prêt */
    }
    if (!ws) await wait(1000);
  }
  if (!ws) {
    await fail('CDP injoignable — l’application installée n’a pas démarré', [
      'un installeur qui s’installe sans démarrer n’équipe aucun poste',
    ]);
  }

  browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  const targets = await browser.pages();
  const page = targets.find((p) => p.url().startsWith('file://')) || targets[0];
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));

  // ── connexion par l’interface réelle ────────────────────────────────────
  let emailSel = null;
  for (let i = 0; i < 40 && !emailSel; i++) {
    emailSel = (await page.$('input[type="email"]')) || (await page.$('input[placeholder*="@"]'));
    if (!emailSel) await wait(1000);
  }
  if (!emailSel) {
    const diag = await page.evaluate(() => ({ url: location.href, body: document.body?.innerText.slice(0, 200) ?? '' })).catch(() => ({}));
    await fail('écran de connexion introuvable dans l’application installée', [JSON.stringify(diag)]);
  }
  await page.type('input[type="email"], input[placeholder*="@"]', email);
  const pwd = await page.$('input[type="password"]');
  if (pwd) await pwd.type(PASS);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /se connecter|login|connecter/i.test(x.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), { timeout: 60000 }).catch(() => {});
  await wait(5000);
  const loggedIn = await page.evaluate(
    () => document.body.innerText.includes('Tableau de bord') || document.body.innerText.includes('Résumé Exécutif'),
  );
  if (!loggedIn) {
    await fail('connexion échouée dans l’application installée', [
      'sans session, la fiche parent ne peut pas être ouverte — la preuve serait muette',
    ]);
  }
  console.log('✅ connecté dans l’application INSTALLÉE');

  // ── ouvrir Parents → « Ajouter Parent/Tuteur » ──────────────────────────
  const opened = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('a, button, [role="menuitem"], li')].find(
      (el) => /parent/i.test(el.textContent || '') && (el.textContent || '').trim().length < 30,
    );
    if (nav) nav.click();
    return Boolean(nav);
  });
  console.log(opened ? '🎯 entrée de navigation « Parents » cliquée' : '⚠️ entrée « Parents » introuvable');
  await wait(4000);

  // LE BOUTON D'AJOUT, PAS L'ENTRÉE DE NAVIGATION. La barre latérale est faite de
  // `<button>` elle aussi, donc « un bouton qui parle de parent » attrape le MENU :
  // mesuré au deuxième run — `bouton « Parents » cliqué`, puis aucun dialogue. On
  // cherche donc un libellé d'ACTION (ajouter/nouveau/créer), et un repli refuse
  // explicitement les libellés de navigation.
  const addPattern = /(ajouter|nouveau|nouvelle|cr[ée]er|add|new)[^a-z]{0,14}(parent|tuteur|guardian)/i;
  const navPattern = /^(parents?|annuaire des parents|parent directory|tuteurs?|guardians?)$/i;
  const visibleButtons = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((x) => x.offsetParent)
        .map((x) => (x.textContent || '').trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, 40),
    );
  let clicked = null;
  for (let i = 0; i < 10 && !clicked; i++) {
    clicked = await page.evaluate(
      ([addSrc, navSrc]) => {
        const mk = (src) => new RegExp(src, 'i');
        const buttons = [...document.querySelectorAll('button')].filter((x) => x.offsetParent);
        const text = (x) => (x.textContent || '').trim();
        const hit =
          buttons.find((x) => mk(addSrc).test(text(x))) ??
          buttons.find((x) => /parent|tuteur|guardian/i.test(text(x)) && !mk(navSrc).test(text(x)));
        if (!hit) return null;
        hit.click();
        return text(hit).slice(0, 40);
      },
      [addPattern.source, navPattern.source],
    );
    if (!clicked) await wait(1500);
  }
  if (!clicked) {
    await fail('le bouton « Ajouter Parent/Tuteur » est introuvable dans l’app installée', [
      JSON.stringify(await visibleButtons()),
    ]);
  }
  console.log(`🎯 bouton « ${clicked} » cliqué`);

  // Le dialogue est attendu, pas supposé : une fenêtre lente ne doit pas se lire
  // comme un formulaire absent, et l'absence doit être dite AVEC ce que l'écran
  // montrait.
  let open = false;
  for (let i = 0; i < 12 && !open; i++) {
    open = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"]')].some((d) => /parent|tuteur|guardian/i.test(d.getAttribute('aria-label') || '')),
    );
    if (!open) await wait(1500);
  }
  if (!open) {
    const diag = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label')),
      body: (document.body?.innerText || '').slice(0, 200),
    }));
    await fail('la fiche parent ne s’est pas ouverte dans l’application installée', [
      JSON.stringify(diag),
      JSON.stringify(await visibleButtons()),
    ]);
  }
  await wait(1200);

  // ── lire la fiche, et demander au NAVIGATEUR ce qu’il impose ────────────
  const observed = await page.evaluate(
    (patterns) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
        /parent|tuteur|guardian/i.test(d.getAttribute('aria-label') || ''),
      );
      if (!dialog) {
        return {
          error: 'aucun dialogue dont le libellé parle d’un parent',
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label')),
        };
      }

      const form = dialog.querySelector('form');
      const els = [...dialog.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'checkbox');
      const fields = els.map((el) => ({
        label: (el.parentElement?.querySelector('label')?.textContent || '').trim(),
        placeholder: el.getAttribute('placeholder') || '',
        required: el.required === true,
      }));
      const mk = (src) => new RegExp(src, 'i');
      const ident = (i) => `${fields[i].label} ${fields[i].placeholder}`;
      const setValue = (el, value) => {
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const idx = {
        name: fields.findIndex((_, i) => mk(patterns.name).test(ident(i))),
        primaryPhone: fields.findIndex((_, i) => mk(patterns.primaryPhone).test(ident(i))),
        address: fields.findIndex((_, i) => mk(patterns.address).test(ident(i))),
      };
      const fill = (i, v) => {
        if (i >= 0) setValue(els[i], v);
      };
      // Le gate se lit TROIS fois : rempli (référence), sans adresse, puis sans
      // nom. Sans la troisième lecture, un « valide » pourrait n’être qu’un gate
      // lu de travers — et rendrait le même verdict que la correction.
      fill(idx.name, 'Preuve Parent');
      fill(idx.primaryPhone, '+223 70 00 00 00');
      fill(idx.address, '');
      const validWithoutAddress = form ? form.checkValidity() : null;
      fill(idx.name, '');
      const invalidWithoutName = form ? form.checkValidity() : null;
      return { fields, gate: { validWithoutAddress, invalidWithoutName }, hasForm: Boolean(form) };
    },
    {
      name: PARENT_FIELD_PATTERNS.name.source,
      primaryPhone: PARENT_FIELD_PATTERNS.primaryPhone.source,
      address: PARENT_FIELD_PATTERNS.address.source,
    },
  );

  if (observed.error) await fail('le dialogue parent a disparu entre l’ouverture et la lecture', [observed.error, JSON.stringify(observed.dialogs)]);
  if (!observed.hasForm) await fail('le dialogue parent n’a pas de formulaire — le gate du navigateur n’a pas pu être lu', []);

  const formVerdict = parentFormVerdict({ fields: observed.fields, gate: observed.gate });
  console.log(`\n📋 fiche parent — ${observed.fields.length} champ(s) lu(s) dans l’application installée`);
  for (const f of observed.fields) {
    console.log(`   ${f.required ? '✱' : ' '} ${f.label || '(sans libellé)'}${f.placeholder ? ` — « ${f.placeholder} »` : ''}`);
  }
  console.log(`   gate : valide sans adresse = ${observed.gate.validWithoutAddress} · invalide sans nom = ${observed.gate.invalidWithoutName}`);

  if (!formVerdict.ok) await fail('la fiche parent de l’application INSTALLÉE ne tient pas le contrat', formVerdict.problems, formVerdict.warnings);
  for (const w of formVerdict.warnings) console.log(`   ⚠️  ${w}`);
  console.log(
    `\n✅ PROUVÉ SUR L’INSTALLEUR PUBLIÉ (${facts.tag}, ${installer.name}) : l’adresse n’est ni \`required\` ni marquée obligatoire, ` +
      'le formulaire est valide avec elle vide, et invalide dès qu’un champ qui doit rester obligatoire (le nom) est vidé — ' +
      'donc la preuve n’est pas vacuité.',
  );

  await cleanup();
  console.log('🧹 application désinstallée, compte éphémère supprimé, aucun processus laissé derrière');
  process.exit(0);
} catch (error) {
  console.error('❌', error?.stack || error?.message || error);
  await cleanup();
  process.exit(1);
}
