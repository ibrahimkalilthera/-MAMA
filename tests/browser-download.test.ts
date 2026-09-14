// Suite for src/lib/browserDownload.ts — le SEUL endroit qui émet un
// téléchargement.
//
// L'incident : le reçu d'un parent arrivait deux fois sur les postes installés.
// La cause principale était côté Electron (voir electron/download-policy.cjs),
// mais le défaut a survécu parce que le MÉCANISME était recopié dans quatre
// modules PDF, plus une cinquième copie écrite à la main dans l'export CSV du
// journal d'audit. Cinq exemplaires d'une opération qui doit se produire une
// fois : corriger celui d'où venait la plainte suffisait à croire le problème
// réglé, et un seul oubli suffisait à le ramener.
//
// Ces cas verrouillent donc deux choses : un appel = UN téléchargement (et pas
// deux), et aucune surface ne ré-implémente le mécanisme — ni `doc.save()`, qui
// télécharge par un chemin que plus personne ne contrôle ici.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { downloadBytes } from '../src/lib/browserDownload';
// La prose n'est pas du code : un commentaire qui CITE `doc.save()` ne doit pas
// faire rougir le contrôle (le dépôt a payé trois fois cette leçon).
import { maskComments } from '../scripts/lib/source-text.mjs';
import { installDomGlobals } from './harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const collect = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

const rel = (file: string) => file.replace(root, '').replace(/\\/g, '/').replace(/^\//, '');

/** Un DOM réel (happy-dom) et des compteurs sur ce qui SORT de l'app. */
const withCapture = async (
  fn: (c: { clicks: string[]; blobs: Blob[]; revoked: string[] }) => Promise<void> | void,
) => {
  const win = installDomGlobals();
  const clicks: string[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const url = globalThis.URL as unknown as Record<string, unknown>;
  const realCreate = url.createObjectURL;
  const realRevoke = url.revokeObjectURL;
  const realClick = win.HTMLAnchorElement.prototype.click;
  url.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return `blob:${blobs.length}`;
  };
  url.revokeObjectURL = (u: string) => void revoked.push(u);
  win.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push(this.getAttribute('download') ?? '');
  };
  try {
    await fn({ clicks, blobs, revoked });
  } finally {
    url.createObjectURL = realCreate;
    url.revokeObjectURL = realRevoke;
    win.HTMLAnchorElement.prototype.click = realClick;
  }
};

describe('downloadBytes — un appel, UN téléchargement', () => {
  it('pose le nom, le type, clique une fois, et ne laisse rien derrière', async () => {
    await withCapture(({ clicks, blobs }) => {
      downloadBytes(new Uint8Array([1, 2, 3]), 'Recu_REC-1_Rahim.pdf');
      assert.deepEqual(clicks, ['Recu_REC-1_Rahim.pdf'], 'un clic, un nom — pas deux téléchargements');
      assert.equal(blobs.length, 1, 'une seule URL d’objet créée');
      assert.equal(blobs[0].type, 'application/pdf', 'le type par défaut est celui des reçus');
      assert.equal(document.querySelectorAll('a').length, 0, 'le lien temporaire est retiré du document');
    });
  });

  it('honore un autre type (l’export CSV du journal)', async () => {
    await withCapture(({ clicks, blobs }) => {
      downloadBytes(new Uint8Array([0xef, 0xbb, 0xbf]), 'audit-log.csv', 'text/csv;charset=utf-8');
      assert.deepEqual(clicks, ['audit-log.csv']);
      assert.equal(blobs[0].type, 'text/csv;charset=utf-8');
    });
  });

  it('n’émet pas deux fois le même document quand on l’appelle deux fois', async () => {
    await withCapture(({ clicks }) => {
      downloadBytes(new Uint8Array([1]), 'a.pdf');
      downloadBytes(new Uint8Array([1]), 'b.pdf');
      assert.deepEqual(clicks, ['a.pdf', 'b.pdf'], 'deux appels = deux fichiers, jamais trois');
    });
  });

  it('RÉVOQUE l’URL plus tard, jamais dans la foulée du clic', async (t) => {
    // Révoquer immédiatement annule le téléchargement en cours — c'est ce que
    // faisait la copie écrite à la main dans l'export CSV. Le cas le mesure : rien
    // n'est révoqué au moment du clic, et l'URL l'est ensuite.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withCapture(({ revoked }) => {
      downloadBytes(new Uint8Array([1]), 'x.pdf');
      assert.deepEqual(revoked, [], 'l’URL reste vivante pendant le téléchargement');
      t.mock.timers.tick(4000);
      assert.deepEqual(revoked, ['blob:1'], 'puis elle est libérée');
    });
  });

  it('un VRAI rapport jsPDF sort par l’émetteur, une fois, avec ses octets', async () => {
    // Le cas le plus utile : un des six chemins convertis (`doc.save()` → notre
    // émetteur), exécuté pour de vrai. Un agent qui se contente de vérifier que ça
    // compile ne verrait pas un `output('arraybuffer')` vide.
    const { generateExpensesReportPdf } = await import('../src/lib/pdfExpensesReport');
    await withCapture(async ({ clicks, blobs }) => {
      await generateExpensesReportPdf({ expenses: [], vendorExpenses: [], selectedYear: '2026-2027' });
      assert.equal(clicks.length, 1, 'un rapport, un téléchargement');
      assert.match(clicks[0], /^MAMA_THERA_Rapport_Depenses_2026-2027_\d{4}-\d{2}-\d{2}\.pdf$/);
      const head = Buffer.from(await blobs[0].arrayBuffer()).subarray(0, 5).toString();
      assert.equal(head, '%PDF-', 'les octets téléchargés sont bien un PDF');
    });
  });

  it('ne fait rien hors navigateur (rendu serveur), sans lever', () => {
    const saved = globalThis.document;
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true, writable: true });
    try {
      assert.doesNotThrow(() => downloadBytes(new Uint8Array([1]), 'y.pdf'));
    } finally {
      Object.defineProperty(globalThis, 'document', { value: saved, configurable: true, writable: true });
    }
  });
});

describe('downloadBytes est le SEUL émetteur du dépôt', () => {
  const sources = collect(join(root, 'src'));

  const codeOf = (file: string) => maskComments(readFileSync(file, 'utf8'));

  it('un seul fichier pose un attribut `download`', () => {
    const emitters = sources.filter((file) => /\.download\s*=/.test(codeOf(file))).map(rel);
    assert.deepEqual(
      emitters,
      ['src/lib/browserDownload.ts'],
      'un second émetteur peut diverger du premier — c’est exactement ce qui a laissé survivre le reçu téléchargé deux fois',
    );
  });

  it('aucun module ne télécharge plus par `doc.save()` (chemin non contrôlé ici)', () => {
    const offenders = sources.filter((file) => /\bdoc\.save\(/.test(codeOf(file))).map(rel);
    assert.deepEqual(offenders, [], 'les octets doivent passer par `downloadBytes`');
  });

  it('chaque surface qui FABRIQUE un document emploie l’émetteur', () => {
    // Le critère est « ce fichier construit un document », pas « son nom commence
    // par pdf » : `pdfStamp.ts` dessine le cachet sur un document qu'on lui passe,
    // il n'en fabrique aucun — le compter comme producteur ferait rougir un
    // fichier juste (et un contrôle qui rougit sur du code juste s'apprend à
    // l'ignorer).
    const producers = sources.filter((file) => {
      const text = codeOf(file);
      // Les deux familles du dépôt : jsPDF construit un document, pdf-lib charge
      // le modèle de l'école et le tamponne.
      return /new jsPDF\(/.test(text) || /PDFDocument\.(load|create)\(/.test(text);
    });
    assert.ok(producers.length >= 9, 'les producteurs de PDF doivent être là — sinon ce cas ne mesure rien');
    const missing = producers.filter((file) => !/downloadBytes\(/.test(codeOf(file))).map(rel);
    assert.deepEqual(missing, [], 'ces modules produisent un PDF sans passer par l’émetteur unique');
    assert.match(codeOf(join(root, 'src/components/AuditView.tsx')), /downloadBytes\(/, 'l’export CSV suit la même règle');
  });
});
