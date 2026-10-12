// Suite for scripts/lib/csp-canary.mjs — le canari du collecteur CSP.
//
// La règle qu'elle verrouille : un « zéro violation » n'a de valeur que si le
// collecteur a prouvé qu'il VOIT. Un canal muet rend exactement le même zéro
// qu'une application propre — c'est le seul faux vert que la garde d'exécution
// (`scripts/verify-csp-guard.mjs`) ne pouvait pas distinguer, et il rassure.
//
// Les composites sont COMPOSÉS ici, jamais recopiés d'un run : une suite qui
// contiendrait le vrai signal ne prouverait que la forme de son propre texte.
// Les deux formes reproduites sont celles des deux canaux réels — celle de
// Chromium pour les événements CDP, celle que la garde pose elle-même en
// drainant l'événement in-page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANARY_CHANNELS,
  CANARY_URL,
  canaryUrlVerdict,
  canaryVerdict,
  isCanarySignal,
} from '../scripts/lib/csp-canary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Le canal CDP, dans la formulation de Chromium. */
const CONSOLE_SIGNAL =
  `[violation] Refused to load the script '${CANARY_URL}' because it violates the following ` +
  `Content Security Policy directive: "script-src 'self' 'unsafe-inline' https://*.supabase.co".`;

/** Le canal in-page : ce que la garde écrit pour un `script-src-elem` refusé. */
const IN_PAGE_SIGNAL = `[SecurityPolicyViolationEvent] script-src-elem → ${CANARY_URL}`;

describe('csp-canary — un zéro ne vaut que si le collecteur voit', () => {
  it('les deux canaux voient le refus connu : le verdict est autorisé', () => {
    const verdict = canaryVerdict({ signals: [CONSOLE_SIGNAL, IN_PAGE_SIGNAL] });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.deepEqual(verdict.missing, []);
    assert.equal(verdict.named, 2);
    assert.deepEqual(verdict.seen, {
      [CANARY_CHANNELS.CONSOLE]: true,
      [CANARY_CHANNELS.IN_PAGE]: true,
    });
    assert.match(verdict.reason, /vu par les deux canaux/);
  });

  it('un seul canal muet suffit à refuser le verdict — et il est NOMMÉ', () => {
    // Le cas mesuré qui a coûté ce canari : un `evaluateOnNewDocument` refusé au
    // lancement, donc l'écouteur in-page n'existe pas — et le canal console,
    // lui, parlait. Le verdict était vert quand même.
    const onlyConsole = canaryVerdict({ signals: [CONSOLE_SIGNAL] });
    assert.equal(onlyConsole.ok, false);
    assert.deepEqual(onlyConsole.missing, [CANARY_CHANNELS.IN_PAGE]);
    assert.match(onlyConsole.reason, /MUET/);
    assert.match(onlyConsole.reason, /in-page/);

    const onlyInPage = canaryVerdict({ signals: [IN_PAGE_SIGNAL] });
    assert.equal(onlyInPage.ok, false);
    assert.deepEqual(onlyInPage.missing, [CANARY_CHANNELS.CONSOLE]);
    assert.match(onlyInPage.reason, /console/);
  });

  it('aucun canal : c’est un refus, jamais un zéro', () => {
    const verdict = canaryVerdict({ signals: [] });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.named, 0);
    assert.deepEqual(verdict.missing, [CANARY_CHANNELS.CONSOLE, CANARY_CHANNELS.IN_PAGE]);
    assert.match(verdict.reason, /ne prouverait rien/);
  });

  it('un refus d’une AUTRE ressource, ou sans directive, ne tient pas lieu de preuve', () => {
    // Même exigence que la preuve du paquet Windows : la ressource EST nommée,
    // ET la directive qui l'a refusée. Un message qui parle du canari sans dire
    // ce qui l'a refusé n'apprend pas quel canal a parlé.
    const other = canaryVerdict({
      signals: [
        `[violation] Refused to load the script 'https://autre.invalid/x.js' because it violates the following Content Security Policy directive: "script-src 'self'".`,
      ],
    });
    assert.equal(other.ok, false);
    assert.equal(other.named, 0);

    const noDirective = canaryVerdict({
      signals: [`[violation] Refused to load the script '${CANARY_URL}'`],
    });
    assert.equal(noDirective.ok, false);
    assert.equal(noDirective.named, 0);
  });

  it('le bruit du canari est reconnaissable — et celui de l’application ne l’est pas', () => {
    assert.equal(isCanarySignal(CONSOLE_SIGNAL), true);
    assert.equal(isCanarySignal({ text: IN_PAGE_SIGNAL }), true);
    // Une violation RÉELLE ne doit jamais être retirée du verdict : la retirer,
    // c'est blanchir ce que la garde existe pour voir.
    assert.equal(
      isCanarySignal(
        `[violation] Refused to load the image 'https://cdn.example.com/logo.png' because it violates the following Content Security Policy directive: "img-src 'self'".`,
      ),
      false,
    );
  });

  it('un canari devenu NON refusable est refusé AVANT le navigateur', () => {
    // Interne, ou sur une origine autorisée : aucune violation n'arriverait, et
    // la garde accuserait ses canaux au lieu de son instrument.
    assert.notEqual(canaryUrlVerdict('https://mamathera-finance.vercel.app/known.js'), null);
    assert.match(String(canaryUrlVerdict('/local.js')), /EXTERNE/);
    assert.match(String(canaryUrlVerdict('http://127.0.0.1:3000/canari.js')), /invalid/);
    assert.match(String(canaryUrlVerdict('https://gap.example/')), /invalid/);
    assert.equal(canaryUrlVerdict(), null, 'le canari du dépôt est refusable par construction');
  });

  it('la garde d’exécution est CÂBLÉE sur ce jugement, et refuse un collecteur muet', () => {
    // Sans ce cas, le canari serait jugé ici et jamais utilisé là-bas : la garde
    // repartirait conclure « Zéro violation » sur des canaux muets, et cette
    // suite resterait verte — le pire des deux mondes.
    const guard = readFileSync(join(root, 'scripts', 'verify-csp-guard.mjs'), 'utf8');
    assert.match(guard, /from '\.\/lib\/csp-canary\.mjs'/, 'la garde doit lire par la couche partagée');
    assert.match(guard, /canaryUrlVerdict\(\)/, 'la garde doit refuser un canari non refusable');
    assert.match(guard, /canaryVerdict\(\{ signals:/, 'la garde doit juger son canari');
    assert.match(
      guard,
      /isCanarySignal\(violations\[i\]\)/,
      'le bruit du canari doit être retiré du verdict, sinon la garde échoue sur elle-même',
    );
    assert.match(
      guard,
      /if \(canaryMute\)[\s\S]{0,220}process\.exit\(2\)/,
      'un collecteur muet est une mesure impossible : sortie 2, pas un vert',
    );
  });
});
