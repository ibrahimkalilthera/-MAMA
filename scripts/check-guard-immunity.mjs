/**
 * ─── Le contrôle des contrôles ─────────────────────────────────────────────
 *
 * `npm run lint` lance une quinzaine de gardes. Chacune lit quelque chose, et
 * chaque chose lue peut tromper son lecteur : de la prose prise pour du code,
 * un corpus vide, une marque imprimée par un autre, une preuve qui parle d'un
 * autre sujet. Ces pièges ont tous été payés ici (voir
 * `scripts/lib/guard-immunity.mjs`), et chacun a été réparé **sur place**.
 *
 * Ce script ferme la porte à la prochaine occurrence : chaque contrôle doit
 * être DÉCLARÉ dans l'inventaire, avec ce qu'il lit et les immunités qu'il
 * porte ; chaque immunité déclarée doit avoir sa preuve dans la source, et
 * chaque exemption doit dire pourquoi. Un garde non déclaré, une immunité
 * annoncée mais absente, une exemption muette : trois échecs.
 *
 * Usage : node scripts/check-guard-immunity.mjs   (branché dans `lint:chain`)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { auditGuardImmunity, readInventoryFromDisk } from './lib/guard-immunity.mjs';

const root = path.join(import.meta.dirname, '..');
const readFile = (p) => readFileSync(p, 'utf8');

const { present, sources, libs } = readInventoryFromDisk({
  root,
  readFile,
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
});

if (present.length === 0) {
  // Un audit qui ne trouve aucun contrôle à auditer n'est pas un audit vert.
  console.error('❌ Rien à vérifier : aucun `scripts/check-*.mjs` lu — l’inventaire ne couvre rien.');
  process.exit(2);
}

const { checked, problems, exempted } = auditGuardImmunity({ sources, libs, present });

for (const { check, immunity, reason } of exempted) {
  console.log(`➖ ${check} — ${immunity} exempté : ${reason}`);
}

if (problems.length > 0) {
  console.error(`\n❌ ${problems.length} contrôle(s) dont l’immunité n’est pas prouvée :`);
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    '\n   Un contrôle qui lit sans immunité peut être trompé — et un contrôle trompé\n' +
    '   est pire qu’un contrôle absent, parce qu’il rassure. Déclarez la preuve ou\n' +
    '   l’exemption dans scripts/lib/guard-immunity.mjs.',
  );
  process.exit(1);
}

console.log(
  `✅ ${checked} contrôle(s) inventorié(s), ${present.length} présent(s) — chaque immunité déclarée a sa preuve` +
    (exempted.length > 0 ? ` (${exempted.length} exemption(s) motivée(s))` : '') +
    '.',
);
