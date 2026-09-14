#!/usr/bin/env node
/**
 * check-updater-trust.mjs — mesurer si le PARC pourra recevoir la version
 * SUIVANTE, avant que la version ne soit publiée.
 *
 *   npm run check:updater-trust                    (dossier release/ par défaut)
 *   npm run check:updater-trust -- --dir=release
 *   npm run check:updater-trust -- --allow-test-signer   (dérogation explicite)
 *
 * ─── La dérogation, et pourquoi elle existe nommée ───────────────────────────
 * Publier signé avec le certificat de TEST est un choix qui appartient au
 * propriétaire du parc : le binaire porte alors une signature réelle, et en
 * échange chaque poste qui l'installe ne recevra plus rien du canal (signature
 * non approuvée ⇒ `ERR_UPDATER_INVALID_SIGNATURE`) — il faudra le remettre à
 * jour à la main, une fois. Le drapeau `--allow-test-signer` (ou
 * `ALLOW_TEST_SIGNER=1`) fait ce choix EXPLICITEMENT ; il reste absent par
 * défaut, il n'agit que si TOUS les noms promis sont des noms de test, et il ne
 * fait pas taire le refus : il le déplace dans un bloc qui dit la conséquence.
 * Le silence, lui, n'est jamais une option — un garde-fou qu'on lève en le
 * taisant n'est plus un garde-fou.
 *
 * ─── Pourquoi ce contrôle existe ─────────────────────────────────────────────
 * Le 2026-09-13, l'installeur publié sur le canal (1.0.8) était signé par un
 * certificat de TEST, et son `app-update.yml` embarqué promettait
 * `publisherName: [ "Mama Thera Finance (test)" ]`. Windows rendait
 * « UnknownError — racine non approuvée ». Comme electron-updater n'accepte que
 * `Valid` + un sujet qui porte le nom promis, **chaque poste équipé refusait à
 * jamais toutes les mises à jour suivantes** — un parc figé, sans que rien ne
 * rougisse : le workflow se contentait d'un avertissement, et l'audit ne
 * regardait que la version, la taille et les empreintes.
 *
 * Le symptôme visible (le warning à l'installation) est ce qui a mis sur la
 * piste ; le défaut mesuré est le parc figé. Ce contrôle juge les OCTETS que le
 * publieur s'apprête à téléverser, pas une intention de configuration : il lit
 * le contrat réellement embarqué dans le binaire, puis interroge Windows sur le
 * fichier réel.
 *
 * ─── Ce qu'il ne peut pas faire, et le dit ───────────────────────────────────
 * `Get-AuthenticodeSignature` est un geste Windows. Ailleurs, ce script REFUSE
 * de conclure plutôt que de rendre un vert qu'il n'a pas mesuré : un contrôle
 * qui ne peut pas mesurer est un contrôle absent, pas un contrôle satisfait.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePublisherNames, updaterTrustVerdict } from './lib/updater-trust.mjs';
import { DEFAULT_RELEASE_DIR } from './lib/release-prune.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || DEFAULT_RELEASE_DIR;
const releaseDir = join(root, dirArg);
// La dérogation se demande par le drapeau OU par l'environnement : le workflow
// de publication pose la variable dans SA branche signée, où le choix est
// lisible, plutôt que d'allonger `electron:release`.
const allowTestSigner =
  args.includes('--allow-test-signer') || /^(1|true)$/i.test(process.env.ALLOW_TEST_SIGNER ?? '');

const fail = (title, problems = []) => {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
};

if (process.platform !== 'win32') {
  fail('signature non mesurable hors Windows — ce contrôle refuse de rendre un vert qu’il n’a pas mesuré', [
    `il vérifie ce que le poste vérifie (Get-AuthenticodeSignature) ; sur ${process.platform}, aucun verdict n’est possible`,
    'les règles pures, elles, restent prouvées par tests/updater-trust.test.ts sur toutes les plateformes',
  ]);
}

// Le contrat que le poste lit est EMBARQUÉ dans le binaire — pas dans ce dépôt.
const contract = join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml');
if (!existsSync(contract)) {
  fail(`aucun contrat de mise à jour embarqué (${contract}) — rien à juger, donc rien de vérifié`, [
    'c’est `app-update.yml`, écrit par electron-builder, que le poste lit à chaque vérification',
    'un build qui ne le porte pas est un build qui ne se mettra jamais à jour',
  ]);
}

const installers = existsSync(releaseDir)
  ? readdirSync(releaseDir).filter((name) => /-setup\.exe$/i.test(name))
  : [];
if (!installers.length) {
  fail(`aucun installeur (\`…-setup.exe\`) dans ${dirArg} — c’est lui qu’un poste télécharge et vérifie`, [
    'l’installeur est le seul fichier dont la signature décide des mises à jour futures',
  ]);
}

/**
 * La signature Authenticode d'un fichier, lue par Windows lui-même.
 *
 * La sortie est forcée en UTF-8 : sans cela, le motif de Windows revient
 * mojibaké (« cha�ne de certificats »), et un refus illisible est un refus
 * qu'on ne peut pas réparer — c'est le même réglage que celui du poste, qui fait
 * `chcp 65001` avant d'interroger le même cmdlet.
 */
function readSignatures(files) {
  const script = files
    .map(
      (file) =>
        `"${file.replace(/'/g, "''")}" | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; ` +
        `[pscustomobject]@{ file = $_; status = $s.Status.ToString(); subject = $s.SignerCertificate.Subject; ` +
        `statusMessage = $s.StatusMessage } }`,
    )
    .join('; ');
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script} | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const { promised, names } = parsePublisherNames(readFileSync(contract, 'utf8'));
const publisherNames = promised ? names : null;

const measured = readSignatures(installers.map((name) => join(releaseDir, name)));
const byFile = new Map(measured.map((row) => [String(row.file), row]));
const signature = byFile.get(join(releaseDir, installers[0])) ?? null;

console.log(`🔎 contrat de mise à jour des postes — ${dirArg}`);
console.log(`   app-update.yml : ${contract}`);
console.log(
  `   signataire promis : ${publisherNames == null ? 'aucun' : publisherNames.map((n) => `« ${n} »`).join(', ') || '(liste vide)'}`,
);
for (const row of measured) {
  console.log(`   signature de ${row.file} : ${row.status}${row.subject ? ` — ${row.subject}` : ''}`);
}

const verdict = updaterTrustVerdict({ publisherNames, signature, allowTestSigner });
for (const note of verdict.notes) console.log(`   ℹ️ ${note}`);

// Le refus dérogé est imprimé en entier, une fois, et avec sa conséquence :
// c'est ce bloc que le journal du runner doit porter, pour qu'une publication
// signée d'un certificat de test ne se lise jamais comme une publication saine.
if (verdict.overridden.length) {
  console.log('\n⚠️  DÉROGATION « --allow-test-signer » — le parc va être gelé par ce build :');
  for (const o of verdict.overridden) console.log(`   • ${o}`);
  console.log(
    '   ⇒ les postes qui installent cette version ne se mettront plus à jour par le canal : ' +
      'chaque poste devra recevoir la suivante à la main, une fois.',
  );
}

if (verdict.ok) {
  console.log(
    verdict.overridden.length
      ? '\n✅ dérogation assumée — la publication continue, le gel est DIT ci-dessus'
      : '\n✅ ce build laisse au parc un chemin de mise à jour utilisable',
  );
  process.exit(0);
}
fail(`publication refusée — le parc ne pourrait pas encaisser la version suivante`, verdict.problems);
