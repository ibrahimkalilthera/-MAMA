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
 * Et une porte fermée ne doit pas être un SILENCE : un poste bloqué se signale.
 * Ce que la seconde moitié de cette suite protège, dans les deux sens : le
 * signalement part TOUT SEUL (attendre un clic, c'est rester muet tant que
 * personne n'est devant l'écran), il ne part qu'UNE fois par blocage (la
 * vérification revient toutes les 30 min, et un journal d'audit rempli de la
 * même panne cesse d'être lu), et un envoi impossible le DIT au lieu d'afficher
 * « signalé » pour toujours.
 *
 * Pure suite: happy-dom (installDomGlobals), react-dom/client, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { UpdateBanner } from '../src/components/UpdateBanner';
import type { UpdateLabels, UpdateState } from '../src/components/UpdateBanner';
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
  blockedTitle: 'Poste bloqué',
  blockedDetail: 'Raison inscrite au journal : {detail}',
  blockedReportPending: 'Signalement en cours…',
  blockedReportSent: 'Signalé à l’administrateur',
  blockedReportLocal: 'Pas de connexion : journal du poste ({path})',
  blockedJournal: 'Ouvrir le journal du poste',
};

// L'état du faux pont est EXACTEMENT celui du composant : un faux pont qui
// accepterait plus large que le vrai ne prouverait rien sur ce que l'application
// reçoit réellement.
type FakeState = UpdateState;

interface ReportCall {
  state: FakeState;
  sent: boolean;
}

/** A fake desktop bridge, built the way the preload exposes the real one. */
function installBridge(state: FakeState): {
  retried: () => number;
  installed: () => number;
  opened: () => number;
  push: (next: FakeState) => void;
} {
  let retries = 0;
  let installs = 0;
  let opened = 0;
  const listeners: Array<(s: FakeState) => void> = [];
  Object.defineProperty(globalThis, 'desktop', {
    value: {
      updates: {
        getState: async () => state,
        // Le pont réel pousse les changements d'état : la suite doit pouvoir le
        // faire aussi, sinon la règle « un seul signalement par blocage » ne se
        // vérifierait qu'en relançant l'application.
        onState: (cb: (s: FakeState) => void) => {
          listeners.push(cb);
          return () => {};
        },
        install: async () => { installs += 1; },
        retry: async () => { retries += 1; },
        openJournal: async () => { opened += 1; return { ok: true, path: state.blocked?.journal }; },
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    retried: () => retries,
    installed: () => installs,
    opened: () => opened,
    push: (next: FakeState) => { state = next; for (const cb of listeners) cb(next); },
  };
}

/**
 * Le rapport du bandeau : compté, et son verdict choisi par le test.
 *
 * La fonction rendue est passée DÉTACHÉE au composant (comme le fait le vrai
 * pont) : elle ne peut donc pas dépendre d'un `this`, et le compteur vit dans
 * la fermeture.
 */
function reportRecorder(sent: boolean): { calls: ReportCall[]; onReport: (s: FakeState) => Promise<{ sent: boolean; detail: string }> } {
  const calls: ReportCall[] = [];
  return {
    calls,
    onReport: async (state: FakeState) => {
      calls.push({ state, sent });
      return { sent, detail: 'poste PC-TEST · version 1.0.0 → 2.0.0' };
    },
  };
}

async function mount(
  state: FakeState,
  options: { onReport?: (s: FakeState) => Promise<{ sent: boolean; detail: string }> } = {},
): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = { labels: LABELS, ...(options.onReport ? { onReport: options.onReport } : {}) };
  await act(async () => {
    root.render(createElement(UpdateBanner, props));
  });
  // The state arrives through a promise (getState()): one more turn so the
  // assertion sees what the user sees, not the empty first paint.
  await flush();
  return { root, container };
}

/** Laisse tourner les promesses (getState, puis l'envoi du signalement). */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
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

describe('un poste bloqué se signale au lieu de rester muet', () => {
  const blockedState = (over: Partial<FakeState> = {}): FakeState => ({
    status: 'error',
    version: '2.0.0',
    currentVersion: '1.0.0',
    detail: 'réseau injoignable',
    forced: true,
    forcedCode: 'major',
    behindMajor: 1,
    blocked: {
      code: 'download',
      detail: 'téléchargement en échec (réseau injoignable)',
      station: 'PC-TEST',
      journal: 'C:/userData/update-journal.jsonl',
      recorded: true,
    },
    ...over,
  });

  it('le blocage s’annonce, et le signalement part SANS qu’on clique', async () => {
    const recorder = reportRecorder(true);
    const state = blockedState();
    installBridge(state);
    const { root, container } = await mount(state, { onReport: recorder.onReport });

    const gate = gateOf(container);
    assert.ok(gate, 'un poste bloqué par la porte doit se voir');
    assert.match(textOf(gate), /téléchargement en échec/, 'la cause du blocage est nommée');
    assert.match(textOf(gate), /Raison inscrite au journal : téléchargement en échec/, 'et elle est recopiée telle quelle, pas résumée');
    assert.equal(
      container.querySelector('[data-update-report]')?.getAttribute('data-update-report'),
      'sent',
      'l’administrateur a été prévenu sans qu’on ait à cliquer',
    );
    assert.equal(recorder.calls.length, 1, 'un signalement, pas zéro');
    assert.equal(recorder.calls[0].state.version, '2.0.0', 'le rapport porte la version visée');

    unmount(root, container);
  });

  it('le même blocage n’est signalé QU’UNE fois, même si l’état revient toutes les 30 min', async () => {
    const recorder = reportRecorder(true);
    const state = blockedState();
    const bridge = installBridge(state);
    const { root, container } = await mount(state, { onReport: recorder.onReport });
    assert.equal(recorder.calls.length, 1);

    await act(async () => { bridge.push({ ...state }); });
    await flush();
    assert.equal(recorder.calls.length, 1, 'la même panne ne remplit pas le journal d’audit à chaque vérification');

    await act(async () => {
      bridge.push({ ...state, version: '2.1.0', blocked: { ...state.blocked!, detail: 'nouvelle version, même échec' } });
    });
    await flush();
    assert.equal(recorder.calls.length, 2, 'un blocage sur une version PLUS RÉCENTE est une information neuve');

    unmount(root, container);
  });

  it('un envoi impossible le DIT, et le journal du poste reste à portée', async () => {
    const recorder = reportRecorder(false);
    const state = blockedState();
    const bridge = installBridge(state);
    const { root, container } = await mount(state, { onReport: recorder.onReport });

    const report = container.querySelector('[data-update-report]');
    assert.equal(report?.getAttribute('data-update-report'), 'local', 'pas de session ⇒ pas de « signalé » affiché');
    assert.match(textOf(report), /update-journal\.jsonl/, 'et le fichier où le blocage a été inscrit est nommé');

    const journal = buttonSaying(container, 'Ouvrir le journal');
    assert.ok(journal, 'le seul canal qui reste quand il n’y a pas de session');
    act(() => (journal as HTMLButtonElement).click());
    assert.equal(bridge.opened(), 1, 'le bouton ouvre vraiment le journal');

    unmount(root, container);
  });

  it('une installation qui n’a pas abouti ouvre la porte MÊME sans obligation en cours', async () => {
    const recorder = reportRecorder(true);
    const state: FakeState = {
      status: 'idle',
      version: null,
      currentVersion: '1.0.0',
      forced: false,
      forcedCode: 'none',
      blocked: {
        code: 'install',
        detail: 'installation précédente non aboutie — ce poste est revenu sur la même version',
        station: 'PC-TEST',
        journal: 'C:/userData/update-journal.jsonl',
        recorded: true,
      },
      action: 'restart',
    };
    installBridge(state);
    const { root, container } = await mount(state, { onReport: recorder.onReport });

    const gate = gateOf(container);
    assert.ok(gate, 'un échec d’installation est un fait, pas une opinion sur le retard');
    assert.match(textOf(gate), /installation précédente non aboutie/);
    assert.ok(buttonSaying(container, 'Relancer'), 'le remède est de revérifier, pas de réinstaller à l’aveugle');
    assert.equal(recorder.calls.length, 1, 'et il part au journal d’audit');

    unmount(root, container);
  });
});
