#!/usr/bin/env node
/**
 * La prod sert-elle ENFIN le build de ce commit ?
 *
 *   node scripts/wait-for-deployment.mjs --url=https://… --sha=$(git rev-parse HEAD)
 *
 * WHY THIS EXISTS
 * ---------------
 * Les E2E post-déploiement attendaient un `HTTP 200` de la racine. Un 200 est
 * satisfait par le déploiement PRÉCÉDENT : pendant la propagation de l'alias, un
 * cache de bord sert encore l'ancien HTML, et le pixel-check jugeait donc un
 * AUTRE commit que celui qu'on venait de publier — produisant un rouge qui
 * accusait l'application pour une page jamais publiée.
 *
 * Le build porte son identité (`scripts/lib/build-stamp.mjs`), et ce script
 * attend que la page SERVIE déclare celle du commit attendu. Le verdict est pur
 * (`scripts/lib/deployment-freshness.mjs`) : ici il n'y a que la lecture, la
 * cadence et le refus final.
 *
 * Ce qu'il REFUSE, et c'est le point : au bout du délai, un `stale` n'est pas
 * un échec de l'application — c'est un problème de PUBLICATION, et le message le
 * dit pour que personne n'aille chercher une régression de rendu. Un `unknown`
 * (page sans identité) est refusé aussi, et pour la raison du dépôt :
 * invérifiable n'est pas un vert — un E2E qui jugerait un build qu'il ne peut pas
 * nommer vaudrait le 200 qu'on vient de retirer.
 *
 * Il republie sa mesure quand une étape d'automatisation le mandate
 * (`AUTOMATION_EVIDENCE=1`) : ce qu'il a mesuré, c'est QUELLE identité la prod
 * sert — exactement la phrase dont un rapport E2E a besoin pour être honnête.
 */
import { FRESHNESS, freshnessVerdict } from './lib/deployment-freshness.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';

const flag = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const url = (flag('url') ?? '').trim();
const sha = (flag('sha') ?? '').trim();
const timeoutS = Number(flag('timeout') ?? 240);
const intervalS = Number(flag('interval') ?? 5);
const TIMEOUT_MS = 20000;

if (!url) {
  console.error('❌ --url manquant : sans adresse, il n’y a rien à attendre.');
  process.exit(2);
}
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  // Refus AVANT toute lecture, et pas un avertissement : sans le commit attendu,
  // ce script ne saurait pas distinguer le build publié du précédent — c'est la
  // seule chose qu'il sait faire, donc l'exécuter sans lui ne prouverait rien.
  console.error(
    `❌ --sha manquant ou invalide (« ${sha} ») : sans le commit attendu, ce contrôle ne peut pas ` +
      'distinguer le build qui vient d’être publié du précédent — or c’est exactement la confusion qui ' +
      'faisait juger le mauvais build.',
  );
  process.exit(2);
}

const read = async (target) => {
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'deployment-freshness', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, html: await res.text() };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.name ?? error?.message ?? error) };
  }
};

const deadline = Date.now() + Math.max(1, timeoutS) * 1000;
// Pas d'initialisation : la boucle ci-dessous s'exécute toujours au moins une
// fois, donc ce verdict est toujours posé avant d'être lu. Une valeur par défaut
// ne servirait qu'à donner l'illusion d'un état.
let last;
let attempts = 0;

for (;;) {
  attempts += 1;
  const got = await read(url);
  last = freshnessVerdict({ expectedSha: sha, url, status: got.status ?? null, html: got.html ?? '', error: got.error ?? null });
  console.log(`   essai ${attempts} — ${last.detail}`);
  if (last.state === FRESHNESS.FRESH) break;
  if (Date.now() >= deadline) break;
  await new Promise((r) => setTimeout(r, Math.max(1, intervalS) * 1000));
}

if (last.state !== FRESHNESS.FRESH) {
  console.error('');
  // L'ACCUSATION est choisie par l'état, et c'est tout l'intérêt : un `stale`
  // n'est pas l'application, et le dire évite d'envoyer chercher une régression
  // de rendu dans un build qui n'est même pas celui du commit testé.
  if (last.state === FRESHNESS.STALE) {
    console.error(
      `❌ la prod ne sert pas le build de ${sha.slice(0, 7)} après ${attempts} essai(s) : elle sert ` +
        `${last.served ? last.served.slice(0, 7) : 'un build inconnu'}. C’est un problème de PUBLICATION ` +
        '(propagation de l’alias ou cache de bord), jamais une régression de l’application — un E2E lancé ' +
        'maintenant jugerait un autre commit que celui qu’il croit tester.',
    );
  } else if (last.state === FRESHNESS.UNKNOWN) {
    console.error(
      `❌ la page servie par ${url} ne déclare aucune identité de build (${attempts} essai(s)). ` +
        'Invérifiable n’est pas un vert : un E2E qui juge un build qu’il ne peut pas nommer vaut le ' +
        'HTTP 200 qu’on vient justement de retirer de cette attente.',
    );
  } else {
    console.error(`❌ ${last.detail} — après ${attempts} essai(s) sur ${timeoutS}s.`);
  }
  if (last.warning) console.error(`   ⚠️  ${last.warning}`);
  process.exit(1);
}

console.log(`✅ ${last.detail} — ${attempts} essai(s)`);
if (last.warning) console.log(`   ⚠️  ${last.warning}`);

publishEvidence({
  acted: true,
  count: attempts,
  reason:
    `fraîcheur du déploiement confirmée avant le pixel-check : la page servie déclare le build ${sha.slice(0, 7)} ` +
    `de ce commit (${attempts} essai(s)) — le test juge donc bien le build publié, pas le précédent`,
});
