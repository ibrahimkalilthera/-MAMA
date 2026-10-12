#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-csp-guard.mjs — production CSP violation guard.
//
// Companion of the security-headers guard in .github/workflows/pdf-e2e.yml:
// the headers step proves the CSP header is SERVED, this script proves it is
// RESPECTED — the real app is navigated (logged in as a fresh ephemeral admin,
// every main page visited) and the run FAILS if any Content-Security-Policy
// violation is emitted in the process.
//
// Why navigation: a policy that blocks something the app genuinely uses (a
// connect-src endpoint, a font, an img-src blob:/data: used by the stamp,
// a style injection) surfaces immediately as a console
// « Refused to … violates the following Content Security Policy » error. The
// guard also asserts the header is present at all — a page without CSP cannot
// have violations, and would otherwise pass vacuously.
//
// Two violation channels are collected, both surviving page navigations:
//   1. CDP console/pageerror events matching CSP markers (Chrome always logs
//      a violation);
//   2. in-page `SecurityPolicyViolationEvent` listeners installed before any
//      page script runs (evaluateOnNewDocument), read back per page.
//
// Usage: node scripts/verify-csp-guard.mjs [--url https://…]
// Reads .env (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), same as
// scripts/verify-pdf-download.mjs. Exit 0 = header présent + zéro violation.
//
// ─── Le canari du collecteur, et pourquoi un zéro ne suffit pas ──────────────
// Un zéro ne vaut que si la mesure peut dire autre chose que zéro. Ce script
// concluait « Zéro violation CSP » sur la foi de deux canaux qu'il n'avait jamais
// vus fonctionner : un `evaluateOnNewDocument` refusé, ou un filtre `console` qui
// ne reconnaît plus la formulation de Chromium, rendait exactement le même
// verdict vert qu'une application réellement propre — le faux vert le plus
// coûteux qui soit, puisqu'il rassure.
//
// À chaque run, la garde injecte donc dans la page RÉELLE un refus CONNU — un
// script externe que la politique refuse (voir `scripts/lib/csp-canary.mjs`) — et
// exige que CHACUN des deux canaux l'ait vu, ressource ET directive nommées. Un
// seul canal muet, et la commande sort en **2** : « je n'ai pas pu regarder »
// n'est pas un vert. Le signal du canari est ensuite RETIRÉ du verdict — nommé et
// compté dans la sortie — sans quoi la garde échouerait sur son propre bruit.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CANARY_URL, canaryUrlVerdict, canaryVerdict, isCanarySignal } from './lib/csp-canary.mjs';
import { assertEphemeralTarget, ephemeralEmail, pickEphemeralUser } from './lib/ephemeral-accounts.mjs';
import { sweepOrphanPuppeteer } from './lib/orphan-chrome.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { replayableWrite, withTransientRetry } from './lib/transient-http.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const parseEnv = (p) => {
  const o = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  console.error('Introuvable: .env (SUPABASE_SERVICE_ROLE_KEY requis).');
  process.exit(1);
}
const env = parseEnv(envFile);
const supabaseBase = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseBase || !SERVICE_KEY) {
  console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = (process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'https://mama-thera-finance.vercel.app/').replace(/\/$/, '') + '/';
const KEEP = process.argv.includes('--keep');

const TS = Date.now().toString().slice(-6);
const EMAIL = ephemeralEmail('verify-csp');
const PASS = 'Audit-Pass-2026!';
let ephemeralUid = null;

// Deux briques, et la séparation EST le contrat — la même que dans le
// pixel-check PDF, parce que les deux chaînes ont payé le même 504 :
//   • `rawApi` ne retente rien : c'est la brique des ÉCRITURES, dont la reprise
//     passe par `replayableWrite` (sonde d'abord). Retenter une écriture depuis
//     ici doublerait la ligne que la sonde sert justement à ne pas créer.
//   • `api` retente les coupures de passerelle (429/502/503/504, erreurs de
//     transport), borné et journalisé : un gateway lent n'est pas un verdict sur
//     l'application. Un 4xx, lui, n'est jamais retenté — c'est une réponse.
const rawApi = async (path, opts = {}) => {
  const r = await fetch(`${supabaseBase}${path}`, { headers: HDR, ...opts });
  const t = await r.text();
  try {
    return { status: r.status, body: t ? JSON.parse(t) : null };
  } catch {
    // Un corps non-JSON (page HTML d'une passerelle) ne doit pas devenir une
    // erreur de SYNTAXE : c'est le statut qui compte, et un `JSON.parse` qui jette
    // masquerait le 504 derrière un « Unexpected token ».
    return { status: r.status, body: { _nonJson: t.slice(0, 200) } };
  }
};

const api = (path, opts = {}) => withTransientRetry(() => rawApi(path, opts), {
  label: `${opts.method || 'GET'} ${path} — `, log: (m) => console.log(`  ↻ ${m}`),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function createAccount() {
  // Un 504 tombe souvent APRÈS que le compte a été créé : sans uid, le
  // nettoyage n'aurait RIEN à supprimer et le compte resterait en base — le
  // résidu que le garde anti-résidus signale au run SUIVANT. La sonde le
  // retrouve par son email (unique côté GoTrue), donc le rejeu est sûr.
  const r = await replayableWrite(
    () => rawApi('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
    }),
    async () => {
      // `?email=` est ignoré par cette version de GoTrue (mesuré le 2026-09-13) :
      // on liste, puis on compare l'email exactement côté client.
      const probe = await rawApi('/auth/v1/admin/users?per_page=1000');
      const found = pickEphemeralUser(probe.body?.users, EMAIL);
      if (found?.id) {
        console.log('  ↻ compte éphémère : déjà créé — réutilisé');
        return { status: 200, body: { id: found.id } };
      }
      return null;
    },
    { label: 'POST /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
  );
  if (!r.body?.id) throw new Error(`création du compte échouée (${r.status})`);
  ephemeralUid = r.body.id;
  assertEphemeralTarget(EMAIL); // jamais un compte réel, même si la sonde se trompait
  await api(`/rest/v1/user_profiles?id=eq.${ephemeralUid}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'admin' }),
  });
  console.log(`✅ compte éphémère créé (${EMAIL})`);
}

async function cleanup() {
  try {
    if (ephemeralUid) {
      const del = await api(`/auth/v1/admin/users/${ephemeralUid}`, { method: 'DELETE' });
      console.log(`  🧹 compte éphémère supprimé (${del.status})`);
    }
  } catch (e) {
    console.error('  ⚠️ cleanup partiel:', e.message);
  }
}

// ── CSP collection ───────────────────────────────────────────────────────────
const CSP_RE = /Content Security Policy|violates the following|Refused to (load|execute|connect|frame|apply|send|evaluate|run)|blocked by Content Security Policy/i;
const violations = [];
const seen = new Set();

// Les pages principales, chacune exerçant script-src, style-src, connect-src,
// font-src et img-src (graphiques, cachets, notifications…). Déclarées ICI, et
// non dans le bloc qui les visite : la preuve publiée à la fin du run doit
// pouvoir dire combien d'entre elles ont réellement été ouvertes.
const PAGES = [
  ['Tableau de bord', /tableau de bord|dashboard/i],
  ['Paie', /paie|salaires|payroll/i],
  ['Dépenses', /d[eé]penses|expenses/i],
  ['Élèves', /[eé]l[eè]ves|students/i],
  ['Parents', /parents/i],
  ['Calendrier', /calendrier|calendar/i],
  ['Archives', /archives/i],
];
let visited = 0;
const pushViolation = (where, text) => {
  const key = where + '|' + text.slice(0, 120);
  if (seen.has(key)) return;
  seen.add(key);
  violations.push({ where, text: text.slice(0, 220) });
};

/** Returns a page hook: attaches console/pageerror listeners + the in-page
 *  SecurityPolicyViolationEvent collector (survives navigations via
 *  evaluateOnNewDocument). */
function armCspCollectors(page) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (CSP_RE.test(text)) pushViolation(page.url().replace(URL, '').slice(0, 50) || '(root)', `[${msg.type()}] ${text}`);
  });
  page.on('pageerror', (e) => {
    const s = String(e);
    if (CSP_RE.test(s)) pushViolation(page.url().replace(URL, '').slice(0, 50) || '(root)', `[pageerror] ${s}`);
  });
  page.evaluateOnNewDocument(() => {
    window.__cspGuard = window.__cspGuard || [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspGuard.push({ directive: e.violatedDirective || '?', blocked: e.blockedURI || '?' });
    });
  });
  return async (label) => {
    // Le relevé est un DRAIN : l'écouteur in-page accumule dans `window.__cspGuard`
    // et rien ne le vidait. Mesuré le 2026-10-12 en exécutant la garde : un canari
    // injecté une seule fois ressortait une fois PAR PAGE — sept violations du même
    // refus —, parce que l'application est une SPA et que le document ne change pas
    // d'un onglet à l'autre. Vider en lisant rend chaque événement une fois, sous
    // l'étiquette de la page où il a été relevé.
    const inPage = await page
      .evaluate(() => {
        const read = (window.__cspGuard || []).map((v) => `${v.directive} → ${v.blocked}`);
        // En place : l'écouteur fait `window.__cspGuard.push(...)`, il ne garde pas
        // de référence à l'ancien tableau.
        if (window.__cspGuard) window.__cspGuard.length = 0;
        return read;
      })
      .catch(() => []);
    for (const v of inPage) pushViolation(label, `[SecurityPolicyViolationEvent] ${v}`);
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let browser = null;
let fail = false;
const failMsg = (m) => { console.error('  ❌ ' + m); fail = true; };
/** Le canari n'a pas vu son propre refus : le run n'a RIEN mesuré (sortie 2). */
let canaryMute = null;

(async () => {
  try {
    // Startup sweep: kill Chrome orphans left by interrupted runs (Windows only).
    const swept = await sweepOrphanPuppeteer();
    if (swept) console.log(`🧹 ${swept} orphelin(s) Chrome puppeteer purgé(s)`);
    await createAccount();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      protocolTimeout: 120000,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const collect = armCspCollectors(page);

    // 1. The header must be present — a missing CSP would make the guard pass
    //    vacuously (no policy ⇒ no violation).
    const resp = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
    const csp = (resp.headers()['content-security-policy'] || '').trim();
    if (!csp) {
      failMsg('header Content-Security-Policy absent sur ' + URL + ' — la garde ne peut pas valider une page sans politique');
    } else {
      const directives = csp.split(';').map((d) => d.trim()).filter(Boolean);
      console.log('✅ CSP header présent (' + directives.length + ' directives)');
      for (const d of directives.slice(0, 12)) console.log('    · ' + d);
      if (!/script-src[^;]*'self'/.test(csp)) console.log('    ⚠️ script-src sans \'self\' — revoir la policy');
    }
    await wait(2500);

    // 2. Login through the real UI.
    const emailSel = await page.$('input[type="email"]') || await page.$('input[placeholder*="@"]');
    if (emailSel) {
      await page.type('input[type="email"], input[placeholder*="@"]', EMAIL);
      const pwd = await page.$('input[type="password"]');
      if (pwd) await pwd.type(PASS);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /se connecter|login/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await page.waitForFunction(() => !document.querySelector('input[type="email"]'), { timeout: 30000 }).catch(() => {});
      console.log('✅ connecté à ' + URL);
    }
    await wait(4000);

    // 2 bis. Le canari du collecteur : un refus CONNU, sur la page réelle, sous la
    //    vraie politique. Sans lui, « Zéro violation » est une phrase qu'un
    //    collecteur débranché prononce aussi bien qu'un collecteur sain.
    const canaryShape = canaryUrlVerdict();
    if (canaryShape) {
      // Le canari lui-même ne serait pas refusé : la garde accuserait son
      // instrument au lieu de ses canaux, alors on refuse AVANT le navigateur.
      canaryMute = `le canari n'est pas refusable : ${canaryShape}`;
    } else {
      const before = violations.length;
      const injected = await page
        .evaluate((url) => {
          // Un script EXTERNE : la politique du site l'interdit (`script-src 'self'`),
          // et Chromium le refuse AVANT toute requête — le canari ne dépend donc
          // d'aucun réseau. Il est retiré juste après : c'est une sonde, pas un résidu.
          const script = document.createElement('script');
          script.src = url;
          script.dataset.cspCanary = '1';
          document.head.appendChild(script);
          return true;
        }, CANARY_URL)
        .catch(() => false);
      if (!injected) {
        canaryMute = 'impossible d’injecter le canari dans la page — aucune mesure possible';
      } else {
        await wait(2500);
        await collect('canari');
        const verdict = canaryVerdict({ signals: violations.slice(before) });
        canaryMute = verdict.ok ? null : verdict.reason;
        // Le canari est NOTRE bruit : il est retiré du verdict — nommé et compté,
        // jamais effacé en silence. Sans ce retrait la garde échouerait sur
        // elle-même ; sans ce compte, on ignorerait qu'elle a parlé.
        for (let i = violations.length - 1; i >= 0; i -= 1) {
          if (isCanarySignal(violations[i])) violations.splice(i, 1);
        }
        await page.evaluate(() => document.querySelector('script[data-csp-canary]')?.remove()).catch(() => {});
        if (verdict.ok) console.log(`✅ ${verdict.reason}, retiré(s) du verdict`);
        else console.error(`\n❌ ${verdict.reason}`);
      }
    }

    // 3. Navigate every main page (admin account → full sidebar). Each visit
    //    exercises script-src, style-src, connect-src, font-src and img-src
    //    (charts, stamps, notifications…).
    for (const [label, re] of PAGES) {
      // Collecteur muet : la tournée n'apprendrait rien et ses zéros seraient faux.
      if (canaryMute) break;
      let clicked = false;
      for (let attempt = 0; attempt < 4 && !clicked; attempt++) {
        clicked = await page.evaluate((reSrc) => {
          const re = new RegExp(reSrc, 'i');
          const items = [...document.querySelectorAll('a, button, [role="menuitem"]')];
          const el = items.find((e) => re.test(e.textContent || '') && (e.textContent || '').trim().length < 25);
          if (!el) return false;
          el.click();
          return true;
        }, re.source);
        if (!clicked) {
          await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
          await wait(5000);
        }
      }
      if (!clicked) {
        console.log(`  ⚠️ lien « ${label} » introuvable — ignoré`);
        continue;
      }
      await wait(3500);
      await collect(label);
      visited++;
      console.log(`  ✓ ${label} visitée (${page.url().replace(URL, '').slice(0, 60) || '/'})`);
    }
    if (!canaryMute) console.log(`✅ ${visited}/${PAGES.length} pages visitées`);

    // Filet : si un canal plus lent que l'autre livrait le signal du canari APRÈS le
    // relevé, il arriverait sous l'étiquette d'une page et ferait rougir la garde sur
    // son propre bruit. Notre bruit ne décide jamais du verdict sur l'application.
    const lateCanary = violations.filter((v) => isCanarySignal(v)).length;
    if (lateCanary) {
      for (let i = violations.length - 1; i >= 0; i -= 1) {
        if (isCanarySignal(violations[i])) violations.splice(i, 1);
      }
      console.log(`  ℹ️ ${lateCanary} signal(aux) du canari arrivé(s) après le relevé — retiré(s) du verdict`);
    }

    // 4. Verdict — rendu seulement si le canari a prouvé que le collecteur voit
    //    quelque chose : le zéro d'un collecteur muet ne serait pas un verdict.
    if (canaryMute) {
      console.error('   (aucun verdict rendu : le collecteur n’a pas vu son propre refus)');
    } else if (violations.length) {
      console.error(`\n❌ ${violations.length} violation(s) CSP détectée(s) en navigation :`);
      for (const v of violations) console.error(`   [${v.where}] ${v.text}`);
    } else {
      console.log('\n✅ Zéro violation CSP en navigation — la policy est respectée par l\'app.');
    }
  } catch (e) {
    failMsg(String(e.message || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanup();
  }
  // Le collecteur muet passe AVANT tout verdict : un zéro qu'il rend ne prouve rien.
  // Sortie 2 — « je n'ai pas pu regarder » — et non 1 : ce n'est pas une violation
  // trouvée, c'est une mesure impossible (même langage que `check-jsx-i18n.mjs` et
  // `assertScanned`).
  if (canaryMute) {
    console.error(`\n❌ ${canaryMute}`);
    console.error('   Aucun verdict sur l’application n’est possible : le collecteur n’a pas prouvé qu’il voit.');
    process.exit(2);
  }
  if (fail || violations.length > 0) process.exit(1);
  // La preuve vient d'ici, pas d'une phrase du workflow : ce que cette garde a
  // RÉELLEMENT mesuré, c'est le nombre de pages parcourues et l'absence de
  // violation sur chacune. Le mandat est posé par l'étape qui l'exécute
  // (`AUTOMATION_EVIDENCE: '1'`) ; hors mandat, elle se tait.
  publishEvidence({
    acted: true,
    count: visited > 0 ? visited : null,
    reason:
      'garde CSP : canari du collecteur vu par les deux canaux, ' +
      `${visited}/${PAGES.length} page(s) principale(s) parcourue(s) en session réelle, ` +
      `${violations.length} violation(s) détectée(s), en-têtes de sécurité présents`,
  });
  process.exit(0);
})();