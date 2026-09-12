/**
 * happy-dom render tests for the mandatory-update gate (src/components/UpdateBanner.tsx).
 *
 * WHY THIS EXISTS
 * ---------------
 * Three triggers made the update VISIBLE (startup, every 30 min, on window
 * focus) — they did not make it MANDATORY. A school PC can therefore stay
 * months on the same version with nobody ever having decided not to update it.
 * Past the lag threshold (`electron/updater-policy.cjs`: one major, two minors,
 * or 45 days since publication without installing), the update stops being a
 * question: the banner becomes a full screen that cannot be closed.
 *
 * The policy suite (tests/updater-policy.test.ts) proves the DECISION. This one
 * proves what the user actually gets, because a blocking screen has a failure
 * mode that no decision test can catch: a gate that can be dismissed anyway, or
 * a gate with no way out when the update can never arrive.
 *
 *   • forced + downloaded → full screen, no dismiss cross, restart button;
 *   • forced + downloading → full screen with the progress, still no way out;
 *   • forced + error → the ONE escape valve: « continue without updating » plus
 *     a retry button, and the valve disappears as soon as the version is ready;
 *   • not forced → the ordinary banner, cross included, exactly as before.
 *
 * Pure suite: happy-dom (installDomGlobals), react-dom/client, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { UpdateBanner } from '../src/components/UpdateBanner';
import type { UpdateLabels } from '../src/components/UpdateBanner';
import { installDomGlobals } from './harness';

installDomGlobals();

const LABELS: UpdateLabels = {
  available: 'dispo {version}',
  downloading: 'téléchargement {percent}%',
  ready: 'prête {version}',
  readyManual: 'manuelle {version}',
  restart: 'Redémarrer',
  download: 'Télécharger',
  dismiss: 'Masquer',
  forcedTitle: 'Mise à jour obligatoire',
  forcedMajor: 'vous êtes en {current}, version {version} : {behind} majeure(s) de retard',
  forcedMinor: 'vous êtes en {current}, version {version} : {behind} mineure(s) de retard',
  forcedAge: 'version {version} publiée depuis {days} jours',
  forcedNote: 'report impossible',
  forcedFailed: 'échec {detail}',
  forcedRetry: 'Relancer',
  forcedContinue: 'Continuer sans mettre à jour',
};

interface FakeState {
  status?: string;
  version?: string | null;
  currentVersion?: string | null;
  action?: 'restart' | 'open-download';
  percent?: number;
  detail?: string;
  forced?: boolean;
  forcedCode?: string;
  behindMajor?: number | null;
  behindMinor?: number | null;
  releaseAgeDays?: number | null;
}

/** A fake desktop bridge, built the way the preload exposes the real one. */
function installBridge(state: FakeState): { retried: () => number; installed: () => number } {
  let retries = 0;
  let installs = 0;
  Object.defineProperty(globalThis, 'desktop', {
    value: {
      updates: {
        getState: async () => state,
        onState: () => () => {},
        install: async () => { installs += 1; },
        retry: async () => { retries += 1; },
      },
    },
    configurable: true,
    writable: true,
  });
  return { retried: () => retries, installed: () => installs };
}

async function mount(state: FakeState): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(UpdateBanner, { labels: LABELS }));
  });
  // The state arrives through a promise (getState()): one more turn so the
  // assertion sees what the user sees, not the empty first paint.
  await act(async () => {
    await Promise.resolve();
  });
  return { root, container };
}

const unmount = (root: Root, container: HTMLElement) => {
  act(() => root.unmount());
  document.body.removeChild(container);
};

const gateOf = (container: HTMLElement) => container.querySelector('[data-update-gate="forced"]');
const buttonSaying = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
const textOf = (el: Element | null) => el?.textContent ?? '';

describe('la porte du retard — obligatoire veut dire obligatoire', () => {
  it('version prête et obligatoire : écran plein, aucune croix, un bouton pour appliquer', async () => {
    const bridge = installBridge({
      status: 'downloaded',
      version: '2.0.0',
      currentVersion: '1.0.0',
      action: 'restart',
      forced: true,
      forcedCode: 'major',
      behindMajor: 1,
    });
    const { root, container } = await mount({
      status: 'downloaded',
      version: '2.0.0',
      currentVersion: '1.0.0',
      action: 'restart',
      forced: true,
      forcedCode: 'major',
      behindMajor: 1,
    });

    const gate = gateOf(container);
    assert.ok(gate, 'la porte est rendue');
    assert.match(textOf(gate), /2\.0\.0/, 'la version disponible est nommée');
    assert.match(textOf(gate), /1\.0\.0/, 'la version du poste est nommée');
    assert.match(textOf(gate), /1 majeure\(s\) de retard/, 'le motif est chiffré');
    assert.equal(container.querySelector('[aria-label="Masquer"]'), null, 'aucune croix : obligatoire');
    assert.equal(buttonSaying(container, 'Continuer'), undefined, 'aucune issue quand tout va bien');
    const apply = buttonSaying(container, 'Redémarrer');
    assert.ok(apply, 'un bouton applique la mise à jour');
    act(() => (apply as HTMLButtonElement).click());
    assert.equal(bridge.installed(), 1, 'le bouton demande vraiment l’installation');

    unmount(root, container);
  });

  it('téléchargement en cours et obligatoire : la progression ne rend pas la sortie possible', async () => {
    const state: FakeState = {
      status: 'downloading',
      version: '1.3.0',
      currentVersion: '1.0.0',
      percent: 42,
      forced: true,
      forcedCode: 'minor',
      behindMinor: 3,
    };
    installBridge(state);
    const { root, container } = await mount(state);

    const gate = gateOf(container);
    assert.ok(gate, 'la porte est déjà là pendant le téléchargement');
    assert.match(textOf(gate), /42%/, 'la progression est visible');
    assert.match(textOf(gate), /3 mineure/, 'le motif est chiffré');
    assert.equal(buttonSaying(container, 'Continuer'), undefined, 'pas de sortie pendant le téléchargement');

    unmount(root, container);
  });

  it('téléchargement en échec : la seule issue, et un bouton qui relance pour de vrai', async () => {
    const state: FakeState = {
      status: 'error',
      version: '1.5.1',
      currentVersion: '1.0.0',
      detail: 'réseau injoignable',
      forced: true,
      forcedCode: 'age',
      releaseAgeDays: 60,
    };
    const bridge = installBridge(state);
    const { root, container } = await mount(state);

    const gate = gateOf(container);
    assert.ok(gate, 'un échec de téléchargement ne doit pas faire disparaître l’obligation — il doit se voir');
    assert.match(textOf(gate), /60 jours/, 'le motif de retard survit à l’échec');
    assert.match(textOf(gate), /réseau injoignable/, 'la cause réelle est affichée');
    const retry = buttonSaying(container, 'Relancer');
    assert.ok(retry, 'un remède immédiat, pas « attendez 30 minutes »');
    act(() => (retry as HTMLButtonElement).click());
    assert.equal(bridge.retried(), 1, 'la relance passe par le pont');

    const bypass = buttonSaying(container, 'Continuer sans mettre à jour');
    assert.ok(bypass, 'un poste qu’on ne peut pas mettre à jour ne doit pas être inutilisable');
    act(() => (bypass as HTMLButtonElement).click());
    assert.equal(gateOf(container), null, 'la porte se lève quand l’utilisateur choisit de continuer');

    unmount(root, container);
  });

  it('une mise à jour ordinaire garde son bandeau et sa croix', async () => {
    const state: FakeState = {
      status: 'downloading',
      version: '1.0.1',
      currentVersion: '1.0.0',
      percent: 10,
      forced: false,
      forcedCode: 'none',
    };
    installBridge(state);
    const { root, container } = await mount(state);

    assert.equal(gateOf(container), null, 'rien d’obligatoire ⇒ pas d’écran plein');
    assert.match(textOf(container), /téléchargement 10%/, 'le bandeau habituel est là');
    assert.ok(container.querySelector('[aria-label="Masquer"]'), 'et il se masque — c’est du bruit, pas une obligation');

    unmount(root, container);
  });

  it('version prête mais NON obligatoire : le bandeau reste, mais ne se masque plus', async () => {
    const state: FakeState = {
      status: 'downloaded',
      version: '1.0.1',
      currentVersion: '1.0.0',
      action: 'restart',
      forced: false,
      forcedCode: 'none',
    };
    installBridge(state);
    const { root, container } = await mount(state);

    assert.equal(gateOf(container), null);
    assert.match(textOf(container), /prête 1\.0\.1/, 'le bandeau annonce la version prête');
    assert.equal(
      container.querySelector('[aria-label="Masquer"]'),
      null,
      'une version déjà téléchargée ne se cache pas (comportement d’origine préservé)',
    );
    assert.ok(buttonSaying(container, 'Redémarrer'), 'et le clic est à portée');

    unmount(root, container);
  });

  it('sans application de bureau, aucun écran ne s’impose au site web', async () => {
    Object.defineProperty(globalThis, 'desktop', { value: undefined, configurable: true, writable: true });
    const { root, container } = await mount({ status: 'downloaded', forced: true, version: '9.0.0' });
    assert.equal(container.textContent, '', 'le web se met à jour tout seul : rien à imposer');

    unmount(root, container);
  });
});
