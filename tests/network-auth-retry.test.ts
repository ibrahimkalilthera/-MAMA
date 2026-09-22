// Suite for the token-rejection path in src/lib/networkUtils.ts.
//
// WHY THIS EXISTS
// ---------------
// On a freshly installed PC the app used to show a red banner reading
// `Problème de connexion à la base: … jwt secret …` on the first load after
// login, and the error vanished as soon as the user pressed « Réessayer ». That
// makes a manual click load-bearing, which is the defect: the failure is a
// TOKEN rejection (PostgREST PGRST300/301, or GoTrue « JWT issued at future » on
// a clock-skewed machine), and a token rejection is transient by construction —
// the client refreshes in the background. It is neither a network outage nor a
// permission refusal, so the retry ladder simply never ran (the thrown error was
// a plain `Error('Database errors: …')`, with no status to classify).
//
// Measured, not guessed: scripts/verify-desktop-app.mjs and
// scripts/verify-pdf-download.mjs both drive the real packaged app and click
// that retry button in a loop, labelled « JWT clock skew » — they are the
// standing proof that the state was reachable and self-healing.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import {
  errorText,
  formatSupabaseError,
  isAuthTokenError,
  isConnectivityFailure,
  isServerRefusal,
  retryWithBackoff,
} from '../src/lib/networkUtils';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The real messages the two servers answer with, word for word. */
const REJECTIONS = [
  'Database errors: PGRST300: a JWT secret is missing from the configuration',
  'Database errors: PGRST301: JWSError JWSInvalidSignature',
  'Database errors: jwt: signature is invalid',
  'Database errors: JWT issued at future',
];

/** Failures that must NOT be swallowed by a retry ladder. */
const NOT_REJECTIONS = [
  'Database errors: permission denied for table expenses',
  'Database errors: new row violates row-level security policy for table students',
  'Database errors: duplicate key value violates unique constraint "students_code_key"',
  'Database errors: relation "payments" does not exist',
  'Database errors: Invalid API key',
];

describe('un jeton refusé est reconnu comme tel', () => {
  it('les refus de jeton réels sont classés (PGRST300/301, signature, horloge)', () => {
    for (const message of REJECTIONS) {
      assert.equal(isAuthTokenError(message), true, message);
    }
  });

  it('un refus de permission, un doublon ou une clé fausse n’en sont PAS', () => {
    for (const message of NOT_REJECTIONS) {
      assert.equal(isAuthTokenError(message), false, message);
    }
  });

  it('le mot « token » seul ne suffit pas, ni le silence', () => {
    assert.equal(isAuthTokenError(''), false);
    assert.equal(isAuthTokenError('database connection issue'), false);
    // Une phrase qui parle de jeton sans qu'il soit refusé ne doit pas déclencher
    // une salve de tentatives : sinon chaque erreur deviendrait « transitoire ».
    assert.equal(isAuthTokenError('the token was used to book the room'), false);
  });
});

describe('la salve de tentatives couvre le refus de jeton (c’est ce qui supprime le clic)', () => {
  // `isRetryableError` reads navigator.onLine before anything else, and in Node
  // that property is undefined — so an unstubbed suite would take the
  // "offline ⇒ retry everything" branch and prove nothing about token handling.
  // The descriptor is restored, not overwritten with undefined, so the
  // formatter suite below still sees a real (Node) navigator.
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  before(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  });

  after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('un premier appel refusé par PGRST301 réussit à la tentative suivante', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Database errors: PGRST301: JWSError JWSInvalidSignature');
        return 'données';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    assert.equal(result, 'données');
    assert.equal(attempts, 2, 'le refus de jeton doit avoir été retenté, pas rendu au premier essai');
  });

  it('un refus de permission, lui, remonte immédiatement (et reste bruyant)', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        retryWithBackoff(async () => {
          attempts += 1;
          throw new Error('Database errors: permission denied for table expenses');
        }, { maxRetries: 3, baseDelayMs: 1 }),
      /permission denied/,
    );
    assert.equal(attempts, 1, 'inutile de retenter ce qui ne se répare pas');
  });
});

describe('le bandeau dit quoi faire au lieu d’afficher « jwt secret »', () => {
  it('un refus de jeton est expliqué, avec l’horloge du PC comme piste', () => {
    const fr = formatSupabaseError('Database errors: PGRST300: a JWT secret is missing', 'fr');
    assert.equal(fr.isRetryable, true);
    assert.match(fr.title, /Jeton/i);
    assert.match(fr.message, /date et l'heure de ce PC/);
    // Le texte brut reste présent : sans lui, plus rien ne relie le bandeau au
    // journal du serveur, et un diagnostic réel deviendrait impossible.
    assert.match(fr.message, /PGRST300/);

    const en = formatSupabaseError('Database errors: JWT issued at future', 'en');
    assert.match(en.message, /date and time/);
  });
});

describe('le câblage : la tentative suivante repart avec un jeton neuf', () => {
  it('fetchAll rafraîchit la session quand la panne est un jeton refusé', () => {
    const source = readFileSync(join(root, 'src', 'lib', 'useSupabaseData.ts'), 'utf8');
    // Sans ce rafraîchissement, la salve rejouerait les mêmes requêtes avec le
    // MÊME jeton refusé : le retry ne servirait à rien.
    assert.match(
      source,
      /onRetry: \(attempt, error\) => \{[\s\S]{0,600}isAuthTokenError\([\s\S]{0,200}refreshSession\(\)/,
      'le refus de jeton doit rafraîchir la session avant de réessayer',
    );
    // Le crochet importe désormais aussi la porte hors ligne du module
    // (`isStationOffline`), d'où la liste non figée : ce qui compte est que les
    // DEUX fonctions de networkUtils dont il dépend viennent bien de là.
    const imports = /import \{([^}]*)\} from '\.\/networkUtils'/.exec(source)?.[1] ?? '';
    for (const name of ['isAuthTokenError', 'retryWithBackoff', 'isStationOffline']) {
      assert.match(imports, new RegExp(`\\b${name}\\b`), `${name} doit venir de networkUtils`);
    }
  });

  it('le bandeau passe le message par le formateur (plus de chaîne brute du serveur)', () => {
    const shell = readFileSync(join(root, 'src', 'components', 'AppShell.tsx'), 'utf8');
    assert.match(shell, /formatSupabaseError\(supabaseError, lang\)\.message/);
    // Le titre historique reste en tête : les scripts E2E qui pilotent
    // l'application empaquetée le cherchent pour détecter l'état dégradé.
    assert.match(shell, /\{t\.databaseConnectionIssue\}/);
  });
});

// ─── « Le serveur a refusé » contre « je n'ai pas pu le joindre » ───────────
//
// WHY THIS EXISTS
// ---------------
// Mesuré : `isConnectivityFailure({ message: 'Failed to fetch' }, true)`
// rendait **false**. La cause est la lecture de l'erreur — `error instanceof
// Error ? error.message : String(error)`. Un objet d'erreur qui n'est PAS une
// instance d'`Error` (erreur franchie par le pont IPC d'Electron, sérialisée,
// ou construite à la main) se stringifiait en « [object Object] » : le mot
// « fetch » y disparaissait, et `status` étant absent, la panne réseau se lisait
// comme un refus du serveur. L'écran de connexion affichait alors le libellé brut
// du transport — « Failed to fetch » — et un poste sans réseau restait fermé,
// sans même consulter le vérificateur local qu'il possédait.
//
// Le second test tient la règle qui rend ce cas impossible : c'est le REFUS
// explicite qui ferme la porte hors ligne, pas la reconnaissance de la panne. Un
// objet d'erreur inattendu doit donc descendre au vérificateur (voir
// `isServerRefusal` et son usage dans src/lib/useAuth.ts).
describe('une panne de transport ne se lit jamais comme un refus du serveur', () => {
  /** Formes d'une erreur réseau réellement rencontrées, avec leur verdict. */
  const CONNECTIVITY = [
    ['objet simple, sans statut (traversée IPC/sérialisation)', { message: 'Failed to fetch' }],
    ['objet simple avec statut 0', { message: 'Failed to fetch', status: 0 }],
    ['instance d’Error', new Error('Failed to fetch')],
    ['TypeError de fetch', new TypeError('Failed to fetch')],
    ['formulation Chromium/Electron : DNS', new TypeError('net::ERR_NAME_NOT_RESOLVED')],
    ['formulation Chromium/Electron : pas de réseau', new Error('net::ERR_INTERNET_DISCONNECTED')],
    ['formulation Electron : connexion refusée', new Error('net::ERR_CONNECTION_REFUSED')],
    ['formulation Firefox', new TypeError('NetworkError when attempting to fetch resource.')],
    ['formulation Safari', new TypeError('Load failed')],
    ['objet sans `toString` (String() lèverait)', Object.assign(Object.create(null), { message: 'fetch failed' })],
    ['passerelle morte pour un amont mort', { message: 'Bad gateway', status: 502 }],
    ['service indisponible un instant', { message: 'Service unavailable', status: 503 }],
  ] as const;

  it('toutes les formes d’une panne réseau sont reconnues', () => {
    for (const [nom, error] of CONNECTIVITY) {
      assert.equal(isConnectivityFailure(error, true), true, nom);
    }
  });

  it('aucune de ces formes n’est prise pour un refus du serveur', () => {
    for (const [nom, error] of CONNECTIVITY) {
      assert.equal(isServerRefusal(error), false, nom);
    }
  });

  it('un refus RÉEL du serveur reste un refus, et n’est pas une panne', () => {
    const REFUSALS = [
      'Invalid login credentials',
      'Email not confirmed',
      'Too many requests',
      'User is banned',
    ] as const;
    for (const message of REFUSALS) {
      assert.equal(isServerRefusal({ message }), true, message);
      assert.equal(isConnectivityFailure({ message }, true), false, message);
    }
    // Le statut seul suffit aussi (GoTrue/GoTrue-compatible sans libellé connu).
    assert.equal(isServerRefusal({ message: 'refused', status: 400 }), true);
    assert.equal(isServerRefusal({ message: 'refused', status: 429 }), true);
    // Et le code, quand c'est lui qui porte le verdict.
    assert.equal(isServerRefusal({ message: 'nope', code: 'invalid_credentials' }), true);
  });

  it('le texte d’une erreur se lit quelle que soit sa forme, sans jamais lever', () => {
    assert.equal(errorText({ message: 'Failed to fetch' }), 'Failed to fetch');
    assert.equal(errorText(new Error('Failed to fetch')), 'Failed to fetch');
    // GoTrue écrit `error_description`, et un `msg` arrive des réponses brutes.
    assert.equal(errorText({ error_description: 'Invalid login credentials' }), 'Invalid login credentials');
    assert.equal(errorText({ msg: 'Email not confirmed' }), 'Email not confirmed');
    assert.equal(errorText('plain'), 'plain');
    assert.equal(errorText(null), '');
    assert.equal(errorText(undefined), '');
    // `String()` lèverait sur cet objet : on doit rendre la main, pas jeter.
    assert.doesNotThrow(() => errorText(Object.create(null)));
  });
});
