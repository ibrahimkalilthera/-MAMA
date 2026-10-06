#!/usr/bin/env node
/**
 * stylelint-tools.mjs — le maillon CSS de `lint:chain`, exécuté depuis l'arbre
 * ISOLÉ `tools/csslint/`.
 *
 *   npm run lint            → la chaîne ordinaire (ce maillon compris)
 *   node scripts/stylelint-tools.mjs "src/**\/*.css" --cache --cache-location node_modules/.stylelintcache
 *
 * Le raisonnement complet (pourquoi l'arbre est isolé, ce qui n'est PAS corrigé,
 * et pourquoi l'entrée est lue dans le `bin` déclaré) vit dans
 * ./lib/stylelint-tools.mjs — ce fichier n'est que la partie « réseau » : spawn,
 * code de sortie, message nommé quand l'arbre manque.
 *
 * Deux règles, et elles sont la raison d'être de ce fichier :
 *   • le code de sortie de stylelint est PRÉSERVÉ tel quel — un gate vert ne peut
 *     pas sortir d'un `spawnSync` dont on ne lit pas le statut ;
 *   • un arbre isolé ABSENT est un ÉCHEC NOMMÉ (exit 2), jamais un saut discret :
 *     sauter le CSS en silence serait exactement le mensonge que la chaîne
 *     refuse partout ailleurs.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { missingTreeMessage, stylelintArgv, stylelintEntry } from './lib/stylelint-tools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const found = stylelintEntry({ root: ROOT });
if (!found) {
  console.error(`❌ ${missingTreeMessage({ root: ROOT })}`);
  process.exit(2);
}

const argv = stylelintArgv({ entry: found.entry, args: process.argv.slice(2), root: ROOT });
const result = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit', windowsHide: true });

if (result.error) {
  console.error(`❌ stylelint isolé n'a pas pu être lancé (${found.entry}) — ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
