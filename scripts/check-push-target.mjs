#!/usr/bin/env node
/**
 * ─── La porte `pre-push` : refuser un push direct sur `main` ────────────────
 *
 * Lancé par `.husky/pre-push`, git lui tend sur l'entrée standard la liste des
 * références poussées. Ce script lit cette liste et refuse — en NOMMANT la
 * raison et le chemin de remplacement — un push vers `main`, qui contournerait
 * les portes du dépôt. Il n'y a plus d'exception de release : elles passent
 * elles aussi par une PR (`npm run release:pr`).
 *
 * Rien n'est deviné : zéro référence lue n'est pas un vert, c'est un exit 2
 * (« rien de vérifié »). Une API ou un `git` indisponible ne fabrique pas non
 * plus un refus : le hook ne doit pas bloquer un poste à cause d'un outil
 * manquant (la CI revérifie de toute façon).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MAIN_REF, fallbackPushLine, parsePushLines, pushVerdict } from './lib/push-target.mjs';

function stdin() {
  try {
    return process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Une réponse de `git`, ou `null` quand git ne peut pas répondre. */
function gitOut(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Le sujet du commit de tête n'est plus jugé : il n'existe plus d'exception
 *  par message (une release est une PR comme une autre). */

let pushes = parsePushLines(stdin());

// Git for Windows 2.56 ne remplit pas l'entrée standard du hook (0 octet mesuré
// le 2026-11-08) : refuser sur ce vide rendrait le dépôt impoussable, et un
// garde impoussable se désactive. On déduit donc la branche de `HEAD` — en le
// DISANT — et on garde le refus en dernier recours quand même `HEAD` est
// illisible (HEAD détaché) : lì, rien n'est vérifiable, donc exit 2.
if (pushes.length === 0) {
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = gitOut(['rev-parse', 'HEAD']);
  const line = fallbackPushLine(branch, sha);
  if (!line) {
    console.error('❌ check-push-target : aucune référence lue, et `HEAD` ne nomme pas de branche — rien n’a été vérifié (exit 2).');
    process.exit(2);
  }
  console.log(`ℹ️  entrée standard vide (git ne l’a pas remplie) — branche déduite de HEAD : ${branch}`);
  pushes = parsePushLines(line);
}

const allowMain = process.env.ALLOW_MAIN_PUSH === '1';
let refused = 0;

for (const push of pushes) {
  const verdict = pushVerdict({ ...push, allowMain });
  const label = push.remoteRef === MAIN_REF ? 'main' : push.remoteRef.replace(/^refs\/heads\//, '');
  if (verdict.ok) {
    console.log(`✅ ${label} : ${verdict.reason}`);
  } else {
    console.error(`❌ ${label} : ${verdict.reason}`);
    refused += 1;
  }
}

if (refused > 0) process.exit(1);
