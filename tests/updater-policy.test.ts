// Suite for the desktop auto-update policy (electron/updater-policy.cjs) and
// the wiring that makes a published version reach every installed PC.
//
// WHY THIS EXISTS
// ---------------
// The updater already worked — `scripts/verify-updater.mjs` proves check →
// available → progress → downloaded against a local feed, on the packaged exe.
// What it did not do is REACH people: it asked exactly once, five seconds after
// startup. A school PC stays open all day, so a version published at 10 a.m. was
// never announced to anyone who had already launched the app, and « Plus tard »
// meant « never » until the next restart. The version circulated only among the
// people who happened to reopen the application.
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  CHECK_INTERVAL_MS,
  FOCUS_COOLDOWN_MS,
  RE_PROMPT_MS,
  shouldCheck,
  shouldPrompt,
  updateAction,
} = require('../electron/updater-policy.cjs') as {
  CHECK_INTERVAL_MS: number;
  FOCUS_COOLDOWN_MS: number;
  RE_PROMPT_MS: number;
  shouldCheck: (i?: Record<string, unknown>) => { check: boolean; reason: string };
  shouldPrompt: (i?: Record<string, unknown>) => { prompt: boolean; reason: string };
  updateAction: (i?: Record<string, unknown>) => { action: string; detail: string };
};

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const NOW = Date.parse('2026-09-12T12:00:00.000Z');

describe('une app ouverte toute la journée revoit passer les versions', () => {
  it('le premier passage vérifie toujours (un poste vient de s’ouvrir)', () => {
    assert.equal(shouldCheck({ lastCheckAt: null, nowMs: NOW }).check, true);
  });

  it('l’intervalle déclenche une nouvelle vérification', () => {
    assert.equal(shouldCheck({ lastCheckAt: NOW - CHECK_INTERVAL_MS - 1, nowMs: NOW }).check, true);
    const tooSoon = shouldCheck({ lastCheckAt: NOW - 60_000, nowMs: NOW });
    assert.equal(tooSoon.check, false);
    assert.match(tooSoon.reason, /trop tôt/);
  });

  it('le retour sur la fenêtre vérifie, mais pas à chaque alt-tab', () => {
    // Le bon moment pour parler à quelqu'un, c'est quand il est devant l'écran.
    assert.equal(shouldCheck({ kind: 'focus', lastCheckAt: NOW - FOCUS_COOLDOWN_MS - 1, nowMs: NOW }).check, true);
    assert.equal(shouldCheck({ kind: 'focus', lastCheckAt: NOW - 30_000, nowMs: NOW }).check, false);
    // Un retour sur la fenêtre juste après l'intervalle ne double pas la requête.
    assert.equal(shouldCheck({ kind: 'focus', lastCheckAt: NOW - CHECK_INTERVAL_MS, nowMs: NOW }).check, true);
  });

  it('une horloge qui recule fait vérifier, jamais l’inverse', () => {
    const v = shouldCheck({ lastCheckAt: NOW + 60_000, nowMs: NOW });
    assert.equal(v.check, true, 'refuser ici bloquerait les mises à jour pour de bon');
  });
});

describe('« Plus tard » reporte, il ne refuse pas', () => {
  it('la première proposition se fait dès que la version est téléchargée', () => {
    const v = shouldPrompt({ downloaded: true, lastPromptAt: null, nowMs: NOW });
    assert.equal(v.prompt, true);
    assert.match(v.reason, /première/);
  });

  it('le report expire, et la question revient', () => {
    const during = shouldPrompt({ downloaded: true, lastPromptAt: NOW - 60_000, nowMs: NOW });
    assert.equal(during.prompt, false);
    const after = shouldPrompt({ downloaded: true, lastPromptAt: NOW - RE_PROMPT_MS, nowMs: NOW });
    assert.equal(after.prompt, true);
    assert.match(after.reason, /report a expiré/);
  });

  it('rien de téléchargé ⇒ on ne dérange personne', () => {
    assert.equal(shouldPrompt({ downloaded: false, nowMs: NOW }).prompt, false);
  });
});

describe('le portable n’est pas laissé muet', () => {
  it('installation installée → redémarrage ; portable → téléchargement manuel', () => {
    assert.equal(updateAction({ isPortable: false }).action, 'restart');
    const portable = updateAction({ isPortable: true });
    assert.equal(portable.action, 'open-download');
    // La raison est écrite : electron-updater ne s'installe que via NSIS.
    assert.match(portable.detail, /NSIS/);
  });
});

describe('le câblage : les trois étages se répondent', () => {
  it('le main programme l’intervalle, le focus et la relance', () => {
    const main = read('electron/main.cjs');
    assert.match(main, /require\('\.\/updater-policy\.cjs'\)/);
    assert.match(main, /setInterval\(checkNow, intervalMs\)/, 'sans intervalle, une app ouverte ne voit rien passer');
    assert.match(main, /win\.on\('focus', focusNow\)/, 'le retour sur la fenêtre est le bon moment pour prévenir');
    assert.match(main, /setTimeout\(\(\) => \{ void askToInstall\(info\); \}, RE_PROMPT_MS\)/, 'un report doit être reprogrammé');
    assert.match(main, /webContents\.send\('updates:state'/, 'l’état doit atteindre l’interface');
    assert.match(main, /UPDATER_CHECK_INTERVAL_MS/, 'le rythme doit rester réglable (preuve E2E sans attendre 30 min)');
    // Le portable vérifie quand même : ne rien lui dire serait le trahir.
    assert.doesNotMatch(main, /portable — auto-update désactivé/);
  });

  it('le pont expose lire / s’abonner / installer, et rien d’autre', () => {
    const preload = read('electron/preload.cjs');
    assert.match(preload, /getState: \(\) => ipcRenderer\.invoke\('updates:get-state'\)/);
    assert.match(preload, /onState: \(onChange\) => \{/);
    assert.match(preload, /install: \(\) => ipcRenderer\.invoke\('updates:install'\)/);
    // Aucune surface générique : le renderer ne doit pas pouvoir appeler
    // n'importe quel canal depuis une page compromises.
    assert.doesNotMatch(preload, /invoke: \(channel/);
  });

  it('le bandeau rend l’attente visible et rattrape un état déjà présent', () => {
    const banner = read('src/components/UpdateBanner.tsx');
    assert.match(banner, /api\.getState\(\)/, 'la fenêtre peut s’ouvrir APRÈS le téléchargement');
    assert.match(banner, /api\.onState\(/);
    assert.match(banner, /state\?\.status === 'downloaded'/);
    const shell = read('src/components/AppShell.tsx');
    assert.match(shell, /<UpdateBanner[\s\S]{0,600}t\.updateReady/);
    // Chaque libellé vient du dictionnaire : le bandeau ne parle pas en dur.
    const fr = read('src/i18n/domains/adminFr.ts');
    const en = read('src/i18n/domains/adminEn.ts');
    for (const key of ['updateAvailable', 'updateDownloading', 'updateReady', 'updateReadyManual', 'updateRestartNow', 'updateDownloadNow']) {
      assert.match(fr, new RegExp(`${key}:`), `${key} manque en français`);
      assert.match(en, new RegExp(`${key}:`), `${key} manque en anglais`);
    }
  });
});
