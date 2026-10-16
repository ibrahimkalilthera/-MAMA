// Suite du gate « la base porte-t-elle ce que ce build embarque ? »
// (scripts/lib/db-ready.mjs + son câblage dans scripts/publish-release.mjs).
//
// POURQUOI CETTE SUITE EXISTE
// ---------------------------
// L'ordre « la base d'abord, le build ensuite » n'était vérifié que par le
// déploiement du SITE : un autre canal, sur un autre déclencheur. Le BUILD de
// bureau pouvait donc partir vers tout le parc sans que rien ne regarde la base
// — et une publication ne se reprend pas. Ce gate ferme ce chemin, et ce qu'il
// faut verrouiller n'est pas sa couleur du jour (la base est à jour) mais ses
// deux propriétés :
//
//   • **il refuse** dans les deux cas qui comptent — la base est en retard, ET
//     le contrôle n'a pas pu rendre de verdict. Ce second cas est celui qu'un
//     gate écrit trop vite laisse passer : « je n'ai pas pu regarder » n'est pas
//     « c'est bon », et publier est irréversible ;
//   • **il refuse AVANT toute écriture** — avant la lecture du canal, avant le
//     premier `api(…, { method: 'POST' })`, avant le téléversement, avant la
//     promotion, et même en `--dry-run` : un « je ferais ceci » qui tairait un
//     refus ferait perdre une publication.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  APPLY_HINT,
  DB_READY_SCRIPTS,
  DB_READY_SCRIPT,
  STATUS_DELAYED,
  STATUS_UNVERIFIED,
  judgeDbReady,
  quoteVerdict,
} from '../scripts/lib/db-ready.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** La sortie réelle du contrôle quand une table déclarée manque en base. */
const DELAYED_OUTPUT = [
  '   ✅ students             27 colonne(s) déclarée(s), toutes présentes',
  '🔎 schéma hébergé — 16 table(s) déclarée(s) par 41 migration(s)',
  '❌ la base hébergée est EN RETARD sur les migrations — appliquez-les AVANT de déployer :',
  '   • table station_versions : « relation "public.station_versions" does not exist »',
].join('\n');

describe('le verdict du gate — deux refus, et jamais de vert sans preuve', () => {
  it('sortie 0 : la base porte les migrations, la publication peut continuer', () => {
    const verdict = judgeDbReady({ code: 0, output: '✅ la base hébergée porte tout (16 tables)' });
    assert.equal(verdict.ok, true, 'une base à jour autorise la suite du publieur');
    assert.equal(verdict.verdict, 'ready');
    assert.equal(verdict.title, '', 'un succès n’a pas de titre de refus');
    assert.deepEqual(verdict.problems, []);
  });

  it('sortie 1 : la base est EN RETARD — refus, avec l’objet en retard et le remède', () => {
    const verdict = judgeDbReady({ code: STATUS_DELAYED, output: DELAYED_OUTPUT });
    assert.equal(verdict.ok, false, 'une migration déclarée absente de la base interdit de publier');
    assert.equal(verdict.verdict, 'delayed');
    assert.match(verdict.title, /ne porte pas les migrations/);
    const problems = verdict.problems.join('\n');
    assert.match(problems, /station_versions/, 'le refus NOMME l’objet en retard (un refus muet n’est pas réparable)');
    assert.match(problems, /EN RETARD/);
    assert.ok(verdict.problems.includes(APPLY_HINT), 'et il dit que la correction est une migration, jamais un build republié');
    assert.doesNotMatch(problems, /✅ students/, 'les lignes de succès sortent du refus : elles repousseraient le motif hors de l’écran');
  });

  it('sortie 2 : aucun verdict possible — refus quand même, et dit autrement', () => {
    const verdict = judgeDbReady({
      code: STATUS_UNVERIFIED,
      output: '❌ Aucune clé pour interroger la base (VITE_SUPABASE_ANON_KEY absente)',
    });
    assert.equal(verdict.ok, false, '« je n’ai pas pu regarder » n’est pas « c’est bon » : publier est irréversible');
    assert.equal(verdict.verdict, 'unverified');
    assert.match(verdict.title, /aucun verdict/);
    const problems = verdict.problems.join('\n');
    assert.match(problems, /pas pu rendre de verdict/);
    assert.ok(!verdict.problems.includes(APPLY_HINT), 'un défaut de lecture n’envoie pas appliquer une migration');
  });

  it('un code de sortie INCONNU refuse aussi : un gate qui laisse passer ce qu’il ne comprend pas n’existe pas', () => {
    const verdict = judgeDbReady({ code: 7, output: 'quelque chose' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.verdict, 'unverified');
    assert.match(verdict.problems.join('\n'), /sorti en 7/);
  });

  it('un statut ABSENT (processus tué par un signal) refuse — il ne vaut pas zéro', () => {
    // Le piège mesuré ailleurs : `Number(null)` vaut 0, donc lire `error.status`
    // d'un `execFileSync` interrompu comme « sortie 0 » autoriserait le publieur
    // exactement quand on ne sait rien.
    for (const code of [null, undefined, Number.NaN]) {
      const verdict = judgeDbReady({ code: code as number, output: '' });
      assert.equal(verdict.ok, false, `un statut ${String(code)} ne peut pas autoriser une publication`);
      assert.equal(verdict.verdict, 'unverified');
    }
  });

  it('le rapport cité garde la FIN (le verdict, puis le remède) et jette les succès', () => {
    const long = Array.from({ length: 40 }, (_, i) => `   ✅ table_${i} 3 colonne(s) déclarée(s), toutes présentes`)
      .concat(['❌ la base est EN RETARD', '   • table manquante : payments'])
      .join('\n');
    const quoted = quoteVerdict(long);
    assert.deepEqual(quoted, ['❌ la base est EN RETARD', '   • table manquante : payments']);
  });
});

describe('le câblage : le publieur juge la base AVANT tout accès au canal', () => {
  const source = read('scripts/publish-release.mjs');

  it('le gate interroge les contrôles qui existent déjà, pas une seconde liste de tables', () => {
    assert.equal(DB_READY_SCRIPT, 'scripts/check-hosted-schema.mjs');
    for (const entry of DB_READY_SCRIPTS) {
      assert.equal(
        existsSync(join(root, entry.script)),
        true,
        `le contrôle « ${entry.script} » doit exister : un gate qui appelle un script absent refuserait toujours`,
      );
    }
    assert.match(source, /import \{ DB_READY_SCRIPTS, judgeDbReady \} from '\.\/lib\/db-ready\.mjs'/);
    assert.match(source, /execFileSync\(process\.execPath, \[script\]/, 'chaque sonde est un contrôle du dépôt, appelé tel quel');
    assert.match(
      source,
      /DB_READY_SCRIPTS\.map\(\(\{ script \}\) => runDbProbe\(script\)\)/,
      'le publieur pose TOUTES les questions de la liste — il n’en choisit pas une',
    );
    assert.match(source, /const verdict = judgeDbReady\(\{ probes \}\)/);
    assert.doesNotMatch(
      source,
      /readdirSync\(join\(root, 'supabase\/migrations'\)\)/,
      'le publieur ne relit pas les migrations lui-même : deux lectures dériveraient l’une de l’autre',
    );
  });

  it('un refus du gate arrête la publication (fail), il ne l’avertit pas', () => {
    // Le verdict est le SEUL juge : la branche positive est explicite (`ok`,
    // elle imprime la preuve du contrôle et rend la main), et le chemin qu'un
    // verdict non vert emprunte est un `fail`. Il n'existe donc aucune lecture
    // par laquelle un refus continuerait — c'est la différence entre une porte
    // et un avertissement.
    assert.match(source, /const verdict = judgeDbReady\(\{ probes \}\)/);
    assert.match(
      source,
      /code: Number\(error\?\.status \?\? NaN\)/,
      'un contrôle tué sans code de sortie arrive en NaN — donc en REFUS, jamais en « sortie 0 »',
    );
    const positive = source.indexOf('if (verdict.ok) {');
    const leaves = source.indexOf('return;', positive);
    const refuses = source.indexOf('fail(verdict.title, verdict.problems)');
    assert.ok(positive > 0, 'la branche positive est explicite — pas un `else` implicite');
    assert.ok(leaves > positive, 'elle imprime la preuve du contrôle puis rend la main');
    assert.ok(refuses > leaves, 'et le chemin qu’un verdict non vert emprunte est un `fail`, jamais un avertissement');
  });

  it('le gate passe AVANT la lecture du canal, la première écriture et la promotion', () => {
    const gate = source.indexOf('\nassertMigrationsApplied();');
    const channelRead = source.indexOf("await api('/releases?per_page=100')");
    const firstWrite = source.indexOf("await api('/releases', {");
    const upload = source.indexOf('await uploadAsset(');
    const promote = source.indexOf('draft: false');
    assert.ok(gate > 0, 'le gate est appelé');
    assert.ok(channelRead > gate, 'la base est jugée avant même de LIRE le canal');
    assert.ok(firstWrite > gate, 'et avant la première écriture sur le dépôt');
    assert.ok(upload > gate, 'et avant le premier octet téléversé');
    assert.ok(promote > gate, 'et avant le geste qui rend la version visible du parc');
  });

  it('il passe aussi avant un --dry-run : un « je ferais ceci » qui tairait un refus ferait perdre une publication', () => {
    const gate = source.indexOf('\nassertMigrationsApplied();');
    const dryRunExit = source.indexOf('--dry-run : rien');
    assert.ok(dryRunExit > 0, 'le mode --dry-run existe');
    assert.ok(dryRunExit > gate, 'le gate est jugé avant de rendre la main au mode bavard');
  });

  it('les deux préconditions du build sont voisines, et la base vient d’abord', () => {
    const db = source.indexOf('\nassertMigrationsApplied();');
    const trust = source.indexOf('\nassertUpdaterTrust();');
    assert.ok(trust > 0, 'le contrat de mise à jour reste jugé avant tout accès au canal');
    assert.ok(db > 0 && db < trust, 'un refus qui parle de la base envoie corriger une migration, pas chercher un certificat');
  });
});

// ─── LES TROIS QUESTIONS, ET PAS UNE ─────────────────────────────────────────
//
// Ce que ce bloc verrouille est un défaut MESURÉ, pas une intuition : le
// 2026-10-16, la migration du réglage « nom de l'école »
// (`20261022000000_school_name.sql`) a été appliquée à la base partagée, et elle
// n'ajoute AUCUNE colonne — seulement une contrainte `CHECK`. Tant qu'elle
// n'était pas appliquée, le contrôle des COLONNES sortait **vert** pendant que
// celui des OBJETS sortait **rouge** en nommant
// `public.app_settings.app_settings_school_name_check` ABSENT du catalogue.
// Un publieur qui n'aurait posé que la première question aurait donc écrit
// « la base est prête » sur une base qui n'avait pas la règle du build.
const GREEN_PROBES = [
  { script: 'scripts/check-hosted-schema.mjs', code: 0, output: '✅ la base hébergée porte tout ce que les 45 migrations déclarent' },
  { script: 'scripts/check-db-objects.mjs', code: 0, output: '✅ les 51 index, contraintes et déclencheurs déclarés sont en base' },
  { script: 'scripts/check-rls-policies.mjs', code: 0, output: '✅ les 54 politiques déclarées sont en base' },
];

/** La sortie réelle du contrôle des objets quand la contrainte du nom manque. */
const OBJECTS_DELAYED_OUTPUT = [
  'Alignés                           : 50',
  '   ❌ constraint public.app_settings.app_settings_school_name_check — déclaré par 20261022000000_school_name.sql (c), ABSENT du catalogue',
  '❌ 1 objet(s) divergent entre les migrations et la base hébergée',
].join('\n');

describe('les trois questions — un seul refus suffit, et il est NOMMÉ', () => {
  it('les trois vertes : la base peut porter ce build', () => {
    const verdict = judgeDbReady({ probes: GREEN_PROBES });
    assert.equal(verdict.ok, true, 'trois verdicts verts autorisent la publication');
    assert.equal(verdict.verdict, 'ready');
    assert.equal(verdict.title, '');
  });

  it('un OBJET manquant refuse MÊME quand les colonnes sont vertes — le cas du nom d’école', () => {
    const verdict = judgeDbReady({
      probes: [
        GREEN_PROBES[0],
        { ...GREEN_PROBES[1], code: STATUS_DELAYED, output: OBJECTS_DELAYED_OUTPUT },
        GREEN_PROBES[2],
      ],
    });
    assert.equal(verdict.ok, false, 'les colonnes vertes ne rachètent pas une contrainte absente');
    assert.equal(verdict.verdict, 'delayed');
    assert.match(
      verdict.title,
      /index, les contraintes et les déclencheurs/,
      'le refus NOMME le contrôle qui a refusé — sinon il envoie chercher au mauvais endroit',
    );
    const problems = verdict.problems.join('\n');
    assert.match(problems, /app_settings_school_name_check/, 'et il nomme l’objet absent lui-même');
    assert.ok(verdict.problems.includes(APPLY_HINT), 'le remède reste une migration, jamais un build republié');
    assert.doesNotMatch(problems, /✅ les 51 index/, 'les lignes de succès sortent du rapport cité');
    assert.equal(
      verdict.problems.some((line) => line.includes('scripts/check-db-objects.mjs')),
      true,
      'le fichier appelé est cité, comme un lecteur de CI l’attend — pas seulement son libellé',
    );
  });

  it('un refus sur les POLITIQUES refuse aussi, et se dit par son nom', () => {
    const verdict = judgeDbReady({
      probes: [
        GREEN_PROBES[0],
        GREEN_PROBES[1],
        { ...GREEN_PROBES[2], code: STATUS_DELAYED, output: '❌ politiques absentes : app_settings_display_insert' },
      ],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.title, /politiques RLS/);
    assert.match(verdict.problems.join('\n'), /app_settings_display_insert/);
  });

  it('retard ET lecture impossible : le retard porte le verdict, l’autre est dit EN PLUS', () => {
    const verdict = judgeDbReady({
      probes: [
        GREEN_PROBES[0],
        { ...GREEN_PROBES[1], code: STATUS_DELAYED, output: OBJECTS_DELAYED_OUTPUT },
        { ...GREEN_PROBES[2], code: STATUS_UNVERIFIED, output: '❌ SUPABASE_DB_PASSWORD absent' },
      ],
    });
    assert.equal(verdict.verdict, 'delayed', 'un retard nommé est plus actionnable qu’une lecture manquée');
    const problems = verdict.problems.join('\n');
    assert.match(problems, /app_settings_school_name_check/);
    assert.match(problems, /politiques RLS/, 'le contrôle muet est NOMMÉ, il n’est pas noyé');
    assert.match(problems, /pas pu rendre de verdict/);
  });

  it('trois lectures impossibles : aucun verdict, donc refus — jamais un vert par défaut', () => {
    const verdict = judgeDbReady({
      probes: DB_READY_SCRIPTS.map((entry) => ({ script: entry.script, code: STATUS_UNVERIFIED, output: '❌ hors ligne' })),
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.verdict, 'unverified');
    const problems = verdict.problems.join('\n');
    for (const entry of DB_READY_SCRIPTS) assert.match(problems, new RegExp(entry.label));
    assert.ok(!verdict.problems.includes(APPLY_HINT), 'une lecture manquée n’envoie pas appliquer une migration');
  });

  it('un code INCONNU sur un seul contrôle refuse déjà, et il est nommé', () => {
    const verdict = judgeDbReady({
      probes: [GREEN_PROBES[0], { ...GREEN_PROBES[1], code: 7, output: 'quelque chose' }, GREEN_PROBES[2]],
    });
    assert.equal(verdict.ok, false, 'un gate qui laisse passer ce qu’il ne comprend pas n’existe pas');
    assert.equal(verdict.verdict, 'unverified');
    assert.match(verdict.problems.join('\n'), /sorti en 7/);
  });
});

// ─── LES DEUX CHAÎNES SONT ARRÊTÉES AVANT LE BUILD ───────────────────────────
//
// Le publieur juge la base avant sa PREMIÈRE REQUÊTE, mais il tourne après
// `electron:ui` et `electron-builder` : un refus y est encore à temps pour le
// parc, et trop tard pour le runner. Les deux chaînes portent donc la même
// question AVANT leur build — et ces cas la verrouillent, parce qu'un gate qui
// n'est lu par personne est un gate dont la suppression ne se remarque pas.
describe('les deux chaînes de publication sont arrêtées AVANT leur build', () => {
  const deploy = read('.github/workflows/deploy.yml');
  const desktop = read('.github/workflows/desktop-release.yml');
  /** Le nom npm d'un contrôle : `scripts/check-db-objects.mjs` → `check:db-objects`. */
  const scriptName = (entry: { script: string }) =>
    entry.script.replace('scripts/check-', 'check:').replace('.mjs', '');

  it('le déploiement du site juge les objets et les politiques AVANT `vercel build`', () => {
    const objects = deploy.indexOf('check:db-objects');
    const policies = deploy.indexOf('check:rls-policies');
    const build = deploy.indexOf('vercel build --prod');
    assert.ok(objects > 0, 'la porte des objets existe dans le déploiement du site');
    assert.ok(policies > objects, 'et celle des politiques la suit');
    assert.ok(build > policies, 'les deux sont jugées AVANT le build du site');
    assert.match(deploy, /SUPABASE_DB_PASSWORD/, 'les catalogues se lisent avec le mot de passe de la base');
  });

  it('la chaîne de bureau juge la base DANS LE GATE, donc avant le job de build', () => {
    const gateStep = desktop.indexOf('Gate — la base hébergée porte-t-elle ce que les migrations déclarent ?');
    const buildJob = desktop.indexOf('\n  build-sign-publish:');
    assert.ok(gateStep > 0, 'le gate de bureau juge la base');
    assert.ok(buildJob > gateStep, 'et il le fait avant que le job de build ne soit déclaré');
    assert.match(desktop, /build-sign-publish:\s*\r?\n\s*needs: gate/, 'le build dépend du gate : un gate rouge ne construit rien');
    assert.match(
      desktop,
      /npm run "\$script"/,
      'le refus est binaire ici : aucun code n’est mis de côté comme neutre, contrairement au site',
    );
    assert.doesNotMatch(desktop, /exit 78/, 'publier un installeur est irréversible : « je n’ai pas pu regarder » refuse aussi');
  });

  it('le job qui publie DONNE au publieur de quoi juger la base — la clé, et l’outillage', () => {
    // Mesuré le 2026-10-16 (run `38925043270`) : le gate a jugé la base (vert,
    // 45 migrations / 51 objets / 54 politiques), le build a produit ses cinq
    // octets, puis `release:publish` a REFUSÉ — « aucun verdict sur la base
    // hébergée » — parce que la clé de la base n'était posée que pour le gate.
    // Le gate d'avant-build ne dispense donc pas de nourrir le gate du PUBLIEUR :
    // c'est le seul que rien ne contourne (il s'applique aussi à un
    // `npm run release:publish` lancé à la main), et il juge AVANT sa première
    // requête. Ce cas verrouille les deux choses que la publication exige LÀ OÙ
    // elle tourne : la clé de la base, et `pg` — les deux questions de catalogue
    // se lisent par connexion directe, et `npm ci` n'installe pas un outillage
    // que le paquet ne déclare pas. Un des deux manquant, la porte refuse après
    // trois minutes de build au lieu de le dire avant.
    const buildJob = desktop.slice(desktop.indexOf('\n  build-sign-publish:'));
    assert.ok(buildJob.length > 0, 'le job de publication est déclaré');
    assert.match(
      buildJob,
      /SUPABASE_DB_PASSWORD/,
      'la clé de la base doit descendre jusqu’au job qui publie — sinon le publieur refuse faute de preuve',
    );
    assert.match(
      buildJob,
      /npm i --no-save pg/,
      'et `pg` doit être posé dans ce job-là : `npm ci` ne l’installe pas, et sans lui les deux catalogues restent illisibles',
    );
  });

  it('les deux chaînes nomment les MÊMES contrôles que la liste du module', () => {
    // Une liste recopiée dériverait de celle-ci : la veille `public-rls-watch`
    // exécute déjà ces trois scripts, les deux chaînes doivent s’y tenir pareil.
    for (const entry of DB_READY_SCRIPTS) {
      assert.equal(deploy.includes(scriptName(entry)), true, `le déploiement du site teste « ${scriptName(entry)} »`);
      assert.equal(desktop.includes(scriptName(entry)), true, `la chaîne de bureau teste « ${scriptName(entry)} »`);
    }
  });
});
