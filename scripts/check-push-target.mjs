#!/usr/bin/env node
/**
 * ─── La porte `pre-push` : refuser un push direct sur `main` ────────────────
 *
 * Lancé par `.husky/pre-push`, git lui tend sur l'entrée standard la liste des
 * références poussées. Ce script lit cette liste, demande le sujet du commit de
 * tête quand c'est `main`, et refuse — en NOMMANT la raison et le chemin de
 * remplacement — un push qui contournerait les portes du dépôt.
 *
 * Rien n'est deviné : zéro référence lue n'est pas un vert, c'est un exit 2
 * (« rien de vérifié »). Une API ou un `git` indisponible ne fabrique pas non
 * plus un refus : le hook ne doit pas bloquer un poste à cause d'un outil
 * manquant (la CI revérifie de toute façon).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MAIN_REF, parsePushLines, pushVerdict } from './lib/push-target.mjs';

function stdin() {
  try {
    return process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Le sujet du commit de tête — `null` quand git ne peut pas répondre. */
function tipSubjectOf(sha) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%s', String(sha)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const pushes = parsePushLines(stdin());
if (pushes.length === 0) {
  console.error('❌ check-push-target : aucune référence lue sur l’entrée standard — rien n’a été vérifié (exit 2).');
  process.exit(2);
}

const allowMain = process.env.ALLOW_MAIN_PUSH === '1';
let refused = 0;

for (const push of pushes) {
  const tipSubject = push.remoteRef === MAIN_REF ? tipSubjectOf(push.localSha) : null;
  const verdict = pushVerdict({ ...push, tipSubject, allowMain });
  const label = push.remoteRef === MAIN_REF ? 'main' : push.remoteRef.replace(/^refs\/heads\//, '');
  if (verdict.ok) {
    console.log(`✅ ${label} : ${verdict.reason}`);
  } else {
    console.error(`❌ ${label} : ${verdict.reason}`);
    refused += 1;
  }
}

if (refused > 0) process.exit(1);
