/**
 * scripts/lib/electron-csp-meta.mjs — le build de l'interface de BUREAU écrit la
 * politique du poste DANS l'artefact, en plus de l'en-tête appliqué à l'exécution.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'en-tête (`electron/csp-policy.cjs`, branché par `electron/main.cjs`) est du
 * code : il tourne au démarrage du poste. Si ce câblage est un jour retiré,
 * contourné ou déplacé — un refactor de `createWindow`, une session créée avant
 * le branchement — plus rien ne bloque un `@import` externe dans l'installeur, et
 * PERSONNE ne l'apprendrait avant qu'une école le voie.
 *
 * La meta, elle, voyage AVEC le paquet : elle est écrite ici, à la fin du build,
 * dans `electron-ui-dist/index.html`. C'est le second verrou, et il ne dépend
 * d'aucun code d'exécution.
 *
 * LES DEUX CANAUX, UNE SEULE ÉCRITURE
 * -----------------------------------
 * La chaîne vient de `electron/csp-policy.cjs` par `createRequire` : c'est le
 * MÊME `.cjs` que lit `electron/main.cjs` (seul format qu'un processus principal
 * et un plugin de build peuvent partager sans build), donc les deux canaux ne
 * peuvent pas diverger. Recopier la politique ici la ferait diverger au premier
 * élargissement : deux politiques CSP se cumulent, donc la plus PERMISSIVE des
 * deux n'aurait aucun effet — et personne ne verrait laquelle a gagné.
 *
 * POURQUOI `head-prepend`, ET PAS UNE LIGNE DANS `index.html`
 * -----------------------------------------------------------
 * Une meta CSP ne s'applique qu'à partir de l'endroit où l'analyseur la
 * rencontre : ce qui est chargé AVANT elle n'est pas couvert. Elle doit donc
 * précéder le script du bundle, que Vite place dans `<head>`. Elle est donc
 * injectée en tête de `<head>`, et le build de bureau seulement : le site servi
 * (`dist/`) a déjà sa vraie CSP en en-tête (`vercel.json`), et une seconde
 * politique dans le document y serait une duplication qui ne ferait que
 * drifter.
 *
 * L'activation se fait sur le dossier de sortie (`--outDir electron-ui-dist`,
 * le build `--base=./` chargé depuis le disque), jamais par un drapeau qu'on
 * pourrait oublier de poser : le canal doit être branché quand le paquet se
 * construit, pas quand quelqu'un y pense.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** La politique du poste — l'unique définition, partagée avec le processus principal. */
const { DESKTOP_CSP } = require('../../electron/csp-policy.cjs');

/** Le dossier de sortie du build de bureau. */
export const DESKTOP_OUT_DIR = 'electron-ui-dist';

/** La balise écrite dans le document, telle quelle (pour être relue par un test). */
export const META_TAG =
  `<meta http-equiv="Content-Security-Policy" content="${DESKTOP_CSP}">`;

/**
 * Le build est-il celui du BUREAU ?
 *
 * Décidé par le dossier de sortie, en séparateur `/` : un chemin Windows
 * (`…\electron-ui-dist`) doit répondre la même chose qu'un chemin POSIX, sinon le
 * canal existerait sur un poste et pas sur l'autre.
 *
 * @param {string} outDir
 * @returns {boolean}
 */
export function isDesktopBuild(outDir) {
  return String(outDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '').endsWith(`/${DESKTOP_OUT_DIR}`)
    || String(outDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '') === DESKTOP_OUT_DIR;
}

/**
 * Le plugin Vite. Il n'écrit RIEN quand le build n'est pas celui du bureau.
 *
 * @returns {{ name: string, configResolved: (config: { build?: { outDir?: string } }) => void,
 *   transformIndexHtml: { order: string, handler: (html: string) => string | { html: string, tags: object[] } } }}
 */
export function electronCspMetaPlugin() {
  let enabled = false;
  return {
    name: 'electron-csp-meta',
    configResolved(config) {
      enabled = isDesktopBuild(config.build?.outDir ?? '');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!enabled) return html;
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: DESKTOP_CSP },
              injectTo: 'head-prepend',
            },
          ],
        };
      },
    },
  };
}
