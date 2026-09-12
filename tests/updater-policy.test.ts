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
  FORCED_MAJOR_BEHIND,
  FORCED_MINOR_BEHIND,
  FORCED_RELEASE_AGE_DAYS,
  FORCED_RE_PROMPT_MS,
  parseVersion,
  shouldCheck,
  shouldPrompt,
  updatePressure,
  updateAction,
  holdsUrlFrom,
  holdDecision,
  updateGate,
} = require('../electron/updater-policy.cjs') as {
  CHECK_INTERVAL_MS: number;
  FOCUS_COOLDOWN_MS: number;
  RE_PROMPT_MS: number;
  FORCED_MAJOR_BEHIND: number;
  FORCED_MINOR_BEHIND: number;
  FORCED_RELEASE_AGE_DAYS: number;
  FORCED_RE_PROMPT_MS: number;
  parseVersion: (v: unknown) => { major: number; minor: number; patch: number } | null;
  shouldCheck: (i?: Record<string, unknown>) => { check: boolean; reason: string };
  shouldPrompt: (i?: Record<string, unknown>) => { prompt: boolean; reason: string };
  updatePressure: (i?: Record<string, unknown>) => {
    forced: boolean;
    code: string;
    behindMajor: number | null;
    behindMinor: number | null;
    releaseAgeDays: number | null;
    detail: string;
  };
  updateAction: (i?: Record<string, unknown>) => { action: string; detail: string };
  holdsUrlFrom: (i?: Record<string, unknown>) => string | null;
  holdDecision: (i?: Record<string, unknown>) => {
    held: boolean;
    verified: boolean;
    reason: string | null;
    detail: string;
  };
  updateGate: (i?: Record<string, unknown>) => {
    deliverable: boolean;
    forced: boolean;
    held: boolean;
    detail: string;
  };
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

  it('une mise à jour OBLIGATOIRE ignore le report : la question revient tout de suite', () => {
    // Le report existe pour ne pas harceler un utilisateur qui a vu l'annonce.
    // Il n'a aucun sens quand le retard est devenu intolérable : le premier
    // « plus tard » a déjà été accordé, des mois plus tôt.
    const justPrompted = shouldPrompt({ downloaded: true, lastPromptAt: NOW - 1_000, nowMs: NOW });
    assert.equal(justPrompted.prompt, false);
    const forced = shouldPrompt({ downloaded: true, lastPromptAt: NOW - 1_000, nowMs: NOW, forced: true });
    assert.equal(forced.prompt, true);
    assert.match(forced.reason, /obligatoire/);
    // Et la relance est rapprochée : une minute, pas un quart d'heure.
    assert.ok(FORCED_RE_PROMPT_MS < RE_PROMPT_MS);
  });
});

describe('au-delà du seuil, la mise à jour n’est plus une question', () => {
  const pressure = (over: Record<string, unknown>) =>
    updatePressure({
      currentVersion: '1.0.0',
      availableVersion: '1.0.1',
      releaseDate: new Date(NOW - 3 * 86400000).toISOString(),
      nowMs: NOW,
      ...over,
    });

  it('la version se lit, ou ne se devine pas', () => {
    assert.deepEqual(parseVersion('v2.3.4'), { major: 2, minor: 3, patch: 4 });
    assert.deepEqual(parseVersion('1'), { major: 1, minor: 0, patch: 0 });
    assert.equal(parseVersion('dernière'), null);
    assert.equal(parseVersion(undefined), null);
  });

  it('un correctif récent ne force rien — sinon tout serait obligatoire', () => {
    const v = pressure({ availableVersion: '1.0.1' });
    assert.equal(v.forced, false);
    assert.equal(v.code, 'none');
  });

  it('une version majeure de retard force l’installation', () => {
    const v = pressure({ availableVersion: '2.0.0' });
    assert.equal(v.forced, true);
    assert.equal(v.code, 'major');
    assert.equal(v.behindMajor, 1);
    assert.equal(FORCED_MAJOR_BEHIND, 1);
  });

  it('deux mineures de retard forcent, une seule non', () => {
    assert.equal(pressure({ availableVersion: '1.2.0' }).forced, true);
    assert.equal(pressure({ availableVersion: '1.2.0' }).code, 'minor');
    assert.equal(pressure({ availableVersion: '1.1.0' }).forced, false);
    assert.equal(FORCED_MINOR_BEHIND, 2);
  });

  it('un écart de mineures entre deux majeures ne compte pas comme « une mineure »', () => {
    // 2.0.0 vs 1.9.0 n'est pas « zéro mineure de retard » : c'est une majeure,
    // et c'est la règle de la majeure qui doit répondre.
    const v = pressure({ currentVersion: '1.9.0', availableVersion: '2.0.0' });
    assert.equal(v.code, 'major');
    assert.equal(v.behindMinor, null);
  });

  it('une version publiée depuis 45 jours et toujours pas installée force', () => {
    // Le filet du cas le plus courant : une « petite » version publiée un jour
    // où personne n'était devant le poste, et jamais reprise ensuite.
    const stale = pressure({
      availableVersion: '1.0.1',
      releaseDate: new Date(NOW - (FORCED_RELEASE_AGE_DAYS + 1) * 86400000).toISOString(),
    });
    assert.equal(stale.forced, true);
    assert.equal(stale.code, 'age');
    assert.equal(stale.releaseAgeDays, FORCED_RELEASE_AGE_DAYS + 1);
    const fresh = pressure({
      availableVersion: '1.0.1',
      releaseDate: new Date(NOW - (FORCED_RELEASE_AGE_DAYS - 1) * 86400000).toISOString(),
    });
    assert.equal(fresh.forced, false);
  });

  it('un poste à jour, ou en avance, n’est jamais forcé', () => {
    assert.equal(pressure({ currentVersion: '1.4.0', availableVersion: '1.4.0' }).forced, false);
    assert.equal(pressure({ currentVersion: '1.5.0', availableVersion: '1.4.0' }).forced, false);
  });

  it('une version illisible ne force RIEN — forcer serait deviner', () => {
    // L'asymétrie est volontaire : ici, se tromper dans le sens permissif coûte
    // un poste en retard ; dans l'autre sens, ça bloque un poste sous un
    // prétexte inventé. Même arbitrage que l'horloge qui recule.
    const v = pressure({ availableVersion: 'nightly' });
    assert.equal(v.forced, false);
    assert.equal(v.code, 'unknown');
    assert.match(v.detail, /illisible/);
  });

  it('une date de publication illisible n’annule que la règle de date', () => {
    const noDate = pressure({ availableVersion: '1.0.1', releaseDate: null });
    assert.equal(noDate.releaseAgeDays, null);
    assert.equal(noDate.forced, false, 'la règle de date ne juge pas');
    const major = pressure({ availableVersion: '2.0.0', releaseDate: 'pas une date' });
    assert.equal(major.forced, true, 'les autres règles continuent de juger');
    assert.equal(major.code, 'major');
  });

  it('une date de publication dans le futur ne force pas', () => {
    const v = pressure({ availableVersion: '1.0.1', releaseDate: new Date(NOW + 86400000).toISOString() });
    assert.equal(v.releaseAgeDays, null);
    assert.equal(v.forced, false);
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
    assert.match(
      main,
      /setTimeout\(\(\) => \{ void askToInstall\(info\); \}, reinvite\)/,
      'un report doit être reprogrammé (reinvite = obligation ? 1 min : 15 min)',
    );
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

  it('la porte du retard est câblée, et son issue de secours n’existe qu’en échec', () => {
    const fr = read('src/i18n/domains/adminFr.ts');
    const en = read('src/i18n/domains/adminEn.ts');
    const main = read('electron/main.cjs');
    // Le retard est DÉCIDÉ par la politique et poussé à l'interface : le
    // renderer ne juge pas, il montre. Un doublon de la règle dans l'interface
    // finirait par diverger de celle qui bloque vraiment.
    assert.match(main, /updatePressure\b/);
    assert.match(main, /forced: pressure\.forced/);
    assert.match(main, /updatePressure\(\{\s*currentVersion: app\.getVersion\(\)/);
    // Obligatoire ⇒ plus de « Plus tard », et pas d'échappement par Échap.
    assert.match(main, /buttons: forced \? \['Redémarrer maintenant'\]/);
    assert.match(main, /\.\.\.\(forced \? \{\} : \{ cancelId: 1 \}\)/);
    assert.match(main, /forced \? FORCED_RE_PROMPT_MS : RE_PROMPT_MS/, 'une obligation se rappelle vite');

    const banner = read('src/components/UpdateBanner.tsx');
    assert.match(banner, /state\?\.forced === true/);
    assert.match(banner, /data-update-gate="forced"/, 'la porte doit exister à l’écran');
    assert.match(banner, /forcedCode === 'major'/);
    assert.match(banner, /forcedCode === 'minor'/);
    assert.match(banner, /forcedCode === 'age'/);
    // L'issue de secours n'est rendue que dans l'état d'échec, et rien ne la
    // garde une fois la version téléchargée : une obligation qu'on peut
    // contourner quand tout va bien n'est pas une obligation.
    assert.match(banner, /\{failed && \(\s*<button[\s\S]{0,400}?labels\.forcedContinue/);

    // Le pont gagne une relance NOMMÉE, pas une surface générique.
    const preload = read('electron/preload.cjs');
    assert.match(preload, /retry: \(\) => ipcRenderer\.invoke\('updates:check-now'\)/);
    assert.match(main, /ipcMain\.handle\('updates:check-now'/);

    for (const key of ['updateForcedTitle', 'updateForcedMajor', 'updateForcedMinor', 'updateForcedAge', 'updateForcedNote', 'updateForcedFailed', 'updateForcedRetry', 'updateForcedContinue']) {
      assert.match(fr, new RegExp(`${key}:`), `${key} manque en français`);
      assert.match(en, new RegExp(`${key}:`), `${key} manque en anglais`);
    }
  });
});

// ── Frein d'urgence ─────────────────────────────────────────────────────────
// La porte du retard force l'installation au-delà des seuils — c'est voulu, et
// c'est dangereux le jour où la version publiée est défectueuse : sans frein,
// toute l'école est contrainte d'installer la panne. Le frein est une liste de
// versions retenues, publiée HORS du release (donc modifiable après coup, sans
// toucher à la version fautive) et relue à chaque vérification.
describe('frein d’urgence : une version retenue n’est ni imposée ni installée', () => {
  const forcedByAge = () => updatePressure({
    currentVersion: '1.0.2',
    availableVersion: '1.0.3',
    releaseDate: new Date(NOW - 60 * 86400000).toISOString(),
    nowMs: NOW,
  });
  const holds = (version: string, reason?: string) => [{ version, ...(reason === undefined ? {} : { reason }) }];

  it('une version retenue est retenue, avec son motif', () => {
    const v = holdDecision({ version: '1.0.4', holds: holds('1.0.4', 'plantage au démarrage'), readOk: true });
    assert.equal(v.held, true);
    assert.equal(v.verified, true);
    assert.match(v.detail, /plantage au démarrage/);
  });

  it('le frein ne frappe que la version qu’il nomme', () => {
    const v = holdDecision({ version: '1.0.5', holds: holds('1.0.4', 'x'), readOk: true });
    assert.equal(v.held, false);
    assert.equal(v.verified, true);
    assert.match(v.detail, /aucune retenue/);
  });

  it('un motif absent ne rend pas le frein inerte', () => {
    const v = holdDecision({ version: '1.0.4', holds: holds('1.0.4'), readOk: true });
    assert.equal(v.held, true, 'la version reste retenue : c’est le motif qui manque');
    assert.equal(v.reason, 'version retenue (motif non renseigné)');
  });

  it('une retenue bat le forçage, même au-delà d’un seuil', () => {
    const pressure = forcedByAge();
    assert.equal(pressure.forced, true, 'sans frein, cette version serait imposée');
    const gated = updateGate({ pressure, hold: holdDecision({ version: '1.0.3', holds: holds('1.0.3', 'régression de paie'), readOk: true }) });
    assert.equal(gated.forced, false, 'le frein doit battre l’obligation');
    assert.equal(gated.deliverable, false, 'rien ne doit être livré');
    assert.equal(gated.held, true);
    assert.match(gated.detail, /régression de paie/);
  });

  it('une liste illisible ne force RIEN mais propose toujours', () => {
    const gated = updateGate({ pressure: forcedByAge(), hold: holdDecision({ version: '1.0.3', readOk: false }) });
    assert.equal(gated.forced, false, 'on ne contraint personne sur une supposition');
    assert.equal(gated.deliverable, true, 'l’utilisateur garde la mise à jour');
    assert.equal(gated.held, false, 'illisible n’est pas retenu : ce sont deux états distincts');
    assert.match(gated.detail, /proposée, jamais imposée/);
  });

  it('sans verdict de frein du tout, la porte laisse passer la pression', () => {
    const gated = updateGate({ pressure: { forced: true } });
    assert.equal(gated.forced, true);
    assert.equal(gated.deliverable, true);
    assert.match(gated.detail, /retenues non lues/);
  });

  it('l’URL des retenues vient de app-update.yml, jamais recopiée', () => {
    assert.equal(
      holdsUrlFrom({ appUpdateYml: "owner: ibrahimkalilthera\nrepo: '-MAMA'\nprovider: github\n" }),
      'https://raw.githubusercontent.com/ibrahimkalilthera/-MAMA/main/updates/holds.json',
    );
    // Sans owner/repo, l'URL est indéterminable : l'appelant en déduit « aucune
    // obligation », jamais un forçage.
    assert.equal(holdsUrlFrom({ appUpdateYml: 'provider: github\n' }), null);
    // Mode preuve : le frein se joue contre un serveur local, sans rien publier.
    assert.equal(
      holdsUrlFrom({ feedOverride: 'http://127.0.0.1:9450/', appUpdateYml: '' }),
      'http://127.0.0.1:9450/updates/holds.json',
    );
  });

  it('le fichier de retenues existe, est valide, et vide au repos', () => {
    const file = JSON.parse(read('updates/holds.json')) as { holds: unknown[]; _doc: string[] };
    assert.ok(Array.isArray(file.holds), 'le frein doit avoir sa liste');
    assert.equal(file.holds.length, 0, 'au repos, aucune version n’est retenue');
    assert.match(file._doc.join(' '), /Retenir une version/, 'le mode d’emploi doit être dans le fichier');
    assert.match(file._doc.join(' '), /Retirer le release/, 'le geste qui vaut pour tous les postes doit y être');
  });

  it('le frein est câblé sur CHAQUE chemin qui mène à l’installation', () => {
    const main = read('electron/main.cjs');
    // Décidé dans le processus principal, avant l'annonce.
    assert.match(main, /updateGate\(\{ pressure, hold \}\)/);
    assert.match(main, /heldVersion = i\.version/);
    assert.match(main, /update-retenue/);
    assert.match(main, /obligation écartée/);
    // Une obligation écartée par un frein illisible se dit.
    assert.match(main, /retenues illisibles/);
    // Installation à la fermeture, rappel déjà programmé, bouton d'installation :
    // trois chemins, et le frein doit tenir sur les trois.
    assert.match(main, /autoInstallOnAppQuit = false/);
    assert.match(main, /prompt refusé/);
    assert.match(main, /installation refusée/);
    // L'interface n'affiche rien pour une version retenue, et son type l'admet.
    assert.match(read('src/components/UpdateBanner.tsx'), /\| 'held'/);
  });
});
