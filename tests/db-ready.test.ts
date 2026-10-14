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

  it('le gate interroge le contrôle qui existe déjà, pas une seconde liste de tables', () => {
    assert.equal(DB_READY_SCRIPT, 'scripts/check-hosted-schema.mjs');
    assert.equal(existsSync(join(root, DB_READY_SCRIPT)), true, 'le contrôle nommé doit exister : un gate qui appelle un script absent refuserait toujours');
    assert.match(source, /import \{ DB_READY_SCRIPT, judgeDbReady \} from '\.\/lib\/db-ready\.mjs'/);
    assert.match(source, /execFileSync\(process\.execPath, \[DB_READY_SCRIPT\]/, 'la sonde est le contrôle du dépôt, appelé tel quel');
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
    assert.match(source, /const verdict = judgeDbReady\(probe\)/);
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
