// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/evidence-publisher.mjs — comment un SCRIPT d'automatisation
// publie sa propre preuve, sans que personne ait à lui faire confiance.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le canal de preuve était parfait et la substance manquait : chaque workflow
// portait une étape qui publiait « j'ai agi » — une PHRASE ÉCRITE DANS LE YAML,
// identique qu'un script se soit trompé de base ou n'ait rien examiné, tant que
// les étapes d'avant ne rougaient pas. Autrement dit : la moitié « structurée »
// du contrat, et la moitié qui compte — ce que l'automatisation a RÉELLEMENT
// mesuré — laissée à la prose de son lanceur. La preuve de Dependabot était la
// seule à venir de son script (lui seul savait combien de PR avaient bougé), et
// c'est exactement le modèle que ce module généralise : l'automatisation
// publie, son script connaît les chiffres, le workflow ne fait que le lancement.
//
// POURQUOI UN MANDAT, ET PAS UNE SIMPLE BONNE VOLONTÉ
// ---------------------------------------------------
// Un script qui publierait dès qu'il imprime déposerait une preuve dans le
// journal de N'IMPORTE QUEL job qui l'exécute : c'est le défaut mesuré du
// 2026-09-12, où `npm test` importait le script Dependabot et faisait accuser
// `Quality & performance guard` avec le motif de quelqu'un d'autre. Le rôle de
// producteur est donc ACCORDÉ par l'étape qui exécute le script
// (`AUTOMATION_EVIDENCE: '1'` dans l'étape YAML), jamais déduit de
// l'environnement. Une suite de tests qui lance le même script reste muette :
// elle n'a pas le mandat, donc elle ne parle pas au nom du job qui la fait
// tourner. Le mandat est visible dans le workflow, à l'endroit exact où
// l'automatisation travaille — donc auditable par un humain comme par un test.
//
// LE SUJET, ENCORE ET TOUJOURS
// ----------------------------
// Deux façons de nommer son sujet, et une seule règle pour choisir :
//   • un script qui a une IDENTITÉ (le rebase Dependabot n'existe que pour son
//     workflow) déclare son fichier et signe sous ce nom — même s'il est lancé
//     depuis un job qui annonce autre chose, ce qui arrive pour de vrai : la suite
//     de `perf-guard.yml` exécute ce script dans SON job ;
//   • un script PARTAGÉ par deux workflows (l'audit RLS anon tourne contre la pile
//     locale ET contre la base distante) n'a pas d'identité à écrire : il prend le
//     sujet du runner, qui est alors le seul à savoir qui l'appelle.
// Un script qui se tromperait d'identité ne se fait pas croire pour autant : sa
// preuve nomme un workflow qui n'est pas celui du run, donc l'audit la compte
// comme ÉTRANGÈRE et son propre run reste « sans preuve » — l'erreur est rouge, pas
// silencieuse. Le CLI, lui, n'a pas d'identité : il exige que le sujet déclaré soit
// celui qui tourne (parseEvidenceArgs), parce qu'il ne parle que pour son lanceur.
//
// UNE PREUVE REFUSÉE FAIT ROUGIR LE SCRIPT (elle ne s'imprime pas en silence)
// --------------------------------------------------------------------------
// Raison vide, `--acted` sans rien à compter, deux états à la fois : la
// validation est celle du CLI (`parseEvidenceArgs`), donc il n'y a qu'une
// définition du contrat. Mais ici le refus LÈVE : une automatisation qui ne peut
// pas prouver ce qu'elle a fait n'est pas une automatisation verte.
// ─────────────────────────────────────────────────────────────────────────────

import {
  evidenceAnnotation,
  parseEvidenceArgs,
  workflowFileFromRef,
} from './automation-evidence.mjs';

/** Le mandat : sans lui, un script publie mais ne parle à personne. */
export const EVIDENCE_MANDATE_ENV = 'AUTOMATION_EVIDENCE';

/**
 * Publie la preuve d'action d'un script d'automatisation.
 *
 * @param {{ acted?: boolean, reason?: string, count?: number|null, workflow?: string }} input
 * @param {{ env?: Record<string, string|undefined>, out?: (line: string) => void }} [options]
 * @returns {{ published: boolean, workflow: string|null, reason: string }}
 */
export function publishEvidence(input = {}, { env = process.env, out = (line) => console.log(line) } = {}) {
  const mandated = String(env[EVIDENCE_MANDATE_ENV] ?? '') === '1';
  if (!mandated) {
    // Hors mandat : silence explicable, et rien qui ressemble à une preuve.
    out(
      `ℹ️  preuve non publiée : ${EVIDENCE_MANDATE_ENV}=1 n’est pas posé — un script exécuté par autre ` +
        'chose qu’une étape d’automatisation (une suite de tests, un lancement à la main) ne parle pas ' +
        'au nom du job qui le fait tourner.',
    );
    return { published: false, workflow: null, reason: 'sans mandat' };
  }

  // L'état n'est posé QUE s'il est déclaré : un producteur qui oublie `acted`
  // doit se faire refuser (« les deux états ou aucun »), pas publier une inaction
  // par défaut — c'est la même règle que pour le CLI, écrite une seule fois.
  const argv = [];
  if (typeof input?.acted === 'boolean') argv.push(input.acted ? '--acted' : '--inert');
  argv.push('--reason', String(input?.reason ?? ''));
  if (Number.isInteger(input?.count)) argv.push('--count', String(input.count));

  // Le sujet est RÉSOLU ici, puis validé par la règle commune (`parseEvidenceArgs`
  // reçoit un environnement sans référence de runner : le sujet est déjà tranché).
  const subject = String(input?.workflow ?? '').trim() || workflowFileFromRef(env.GITHUB_WORKFLOW_REF || '');
  if (subject) argv.push('--workflow', subject);
  const parsed = parseEvidenceArgs({ argv, env: { ...env, GITHUB_WORKFLOW_REF: '' } });
  if (!parsed.ok) {
    // Une preuve refusée n'est pas une preuve absente : le script doit rougir,
    // sinon l'automatisation serait verte sur un contrat cassé.
    throw new Error(
      `preuve refusée (${parsed.error}) — un producteur mandaté qui ne peut pas prouver ce qu’il a fait ne finit pas vert.`,
    );
  }

  out(evidenceAnnotation(parsed));
  return { published: true, workflow: parsed.workflow, reason: parsed.reason };
}
