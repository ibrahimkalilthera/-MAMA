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
// Usage:
//   node scripts/verify-csp-guard.mjs [--url http://127.0.0.1:4173/] [--expect-local-origin http://127.0.0.1:54321]
//   node scripts/verify-csp-guard.mjs --url https://… --policy-only
//
// `--expect-local-origin` : l'adresse servie est celle d'une pile locale, donc
// la politique DOIT être celle du dépôt plus cette origine — l'écart est jugé,
// pas supposé. `--policy-only` : compare l'en-tête servi à vercel.json sans
// compte ni navigateur (voir `compareServedPolicy`) ; c'est le seul mode qui
// peut viser la production sans y écrire.
//
// Credentials : l'ENVIRONNEMENT d'abord (SUPABASE_URL/VITE_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY — le job monte sa pile et exporte ses clés
// éphémères, il n'a aucun `.env`), puis `.env` pour un lancement à la main.
// Exit 0 = header présent + zéro violation (ou politique conforme, en mode
// politique seule).
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
import { declaredPolicies, localStackGap } from './lib/csp-origins.mjs';
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
const env = existsSync(envFile) ? parseEnv(envFile) : {};
// L'ENVIRONNEMENT d'abord : le job qui juge l'application monte sa propre pile
// et exporte ses clés éphémères — sur un runner, `.env` n'existe pas. Le
// fichier ne sert qu'à un lancement à la main, et il vient APRÈS : un `.env`
// périmé ne doit pas décider de la base jugée.
const supabaseBase = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
// Mode « politique seule » : lecture d'en-tête, sans compte ni navigateur (voir
// `compareServedPolicy` plus bas). Il ne touche aucune base, donc il ne peut pas
// exiger de clé de service.
const POLICY_ONLY = process.argv.includes('--policy-only');
if (!POLICY_ONLY && (!supabaseBase || !SERVICE_KEY)) {
  console.error(
    '❌ base ou clé service introuvable : ni SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ' +
      `dans l’environnement, ni de valeurs dans ${envFile} (${existsSync(envFile) ? 'présent mais incomplet' : 'absent'}).`,
  );
  process.exit(1);
}
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Les drapeaux dans leurs DEUX écritures, `--url <valeur>` et `--url=<valeur>`.
//
// Mesuré le 2026-10-12 : la seconde était ignorée en silence, et la garde
// retombait sur l'adresse de PRODUCTION — elle a créé son compte éphémère dans
// la pile de recette, jugé le site déployé sous une politique à laquelle ce
// compte n'avait pas accès, visité **0 page** et rendu un ✓ « zéro violation ».
// Un drapeau ignoré ne rend pas une erreur : il rend un verdict sur autre chose.
const flag = (name, def = '') => {
  const argv = process.argv.slice(2);
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i === -1 ? def : (argv[i + 1] ?? '');
};
const URL = (flag('--url', 'https://mama-thera-finance.vercel.app/') || 'https://mama-thera-finance.vercel.app/')
  .replace(/\/$/, '') + '/';
const KEEP = process.argv.includes('--keep');
// L'origine de la pile de recette, quand l'application est servie localement :
// elle sert à vérifier que la politique servie n'est QUE la politique du dépôt
// plus cette origine (voir `localStackGap`) — une dérive non dérivée rougit.
const EXPECT_LOCAL_ORIGIN = flag('--expect-local-origin').trim();

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

// ── Mode « politique seule » — aucun compte, aucun navigateur ────────────────
//
// Le run qui juge l'application SOUS sa politique le fait désormais sur sa
// propre pile (voir `policyWithLocalStack`), justement pour ne plus créer de
// compte éphémère dans la base de l'école. Restait ce que ce déménagement ne
// couvrirait plus : ce que l'HÔTE sert réellement. Ce mode lit l'en-tête de
// l'adresse visée et le compare mot pour mot à la politique du dépôt — et comme
// il ne se connecte ni ne crée rien, il peut viser la production sans y écrire
// une seule ligne.
function compareServedPolicy(served) {
  const declared = declaredPolicies(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')));
  if (declared.length !== 1) {
    return { ok: false, directives: 0, because: `vercel.json déclare ${declared.length} politique(s) — ce contrôle ne peut pas choisir` };
  }
  const expected = declared[0].trim();
  const directives = expected.split(';').map((d) => d.trim()).filter(Boolean).length;
  return served === expected
    ? { ok: true, directives, because: 'l’en-tête servi est la politique du dépôt, mot pour mot' }
    : {
        ok: false,
        directives,
        because: `l’en-tête servi s’écarte du dépôt (${served.length} caractères servis contre ${expected.length} déclarés)`,
      };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let browser = null;
let fail = false;
const failMsg = (m) => { console.error('  ❌ ' + m); fail = true; };
/** Le canari n'a pas vu son propre refus : le run n'a RIEN mesuré (sortie 2). */
let canaryMute = null;
/** La tournée n'a ouvert AUCUNE page : zéro violation n'y prouverait rien (sortie 2). */
let blindTour = null;

(async () => {
  try {
    if (POLICY_ONLY) {
      const res = await fetch(URL, { redirect: 'follow' });
      const served = (res.headers.get('content-security-policy') || '').trim();
      const verdict = compareServedPolicy(served);
      if (verdict.ok) {
        console.log(`✅ politique servie conforme — ${verdict.because} (${URL})`);
      } else {
        console.error(`❌ politique servie non conforme — ${verdict.because} (${URL})`);
        console.error(`   servie  : ${served || '(absente)'}`);
      }
      publishEvidence({
        acted: true,
        count: verdict.directives,
        reason: `politique servie relue à ${URL} et comparée mot pour mot à vercel.json (${verdict.directives} directive(s)) : ${verdict.because}`,
      });
      process.exit(verdict.ok ? 0 : 1);
    }
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
    // 1 bis. Quand la garde juge l'application servie LOCALEMENT, la politique
    //    servie DOIT être celle du dépôt, plus l'origine de la pile — rien
    //    d'autre. Une dérive non dérivée (un `connect-src` ouvert à la main, une
    //    directive relâchée) rougit ici, au lieu de passer pour un acquis.
    if (EXPECT_LOCAL_ORIGIN) {
      const declared = declaredPolicies(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')));
      const gap = localStackGap({ declared: declared[0] ?? '', served: csp, origin: EXPECT_LOCAL_ORIGIN });
      if (gap.ok) console.log(`✅ écart admis — ${gap.because}`);
      else failMsg(`la politique servie n’est pas la dérivée attendue — ${gap.because}`);
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
      // Le formulaire encore là = la connexion n'a PAS abouti (le compte n'existe
      // pas dans la base que sert cette adresse, ou le mot de passe a changé).
      // On le dit ici, au lieu de laisser la tournée des pages échouer une à une.
      const stillOnLogin = await page.$('input[type="email"]');
      if (stillOnLogin) console.error('  ⚠️ le formulaire de connexion est TOUJOURS affiché — la session n’a pas été ouverte');
      else console.log('✅ connecté à ' + URL);
    } else {
      console.error('  ⚠️ aucun champ de connexion trouvé sur ' + URL);
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
    // Une tournée VIDE n'est pas un zéro : c'est une mesure impossible. Sans cette
    // garde, une connexion qui échoue rend exactement le même ✓ qu'une application
    // propre — et c'est arrivé : mesuré le 2026-10-12, 0/7 pages et un « zéro
    // violation » vert, sur un compte qui n'existait pas dans la base servie.
    //
    // Cause SÉPARÉE de celle du canari, et donc dite séparément : ici le collecteur
    // a bien vu son refus connu, c'est la tournée qui n'a rien ouvert.
    if (!canaryMute && visited === 0) {
      blindTour =
        `aucune des ${PAGES.length} pages principales n’a pu être ouverte sur ${URL} — ` +
        'aucun verdict sur l’application n’est possible (session non ouverte ?)'; 
    }

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
    if (canaryMute || blindTour) {
      console.error(
        '   (aucun verdict rendu : ' +
          (canaryMute ? 'le collecteur n’a pas vu son propre refus' : 'aucune page n’a pu être ouverte') +
          ')',
      );
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
  if (canaryMute || blindTour) {
    const why = canaryMute ?? blindTour;
    console.error(`\n❌ ${why}`);
    console.error(
      '   Aucun verdict sur l’application n’est possible : ' +
        (canaryMute ? 'le collecteur n’a pas prouvé qu’il voit.' : 'la tournée n’a rien mesuré.'),
    );
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