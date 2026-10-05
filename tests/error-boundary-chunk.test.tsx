/**
 * Test DOM ciblé : le bouton « Réessayer » face à un IMPORT DYNAMIQUE échoué.
 *
 * React.lazy mémorise la promesse rejetée — remonter le sous-arbre la rejoue à
 * l'identique. Le filet de sécurité doit donc tenter un rechargement (gardé)
 * au lieu de vider l'état d'erreur, sinon « Réessayer » est un cul-de-sac.
 * Ce cas vit dans son propre fichier DOM pour ne pas alourdir la suite
 * ErrorBoundary existante (fichier CRLF au diff large).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { installDomGlobals } from './harness';

const win = installDomGlobals();

const theme = {
  card: 'bg-white',
  border: 'border-slate-200',
  muted: 'text-slate-500',
  isDark: false,
  accentBg: 'accent-surface',
  accentHover: 'accent-surface-hover',
  accentText: 'accent-surface-text',
  accentShadow: 'accent-shadow',
};

// Le message exact renvoyé par Vite quand le chunk de la vue Dépenses n'est
// plus servi (serveur de dev relancé, déploiement, réseau).
const ChunkBomb = () => {
  throw new Error('Failed to fetch dynamically imported module: http://127.0.0.1:3000/src/components/ExpensesView.tsx');
};

describe('ErrorBoundary — « Réessayer » sur un import dynamique échoué', () => {
  it('tente un rechargement et laisse la carte affichée (pas de rejeu de la promesse rejetée)', () => {
    const originalError = console.error;
    console.error = () => {};
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          createElement(ErrorBoundary, {
            currentTheme: theme,
            label: 'la vue',
            children: createElement(ChunkBomb),
          }),
        );
      });

      const alert = container.querySelector('[role="alert"]');
      assert.ok(alert, 'la carte d’erreur s’affiche au lieu d’un écran blanc');
      assert.match(alert!.textContent ?? '', /dynamically imported module/, 'le message Vite est montré');

      const retry = [...container.querySelectorAll('button')].find((b) => /Réessayer/.test(b.textContent ?? ''));
      assert.ok(retry, 'le bouton Réessayer existe');
      act(() => { (retry as HTMLButtonElement).click(); });

      // La reprise réelle est un rechargement (window.location.reload, no-op
      // sous happy-dom) : le sous-arbre fautif N'EST PAS remonté, donc la carte
      // reste — c'est ce qui distingue du cul-de-sac « vider l'état ».
      assert.ok(container.querySelector('[role="alert"]'), 'la carte reste après Réessayer');
      assert.equal(win.sessionStorage.getItem('school-finance-chunk-reload-at') !== null, true, 'le rechargement gardé a été consigné');
    } finally {
      console.error = originalError;
      act(() => root.unmount());
      document.body.removeChild(container);
    }
  });
});
