/**
 * Icon-glass dose gate — les doses déclarées par le CODE et les blocs de dose
 * écrits dans la FEUILLE ne peuvent pas diverger.
 *
 * Le réglage « verre des icônes » (Préférences → discret / net / animé) est
 * porté par deux fichiers qui s'ignorent : `src/lib/iconGlass.ts` dit quels noms
 * existent et lequel est livré, `src/themes/icons.css` dit ce que chaque nom
 * FAIT. Le typage ne relie pas les deux, et le rendu ne se plaint jamais :
 *
 *   • une dose offerte sans bloc dans la feuille apparaît dans le menu et ne
 *     change RIEN (le nom ne rencontre aucune règle) — le défaut exact que ce
 *     contrôle poursuit ;
 *   • un bloc écrit pour une dose que le code n'offre pas est une règle morte,
 *     inatteignable depuis l'écran ;
 *   • une variable posée par une dose et jamais lue est un réglage qui ne règle
 *     rien ; une variable lue et posée par aucune dose n'est plus une dose ;
 *   • un repli qui ne vaut pas la dose livrée fait CHANGER la page d'aspect
 *     avant hydratation, ou dans tout fragment monté hors de la racine du shell.
 *
 * ─── Ce qu'il lit, et comment il le lit ────────────────────────────────────
 *
 * Les deux corpus sont des textes où la prose cite exactement ce qu'on cherche
 * (l'en-tête de la feuille nomme `.icon-glass-crisp`, la JSDoc du module cite
 * `'discreet'`) : les commentaires sont blanchis par la couche partagée, jamais
 * par une copie locale. La comparaison elle-même vit dans
 * `scripts/lib/icon-glass-doses.mjs` — ce fichier n'est que l'arête disque.
 *
 * ─── Refuser la vacuité ────────────────────────────────────────────────────
 *
 * Un fichier absent ou vide, une liste de doses vide, une feuille sans aucun
 * bloc de dose : chacune de ces quatre situations sort en **2** en le DISANT.
 * « Je n'ai pas pu regarder » n'est pas « tout va bien », et un contrat comparé à
 * rien est un contrat tenu sur rien.
 *
 * Usage : node scripts/check-icon-glass-doses.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';

import { judgeIconGlassDoses } from './lib/icon-glass-doses.mjs';

const CODE_FILE = process.env.CHECK_ICON_GLASS_CODE_FILE || 'src/lib/iconGlass.ts';
const SHEET_FILE = process.env.CHECK_ICON_GLASS_SHEET_FILE || 'src/themes/icons.css';

/** Lit un fichier, ou `null` s'il est absent (c'est la vacuité qui parle alors). */
const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const unreadable = [CODE_FILE, SHEET_FILE].filter((file) => {
  const text = read(file);
  return text === null || !text.trim();
});
if (unreadable.length > 0) {
  console.error(
    `❌ Rien à vérifier : ${unreadable.join(', ')} introuvable(s) ou vide(s) — le dosage du verre ne peut pas être comparé sans ses deux moitiés.`,
  );
  process.exit(2);
}

const { problems, levels, defaultLevel, blocks } = judgeIconGlassDoses({
  code: read(CODE_FILE),
  sheet: read(SHEET_FILE),
});

// Deux corpus vides ou sans doses ne sont pas une conformité : c'est un scan
// aveugle. Sortie 2, nommée — jamais un ✅ sur rien.
if (levels.length === 0 || blocks.length === 0) {
  console.error(
    `❌ Rien à comparer : ${levels.length} dose(s) déclarée(s) par ${CODE_FILE}, ${blocks.length} bloc(s) \`.icon-glass-*\` dans ${SHEET_FILE} — un des deux lecteurs n’atteint plus son corpus.`,
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`❌ ${CODE_FILE} et ${SHEET_FILE} ne portent pas le même dosage du verre des icônes :`);
  for (const problem of problems) console.error(`   • ${problem}`);
  console.error(
    '   → les deux moitiés se déplacent ENSEMBLE : une dose ajoutée au code reçoit son bloc (et ses variables), et un bloc ne survit pas à la dose qu’il servait.',
  );
  process.exit(1);
}

console.log(
  `✅ Dosage du verre aligné : ${levels.length} dose(s) déclarée(s) par ${CODE_FILE} ` +
    `(${levels.join(' → ')}), chacune avec son bloc dans ${SHEET_FILE} — ` +
    `défaut « ${defaultLevel} », dont les valeurs SONT les replis de la feuille.`,
);
