// Suite for src/components/AuditWeekExportCard.tsx — « chaque fin de semaine,
// l'admin et le dev téléchargent le journal d'audit de la semaine en PDF ».
//
// Ce que ces cas mesurent, et pourquoi ils passent par le VRAI rendu :
//   • la carte lit sa semaine par une requête BORNÉE (les bornes passées au port
//     de données sont celles de la semaine choisie) — une carte qui lirait les
//     cent dernières entrées passerait un test de compilation sans rien prouver ;
//   • le bouton n'annonce un téléchargement que s'il y a quelque chose à écrire,
//     et le compte affiché est celui qui a été chargé ;
//   • le clic produit UN fichier, dont les octets sont un PDF et dont le nom
//     porte la clé ISO de la semaine — pas la date du jour.
//
// Le harnais est celui de tests/browser-download.test.ts : un DOM réel
// (happy-dom) et des compteurs posés sur ce qui SORT de l'application.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { AuditWeekExportCard } from '../src/components/AuditWeekExportCard';
import { auditWeekOf } from '../src/lib/auditWeek';
import { translations } from '../src/i18n/translations';
import type { AuditLogEntry, LogAuditParams } from '../src/lib/auditLogger';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';
import { mockModule } from './module-mock';

// Le journal d'audit est MOCKÉ, et il doit l'être AVANT que la carte ne l'importe
// (son import est différé au clic, voir recordWeekArchive) : le vrai module tire
// le client de base, qui refuse de se construire sans variables d'environnement.
// On capture donc l'écriture au lieu de la provoquer — c'est le CONTRAT de
// l'entrée qui est mesuré ici, pas le sort du réseau (le cas hors ligne de la
// file d'attente appartient à offline-every-write).
const archiveWrites: LogAuditParams[] = [];
mockModule('../src/lib/auditLogger', {
  logAuditEvent: async (params: LogAuditParams): Promise<boolean> => {
    archiveWrites.push(params);
    return true;
  },
});

const t = translations.fr;
const win = installDomGlobals();

/** L'instant du jour : les entrées de recette tombent donc dans la semaine en cours. */
const nowIso = new Date().toISOString();

function entry(id: string, action: string, minutesAgo: number): AuditLogEntry {
  return {
    id,
    userEmail: 'admin@mamathera.org',
    userName: 'Admin Test',
    userRole: 'admin',
    action,
    details: 'Paiement de 80000 FCFA (reçu REC-1)',
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

const FIXTURE: AuditLogEntry[] = [
  entry('e1', 'RECORD_PAYMENT', 5),
  entry('e2', 'ADD_STUDENT', 30),
];

interface Capture {
  clicks: string[];
  blobs: Blob[];
  ranges: Array<{ from: string; to: string }>;
}

interface Scene {
  capture: Capture;
  /** Le conteneur de CETTE carte — jamais « le dernier du body » (fragile). */
  container: HTMLElement;
}

/** Un domicile de données qui n'accepte que la FENÊTRE qu'on lui demande. */
async function withCapture(
  entries: AuditLogEntry[],
  fn: (scene: Scene) => Promise<void> | void,
): Promise<Capture> {
  const capture: Capture = { clicks: [], blobs: [], ranges: [] };
  const url = globalThis.URL as unknown as Record<string, unknown>;
  const realCreate = url.createObjectURL;
  const realClick = win.HTMLAnchorElement.prototype.click;
  url.createObjectURL = (blob: Blob) => {
    capture.blobs.push(blob);
    return `blob:${capture.blobs.length}`;
  };
  win.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    capture.clicks.push(this.getAttribute('download') ?? '');
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = makeProps({
    t,
    lang: 'fr',
    fetchAuditJournalRange: async (from: string, to: string) => {
      capture.ranges.push({ from, to });
      return entries;
    },
  });
  try {
    await act(async () => {
      root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(AuditWeekExportCard)));
    });
    // Laisse la requête de montage se résoudre (le compte affiché en dépend).
    await act(async () => {});
    await fn({ capture, container });
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    url.createObjectURL = realCreate;
    win.HTMLAnchorElement.prototype.click = realClick;
  }
  return capture;
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent ?? '').trim() === label,
  );
  assert.ok(found.length > 0, `bouton « ${label} » rendu`);
  return found[0] as HTMLButtonElement;
}

describe('Réglages — le journal d’audit de la semaine sort en PDF', () => {
  it('la carte demande la FENÊTRE de la semaine en cours, pas les dernières entrées', async () => {
    const current = auditWeekOf(new Date());
    await withCapture(FIXTURE, ({ capture }) => {
      assert.equal(capture.ranges.length, 1, 'une requête au montage');
      assert.equal(capture.ranges[0]!.from, current.startIso, 'la borne basse est le lundi de la semaine');
      assert.equal(capture.ranges[0]!.to, current.endIso, 'la borne haute est le dimanche de la semaine');
    });
  });

  it('le clic écrit UN PDF, nommé par la clé ISO de la semaine', async () => {
    const current = auditWeekOf(new Date());
    await withCapture(FIXTURE, async ({ capture, container }) => {
      const button = buttonByText(container, t.auditWeeklyJournalDownload);
      assert.equal(button.disabled, false, 'il y a des entrées : le bouton est actif');
      await act(async () => {
        button.click();
      });
      assert.equal(capture.clicks.length, 1, 'un rapport, un téléchargement — jamais deux');
      assert.equal(capture.clicks[0], `Journal_Audit_MAMA_THERA_${current.key}.pdf`);
      const head = Buffer.from(await capture.blobs[0]!.arrayBuffer()).subarray(0, 5).toString();
      assert.equal(head, '%PDF-', 'les octets téléchargés sont bien un PDF');
    });
  });

  it('annonce le nombre d’entrées chargées — ce qui sera écrit est ce qui est dit', async () => {
    await withCapture(FIXTURE, ({ container }) => {
      assert.equal(
        (container.textContent ?? '').includes(t.auditWeeklyJournalCount.replace('{count}', '2')),
        true,
        'le compte affiché est celui des entrées de la semaine',
      );
    });
  });

  it('l’archive s’inscrit ELLE-MÊME dans le journal — c’est la preuve que le rappel relira', async () => {
    // C'est cette entrée que src/lib/auditArchive.ts cherchera : si le geste ne
    // laissait pas de trace, « la semaine n'est pas archivée » ne se lèverait
    // jamais. Un PDF écrit sans elle serait une archive qui ne compte pas.
    const current = auditWeekOf(new Date());
    archiveWrites.length = 0;
    await withCapture(FIXTURE, async ({ container }) => {
      await act(async () => {
        buttonByText(container, t.auditWeeklyJournalDownload).click();
      });
      await act(async () => {});
    });
    assert.equal(archiveWrites.length, 1, 'une archive, une entrée de journal');
    const written = archiveWrites[0]!;
    assert.equal(written.action, 'EXPORT_AUDIT_JOURNAL');
    assert.equal(written.targetType, 'audit_week');
    assert.equal(written.targetId, current.key, 'la cible est la clé ISO de la semaine archivée');
    assert.equal(written.details, `Journal_Audit_MAMA_THERA_${current.key}.pdf`, 'et le détail nomme le fichier écrit');
  });

  it('rien n’est inscrit AVANT le geste : le rappel ne s’éteint que sur une archive produite', async () => {
    // L'insertion vient APRÈS la génération. Ouvrir la carte, choisir la semaine,
    // même rafraîchir la liste : aucun de ces gestes ne doit déclarer la semaine
    // archivée — sinon le rappel s'éteindrait sur une archive qui n'existe pas.
    archiveWrites.length = 0;
    await withCapture(FIXTURE, async ({ container }) => {
      assert.equal(buttonByText(container, t.auditWeeklyJournalDownload).disabled, false);
      assert.equal(archiveWrites.length, 0, 'rien n’est inscrit avant le clic');
    });
  });

  it('une semaine sans entrée : le bouton est refusé et l’écran le dit', async () => {
    const capture = await withCapture([], async ({ container }) => {
      const button = buttonByText(container, t.auditWeeklyJournalDownload);
      assert.equal(button.disabled, true, 'rien à archiver : le bouton est inactif');
      assert.equal(
        (container.textContent ?? '').includes(t.auditWeeklyJournalEmpty),
        true,
        'et l’écran dit POURQUOI il n’y a rien à télécharger',
      );
    });
    assert.equal(capture.clicks.length, 0, 'aucun fichier vide n’est écrit');
  });
});
