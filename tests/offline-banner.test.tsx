// The offline banner is where a station TELLS the user what is happening: no
// network, which data is on screen, what is waiting to be sent, and what the
// database already refused. Rendered directly (the shell-level overlay suite
// locks that it appears exactly once; this one locks what it SAYS).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { installDomGlobals } from './harness';

const win = installDomGlobals();

const { OfflineBanner } = await import('../src/components/ToastNotification');
const { translations } = await import('../src/i18n/translations');

const t = translations.fr as unknown as Record<string, string>;

const realOnLine = win.navigator.onLine;

function setOnline(value: boolean) {
  Object.defineProperty(win.navigator, 'onLine', { value, configurable: true });
}

function renderBanner(props: Record<string, unknown>): { container: HTMLElement; text: () => string } {
  // Le `document` global (posé par le harnais) porte les types DOM réels : le
  // même objet que celui de happy-dom, sans passer par ses types à lui.
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(OfflineBanner, { lang: 'fr', t, ...props } as never));
  });
  return { container, text: () => container.textContent ?? '' };
}

describe('bandeau hors ligne — ce que le poste dit à l’utilisateur', () => {
  afterEach(() => {
    setOnline(realOnLine);
  });

  it('ne s’affiche pas quand tout va bien', () => {
    setOnline(true);
    const { container } = renderBanner({ pendingCount: 0 });
    assert.equal(container.textContent, '', 'rien à dire : rien à l’écran');
  });

  it('hors ligne, il dit d’OÙ viennent les données affichées', () => {
    setOnline(false);
    const { text } = renderBanner({ pendingCount: 0, cacheSavedAt: '2026-09-20T08:12:00.000Z' });
    assert.match(text(), /Hors ligne/);
    assert.match(text(), /Données enregistrées sur ce poste/, 'la date de l’instantané est nommée');
    assert.match(text(), /20\/09/, 'et lisible en clair');
  });

  it('hors ligne SANS instantané, il le dit aussi (pas d’écran vide sans explication)', () => {
    setOnline(false);
    const { text } = renderBanner({ pendingCount: 0, cacheSavedAt: null });
    assert.match(text(), /Aucune donnée enregistrée sur ce poste/);
  });

  it('en ligne avec de l’attente : le compte et le bouton de synchronisation', () => {
    setOnline(true);
    const { text } = renderBanner({ pendingCount: 3, onSync: () => {} });
    assert.match(text(), /3 transaction/);
    assert.ok(text().includes(t.syncNow), `le bouton « ${t.syncNow} » est offert`);
  });

  it('session hors ligne : PAS de bouton (rien ne peut partir) et la raison est écrite', () => {
    setOnline(true);
    let syncs = 0;
    const { text } = renderBanner({ pendingCount: 3, onSync: () => { syncs += 1; }, offlineSession: true });
    assert.ok(!text().includes(t.syncNow), 'un bouton qui ne peut rien envoyer ne doit pas être offert');
    assert.match(text(), /session hors ligne/);
    assert.equal(syncs, 0);
  });

  it('ce que la base a REFUSÉ est distingué de ce qui attend', () => {
    setOnline(true);
    const { text } = renderBanner({ pendingCount: 4, pendingFailures: 2 });
    assert.match(text(), /2 saisie\(s\) refusée\(s\) par la base/);
    assert.match(text(), /toujours en attente/, 'elles ne sont pas perdues : elles restent en file');
  });

  it('reconnexion refusée : il le DIT, en rouge, sans proposer de synchroniser', () => {
    setOnline(true);
    const { container, text } = renderBanner({ pendingCount: 2, onSync: () => {}, reauthFailed: true });
    assert.match(text(), /la session n’a pas pu être rouverte|la session n'a pas pu être rouverte/);
    assert.ok(!text().includes(t.syncNow));
    const banner = container.firstElementChild;
    assert.ok(banner?.className.includes('rose'), 'une reconnexion refusée n’est pas une bonne nouvelle');
  });
});
