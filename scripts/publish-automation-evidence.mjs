#!/usr/bin/env node
/**
 * ─── Publier la preuve d'action d'une automatisation ───────────────────────
 *
 *   node scripts/publish-automation-evidence.mjs --acted  --reason "3 PR remises à jour" --count 3
 *   node scripts/publish-automation-evidence.mjs --inert  --reason "secret DEPENDABOT_REBASE_TOKEN absent"
 *
 * C'est la façon de publier une preuve quand l'automatisation n'a PAS de script à
 * elle — le déploiement Vercel, l'empaquetage Windows — c'est-à-dire quand la
 * seule chose mesurable est que la commande tierce est allée au bout. Le module
 * qui porte le contrat (scripts/lib/automation-evidence.mjs) compose l'annotation,
 * ce script la valide et l'imprime, et l'audit relit l'annotation STOCKÉE : un
 * producteur qui fabriquerait la commande à la main pourrait en changer le titre,
 * le niveau ou le sens sans que rien ne le voie.
 *
 * Une automatisation qui a du code à elle ne passe PAS par ici : elle publie
 * elle-même ses chiffres, par scripts/lib/evidence-publisher.mjs, depuis le script
 * qui les a mesurés — et seulement si l'étape qui l'exécute lui en a donné le
 * mandat (`AUTOMATION_EVIDENCE: '1'`). Le partage est net : ce CLI prouve qu'une
 * commande est allée au bout, les scripts prouvent ce qu'ils ont mesuré.
 *
 * CE QUE LE SCRIPT REFUSE, ET POURQUOI CHAQUE REFUS EXISTE
 * -------------------------------------------------------
 *   • un SUJET qui n'est pas le workflow en train de tourner : `--workflow` doit
 *     correspondre à `GITHUB_WORKFLOW_REF` (la preuve porte le nom du fichier qui
 *     tourne, imposé par le runner, jamais choisi) ;
 *   • une raison VIDE : « j'ai agi » sans dire quoi n'est pas une preuve ;
 *   • `--acted --count 0` : une preuve qui déclare avoir agi sur zéro chose se
 *     contredit elle-même. Sans objet à compter, on n'imprime pas `--count` ;
 *   • `--acted` ET `--inert` ensemble : le verdict ne peut pas être les deux.
 *
 * En local (hors runner), l'absence de `GITHUB_WORKFLOW_REF` exige `--workflow`
 * explicitement : le script ne devine jamais le sujet d'une preuve.
 *
 * La validation vit dans `parseEvidenceArgs` (module partagé), donc elle se teste
 * sans lancer un processus : sur ce poste, chaque fork de ce script coûtait ~10 s,
 * ce qui aurait rendu la suite plus lente que ce qu'elle protège.
 *
 * Sortie : la commande d'annotation, en DERNIÈRE ligne — c'est elle que le runner
 * intercepte et stocke en champs structurés (titre, message).
 */
import {
  EVIDENCE_STEP_NAME,
  EVIDENCE_TITLE,
  evidenceAnnotation,
  parseEvidenceArgs,
} from './lib/automation-evidence.mjs';

const parsed = parseEvidenceArgs({ argv: process.argv.slice(2), env: process.env });
if (!parsed.ok) {
  console.error(`❌ Preuve refusée : ${parsed.error}`);
  process.exit(2);
}

const { workflow, acted, reason, count } = parsed;

console.log(
  acted
    ? `✅ Preuve d’action : ${workflow} — ${reason}${count === null ? '' : ` (${count})`}`
    : `⚠️  Preuve d’inaction : ${workflow} — ${reason}`,
);
console.log(`ℹ️  canal : annotation « ${EVIDENCE_TITLE} », étape « ${EVIDENCE_STEP_NAME} »`);
console.log(evidenceAnnotation({ workflow, acted, reason, count }));
