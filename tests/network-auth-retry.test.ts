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
import { formatSupabaseError, isAuthTokenError, retryWithBackoff } from '../src/lib/networkUtils';

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
    assert.match(source, /import \{ isAuthTokenError, retryWithBackoff \} from '\.\/networkUtils'/);
  });

  it('le bandeau passe le message par le formateur (plus de chaîne brute du serveur)', () => {
    const shell = readFileSync(join(root, 'src', 'components', 'AppShell.tsx'), 'utf8');
    assert.match(shell, /formatSupabaseError\(supabaseError, lang\)\.message/);
    // Le titre historique reste en tête : les scripts E2E qui pilotent
    // l'application empaquetée le cherchent pour détecter l'état dégradé.
    assert.match(shell, /\{t\.databaseConnectionIssue\}/);
  });
});
