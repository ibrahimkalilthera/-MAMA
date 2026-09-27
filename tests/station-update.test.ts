// Suite for scripts/lib/station-update.mjs + scripts/lib/updater-cache.mjs.
//
// WHY THIS EXISTS
// ---------------
// Ce module décide si un poste PARTI d'une version publiée antérieure rejoint la
// tête publiée, et sinon il en NOMME la cause — parce que « ça n'a pas marché »
// n'a jamais réparé un parc. Le journal de preuve reproduit ici est celui que
// `electron/main.cjs` écrit réellement (`checking-for-update`,
// `update-available`, `download-progress`, `update-downloaded`, `update-retenue`,
// `octets non conformes au flux`, `échec de téléchargement`, `poste bloqué (…)`).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  CAUSE,
  existingInstallVerdict,
  exitCodeLabel,
  installerDialogVerdict,
  previousPublishedVersion,
  stationReach,
  updateChainVerdict,
} from '../scripts/lib/station-update.mjs';
import { invalidateUpdaterCache, updaterCacheDir, updaterPendingInfo } from '../scripts/lib/updater-cache.mjs';

const PUBLISHED = ['v1.0.1', 'v1.0.9', 'v1.0.16', 'v1.0.17', 'v1.0.18'];

/** Une ligne du journal de preuve, horodatée comme l'application l'écrit. */
const line = (message: string, at = '2026-09-22T10:00:00.000Z') => `${at} ${message}`;

describe('le poste de départ est la plus HAUTE version publiée sous la tête', () => {
  it('choisit la version immédiatement antérieure, quel que soit l’ordre reçu', () => {
    const verdict = previousPublishedVersion({ versions: PUBLISHED, head: 'v1.0.18' });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.version, '1.0.17');
  });

  it('ignore les numéros illisibles au lieu de s’arrêter dessus', () => {
    const verdict = previousPublishedVersion({ versions: [...PUBLISHED, 'nuit', 'v1.0'], head: '1.0.18' });
    assert.equal(verdict.version, '1.0.17');
  });

  it('REFUSE quand aucune version publiée n’est antérieure à la tête', () => {
    const verdict = previousPublishedVersion({ versions: ['1.0.18'], head: 'v1.0.18' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.version, null);
    assert.match(verdict.problems[0], /aucune version publiée n’est ANTÉRIEURE/);
  });

  it('REFUSE une tête illisible, et une liste de versions vide', () => {
    assert.match(previousPublishedVersion({ versions: PUBLISHED, head: 'derniere' }).problems[0], /n’est pas un numéro de version/);
    assert.match(previousPublishedVersion({ versions: [], head: 'v1.0.18' }).problems[0], /aucune version PUBLIÉE n’est lisible/);
  });
});

describe('la chaîne de mise à jour, lue dans le journal du poste', () => {
  it('accepte la chaîne complète, et compte les vérifications', () => {
    const verdict = updateChainVerdict({
      target: '1.0.18',
      lines: [
        line('checking-for-update'),
        line('update-available 1.0.18'),
        line('download-progress 42%', '2026-09-22T10:00:30.000Z'),
        line('download-progress 100%', '2026-09-22T10:01:00.000Z'),
        line('update-downloaded 1.0.18', '2026-09-22T10:01:02.000Z'),
        line('check interval — reprise', '2026-09-22T10:01:10.000Z'),
        line('checking-for-update', '2026-09-22T10:01:11.000Z'),
      ],
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, null);
    assert.deepEqual(verdict.chain, { checking: true, available: true, progress: true, downloaded: true });
    assert.equal(verdict.checks, 2);
  });

  it('NOMME le frein d’urgence : rien ne devait être livré', () => {
    const verdict = updateChainVerdict({
      target: '1.0.18',
      lines: [line('checking-for-update'), line('update-available 1.0.18'), line('update-retenue 1.0.18 — frein d’urgence')],
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, CAUSE.HEAD_HELD);
    assert.match(verdict.problems.join(' '), /RETENUE par le frein/);
  });

  it('NOMME les octets menteurs — le remède est sur le CANAL', () => {
    const verdict = updateChainVerdict({
      target: '1.0.18',
      lines: [
        line('checking-for-update'),
        line('update-available 1.0.18'),
        line('octets non conformes au flux — installation refusée pour 1.0.18'),
        line('update-downloaded 1.0.18 — INSTALLATION REFUSÉE (octets non conformes au flux)'),
      ],
    });
    assert.equal(verdict.cause, CAUSE.BYTES_REFUSED);
    assert.match(verdict.causeDetail ?? '', /remède est sur le CANAL/);
  });

  it('distingue un échec de TÉLÉCHARGEMENT d’un canal illisible', () => {
    const download = updateChainVerdict({
      target: '1.0.18',
      lines: [line('checking-for-update'), line('update-available 1.0.18'), line('échec de téléchargement — HTTP 404')],
    });
    assert.equal(download.cause, CAUSE.DOWNLOAD_FAILED);
    const feed = updateChainVerdict({
      target: '1.0.18',
      lines: [line('checking-for-update'), line('check-failed getaddrinfo ENOTFOUND github.com')],
    });
    assert.equal(feed.cause, CAUSE.FEED_UNREACHABLE);
  });

  it('REFUSE « aucune mise à jour offerte » sur un poste pourtant antérieur', () => {
    const verdict = updateChainVerdict({
      target: '1.0.18',
      lines: [line('checking-for-update'), line('update-not-available')],
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, CAUSE.NOT_OFFERED);
    assert.match(verdict.problems.join(' '), /ANTÉRIEUR à la tête/);
  });

  it('dit « incomplet » seulement quand le journal n’explique rien', () => {
    const verdict = updateChainVerdict({
      target: '1.0.18',
      lines: [line('checking-for-update'), line('update-available 1.0.18'), line('download-progress 12%')],
    });
    assert.equal(verdict.cause, CAUSE.CHAIN_INCOMPLETE);
    assert.equal(verdict.chain.downloaded, false);
    assert.deepEqual(verdict.warnings, [], 'le poste a vu la tête et téléchargé : rien à lui reprocher de plus');
    // Le cas muet, lui, doit dire ce qui MANQUE — sinon « incomplet » ne
    // désigne rien de réparable.
    const silent = updateChainVerdict({ target: '1.0.18', lines: [line('checking-for-update')] });
    assert.equal(silent.cause, CAUSE.CHAIN_INCOMPLETE);
    assert.match(silent.warnings.join(' '), /le poste n’a jamais vu la version de tête/);
    assert.match(silent.warnings.join(' '), /aucune progression de téléchargement/);
  });

  it('ne conclut rien sur un journal vide — une absence de preuve n’est pas une preuve', () => {
    const verdict = updateChainVerdict({ target: '1.0.18', lines: [] });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, CAUSE.CHAIN_INCOMPLETE);
  });
});

describe('le parcours complet : la chaîne ET la version réellement installée', () => {
  const complete = updateChainVerdict({
    target: '1.0.18',
    lines: [
      line('checking-for-update'),
      line('update-available 1.0.18'),
      line('download-progress 100%'),
      line('update-downloaded 1.0.18'),
    ],
  });

  it('accepte un poste passé de 1.0.17 à 1.0.18', () => {
    const verdict = stationReach({ chain: complete, before: '1.0.17', after: '1.0.18', target: '1.0.18' });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, null);
    assert.match(verdict.notes.join(' '), /est passé de 1.0.17 à 1.0.18/);
  });

  it('REFUSE le pire cas silencieux : installation terminée sur la MÊME version', () => {
    const verdict = stationReach({ chain: complete, before: '1.0.17', after: '1.0.17', target: '1.0.18' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, CAUSE.INSTALL_NOOP);
    assert.match(verdict.problems.join(' '), /version lue dans l’installation : 1.0.17/);
  });

  it('REFUSE une version illisible, et une version qui n’est pas la tête', () => {
    assert.equal(stationReach({ chain: complete, before: '1.0.17', after: null, target: '1.0.18' }).cause, CAUSE.INSTALL_MISSING);
    assert.equal(stationReach({ chain: complete, before: '1.0.17', after: '1.0.16', target: '1.0.18' }).cause, CAUSE.INSTALL_OTHER);
  });

  it('REFUSE de conclure sans journal, et sur un départ qui n’est pas antérieur', () => {
    const noChain = stationReach({ chain: null, before: '1.0.17', after: '1.0.18', target: '1.0.18' });
    assert.equal(noChain.ok, false);
    assert.match(noChain.problems[0], /aucune lecture du journal du poste/);
    const alreadyHead = stationReach({ chain: complete, before: '1.0.18', after: '1.0.18', target: '1.0.18' });
    assert.equal(alreadyHead.ok, false);
    assert.match(alreadyHead.notes.join(' '), /pas antérieur à la tête/);
  });
});

describe('une boîte que personne ne cliquera est une cause, pas une attente', () => {
  /** La boîte MESURÉE le 2026-09-22, texte pour texte (fenêtre class #32770). */
  const BLOCKED = {
    visible: true,
    title: 'Installation de MamaTheraFinance',
    texts: [
      'Pane OK',
      "Échec de désinstallation des anciens fichiers d'application . Veuillez réessayer d'exécuter l'installeur.: -1073740940",
    ],
  };

  it('nomme le code Windows au lieu de le laisser brut', () => {
    assert.equal(exitCodeLabel(-1073740940), '-1073740940 (0xC0000374) — STATUS_HEAP_CORRUPTION (le processus a planté en sortant)');
    assert.equal(exitCodeLabel(3221226356), '-1073740940 (0xC0000374) — STATUS_HEAP_CORRUPTION (le processus a planté en sortant)'.replace('-1073740940', '3221226356'));
    assert.match(exitCodeLabel(0), /0 \(0x0\) — succès/);
    // Un code NON LU n'est pas « 0 » : `Number(null)` vaut 0, et rendre
    // « succès » pour une absence ferait passer un échec muet pour un succès.
    assert.equal(exitCodeLabel(null), '—');
    assert.equal(exitCodeLabel(''), '—');
    assert.equal(exitCodeLabel('pas un code'), '—');
  });

  it('REFUSE le blocage, désigne le désinstalleur, et dit où est le remède', () => {
    const verdict = installerDialogVerdict({ dialog: BLOCKED, previous: '1.0.17', target: '1.0.18', appStillThere: true });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.cause, CAUSE.INSTALL_BLOCKED_DIALOG);
    assert.match(verdict.code ?? '', /STATUS_HEAP_CORRUPTION/);
    assert.match(verdict.problems[0], /attend un clic/);
    assert.match(verdict.problems[1], /n’a pas pu être retirée/);
    assert.match(verdict.problems[1], /1\.0\.18 n’est pas installée/);
    assert.match(verdict.problems[2], /TOUJOURS EN PLACE/);
    assert.match(verdict.problems[2], /continue de travailler en 1\.0\.17/);
    assert.match(verdict.problems[3], /remède est sur le POSTE/);
  });

  it('dit un poste SANS application seulement quand la MESURE le dit', () => {
    // Mesuré le 2026-09-22 sur la paire publiée : l’ancienne application garde ses
    // 20 fichiers et le poste travaille encore. Annoncer « poste sans application »
    // sans l’avoir lu enverrait une école au secours d’un poste qui va très bien.
    const gone = installerDialogVerdict({ dialog: BLOCKED, previous: '1.0.17', target: '1.0.18', appStillThere: false });
    assert.match(gone.problems[2], /PLUS AUCUN binaire/);
    assert.match(gone.problems[2], /SANS application/);
    assert.doesNotMatch(gone.problems.join(' '), /TOUJOURS EN PLACE/);

    const intact = installerDialogVerdict({ dialog: BLOCKED, previous: '1.0.17', target: '1.0.18', appStillThere: true });
    assert.doesNotMatch(intact.problems.join(' '), /SANS application/);

    // Sans mesure, le verdict ne tranche pas : c’est le seul silence honnête.
    const unknown = installerDialogVerdict({ dialog: BLOCKED, previous: '1.0.17', target: '1.0.18' });
    assert.match(unknown.problems[2], /n’a PAS été mesuré/);
    assert.doesNotMatch(unknown.problems.join(' '), /TOUJOURS EN PLACE|PLUS AUCUN binaire|SANS application/);
  });

  it('refuse AUSSI une boîte qu’il ne connaît pas : un clic reste un clic', () => {
    const verdict = installerDialogVerdict({
      dialog: { visible: true, title: 'Installation', texts: ['Veuillez patienter'] },
      previous: '1.0.17',
      target: '1.0.18',
    });
    assert.equal(verdict.blocked, true);
    assert.match(verdict.problems.join(' '), /sans geste de l’utilisateur/);
  });

  it('ne conclut rien quand aucune fenêtre n’est visible — un installateur silencieux travaille', () => {
    assert.equal(installerDialogVerdict({ dialog: null }).blocked, false);
    assert.equal(installerDialogVerdict({ dialog: { visible: false, texts: ['bruit'] } }).blocked, false);
    assert.equal(installerDialogVerdict({ dialog: { visible: true, texts: [] } }).blocked, false);
  });
});

describe('ne jamais réécrire une installation réelle', () => {
  it('accepte une machine sans installation', () => {
    assert.equal(existingInstallVerdict({ entries: [] }).ok, true);
  });

  it('accepte les entrées d’un dossier de travail temporaire', () => {
    const verdict = existingInstallVerdict({
      entries: [{ key: 'k', displayName: 'Mama Thera Finance', installLocation: 'C:\\Users\\x\\AppData\\Local\\Temp\\mama-update-123\\app' }],
    });
    assert.equal(verdict.ok, true);
  });

  it('REFUSE — et dit pourquoi — quand une installation réelle est présente', () => {
    const verdict = existingInstallVerdict({
      entries: [
        {
          key: 'HKCU\\…\\MamaTheraFinance',
          displayName: 'Mama Thera Finance',
          installLocation: 'C:\\Users\\x\\AppData\\Local\\Programs\\MamaTheraFinance',
        },
      ],
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.installs.length, 1);
    assert.match(verdict.problems[0], /installation de cette application est DÉJÀ présente/);
    assert.match(verdict.problems.join(' '), /orpheline/);
  });
});

describe('le cache partagé d’electron-updater doit être rendu inerte', () => {
  it('calcule le dossier du cache comme l’application', () => {
    const dir = updaterCacheDir({ env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' } });
    assert.match(dir, /mama-thera-finance-updater$/);
    assert.match(updaterPendingInfo(dir), /pending[\\/]update-info\.json$/);
  });

  it('retire `update-info.json` — c’est LUI qui rend le cache réutilisable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-updater-cache-'));
    try {
      mkdirSync(join(dir, 'pending'), { recursive: true });
      writeFileSync(updaterPendingInfo(dir), JSON.stringify({ fileName: 'MamaTheraFinance-1.0.18-setup.exe' }));
      writeFileSync(join(dir, 'installer.exe'), 'octets');
      const verdict = await invalidateUpdaterCache({ dir, sleep: async () => {} });
      assert.equal(verdict.ok, true);
      assert.equal(verdict.purged, true);
      assert.equal(existsSync(updaterPendingInfo(dir)), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dit « aucun cache » sans échouer quand le dossier n’existe pas', async () => {
    const verdict = await invalidateUpdaterCache({ dir: join(tmpdir(), 'mama-updater-cache-absent-xyz'), sleep: async () => {} });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.purged, false);
    assert.match(verdict.detail, /aucun cache à invalider/);
  });
});
