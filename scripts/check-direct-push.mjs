#!/usr/bin/env node
/**
 * « Ce commit est-il arrivé sur `main` par une PR ? »
 *
 * La protection de branche GitHub est active, et depuis le 2026-11-08 elle
 * vaut aussi pour l'administrateur (`enforce_admins: true`) : un push direct
 * sur `main` est refusé par GitHub pour tous les comptes. Ce garde ne BLOQUE
 * rien — seul GitHub peut refuser un push — mais il rend le contournement
 * VISIBLE : un commit sans PR associée rend le run rouge, avec son SHA et la
 * marche à suivre. C'est ce qui distingue une règle écrite dans un document
 * d'une règle mesurée : le jour où la règle est retirée par mégarde, ce garde
 * le dit avant qu'un commit n'ait traversé les portes.
 *
 * Il n'y a plus d'exception de release : elles passent par une PR
 * (`npm run release:pr`). La règle vit dans scripts/lib/direct-push.mjs, où
 * elle est testée sans réseau.
 *
 * Variables du workflow : GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN.
 */
import { directPushVerdict } from './lib/direct-push.mjs';

const repo = String(process.env.GITHUB_REPOSITORY ?? '').trim();
const sha = String(process.env.GITHUB_SHA ?? '').trim();
const token = String(process.env.GITHUB_TOKEN ?? '').trim();

if (!repo.includes('/') || !sha) {
  console.error('❌ GITHUB_REPOSITORY / GITHUB_SHA absents — ce garde ne peut pas nommer le commit à juger.');
  process.exit(2);
}
if (!token) {
  // Sans jeton, la liste des PR est illisible : conclure « push direct » serait
  // une accusation fabriquée, conclure « PR » serait un vert fabriqué.
  console.error('❌ GITHUB_TOKEN absent — la liste des PR associées est illisible.');
  process.exit(2);
}

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'mama-thera-direct-push-guard',
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  return { ok: true, body: await res.json() };
}

const commit = await api(`/repos/${repo}/commits/${sha}`);
const message = commit.ok ? String(commit.body?.commit?.message ?? '') : '';

const pulls = await api(`/repos/${repo}/commits/${sha}/pulls`);
const associatedPulls = pulls.ok && Array.isArray(pulls.body) ? pulls.body : null;
if (!pulls.ok) {
  console.warn(`⚠️  PR associées illisibles (HTTP ${pulls.status}) — le commit n’est pas jugé.`);
}

const verdict = directPushVerdict({ associatedPulls, message });
const subject = message.split('\n')[0].slice(0, 100) || '(message illisible)';

if (!verdict.ok) {
  console.error(`❌ ${sha.slice(0, 12)} — ${verdict.reason}`);
  console.error(`   Commit : ${subject}`);
  console.error('   La protection de branche GitHub exige une PR : ce commit est donc arrivé par un contournement.');
  process.exit(1);
}

console.log(`✅ ${sha.slice(0, 12)} — ${verdict.reason} · ${subject}`);
