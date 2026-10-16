/**
 * ─── Le battement de version d'un poste ─────────────────────────────────────
 *
 * Spécification : `docs/CANAL_MISE_A_JOUR.md` §7 (« Battement de version »).
 *
 * La section 6 de cette spécification ne se vérifie pas toute seule : elle dit
 * que le dépôt source peut redevenir privé « quand TOUS les postes connus sont
 * ≥ la version de bascule ». Sans relevé par poste, cette phrase se prouve
 * poste par poste — c'est-à-dire jamais, ou trop tard, et c'est exactement le
 * genre de panne que ce dépôt a déjà payé trois jours en septembre : une
 * affirmation que personne ne pouvait ni confirmer ni démentir.
 *
 * Ce module est la moitié du battement qui vit SUR la machine : il tient
 * l'identité du poste et le fait de son dernier contrôle de mise à jour, dans
 * `userData`, sans réseau, sans session, sans Supabase. L'autre moitié (l'envoi
 * en base, en `anon`) vit dans le rendu — elle exige une application ouverte,
 * celle-ci non, et c'est la bonne répartition : le fait est INSCRIT même quand
 * il ne peut pas partir.
 *
 * ─── Quatre décisions, et le défaut que chacune paie ────────────────────────
 *
 *   • **Une identité aléatoire, jamais un nom.** `station_id` est tiré au
 *     hasard (préfixe `st_` + 32 caractères hexadécimaux) et rangé dans
 *     `userData`, à côté du journal et de la file hors ligne. Le journal, lui,
 *     porte le NOM de la machine (`station`) parce qu'un administrateur doit
 *     pouvoir dire de quel poste il parle ; le relevé de parc, non : « aucune
 *     donnée d'école, aucune identité, aucun nom » (§7). Un recensement qui
 *     nommerait les machines serait un inventaire, pas un battement.
 *
 *   • **L'identité ne se régénère JAMAIS.** Un poste qui perd son identifiant
 *     apparaîtrait comme un poste DE PLUS dans le relevé : le parc grossirait à
 *     chaque perte de fichier, et « 12 postes » ne voudrait plus rien dire. La
 *     lecture va donc jusqu'à RATTRAPER l'identifiant dans un fichier abîmé
 *     (une écriture coupée par une panne de courant laisse le JSON invalide
 *     mais la chaîne `stationId` intacte) avant d'en tirer un neuf.
 *
 *   • **Aucun état inventé.** Un battement sans `last_check` valide n'est pas
 *     écrit : la base n'accepte que les quatre états mesurés (`ok`,
 *     `feed-absent`, `html`, `unreachable`), et combler un trou par « ok »
 *     déclarerait une vérification qui n'a pas eu lieu — le contraire de ce que
 *     ce relevé existe pour dire. Un poste n'apparaît donc qu'APRÈS son premier
 *     contrôle, qui suit le démarrage de quelques secondes.
 *
 *   • **Jamais fatal, jamais d'exception.** Écrire un battement ne doit pas
 *     pouvoir empêcher une mise à jour : aucune fonction ici ne jette, un
 *     disque plein rend `null`, et l'appelant continue. Et le battement
 *     lui-même se DÉSACTIVE (`STATION_HEARTBEAT=off`) : l'école peut refuser
 *     d'être recensée sans toucher au canal, parce qu'une écriture refusée ici
 *     n'a aucun effet sur les mises à jour (§7, « le point sensible »).
 *
 *   • **La forme du poste est MESURÉE, jamais devinée.** Depuis le 2026-10-16 un
 *     poste portable s'installe lui-même et devient un poste installé — et rien
 *     ne disait que le passage avait eu lieu : le relevé portait la version,
 *     jamais la forme, donc « le parc s'est converti » restait une espérance. Le
 *     battement porte donc `installMode` (`portable` / `installed`), et une
 *     application NON EMPAQUETÉE n'en déclare aucune (`null`) : elle n'a pas de
 *     forme d'installation, et écrire « installed » pour une session de
 *     développement ferait compter un poste qui n'existe pas. C'est la MÊME
 *     discipline que les quatre états de contrôle : un fait non mesuré reste à
 *     `null`, il n'est pas comblé par la valeur la plus flatteuse.
 *
 * ─── Bornes ─────────────────────────────────────────────────────────────────
 * Les mêmes que celles de la table (`supabase/migrations/…_station_versions.sql`)
 * et de la fonction `public.record_station_beat` : bornées ici AUSSI, parce
 * qu'un refus doit se voir sur le poste — pas seulement arriver en 400 sur une
 * requête que personne ne lit.
 */
const nodeFs = require('node:fs');
const { dirname, join } = require('node:path');

/** Le nom du fichier, dans `userData` (à côté des autres états du poste). */
const STATION_FILE = 'station-version.json';

/** La variable qui ÉTEINT le battement sur un poste : `STATION_HEARTBEAT=off`. */
const STATION_BEAT_ENABLED_ENV = 'STATION_HEARTBEAT';

/** La valeur qui éteint — toute autre valeur (ou aucune) laisse le battement actif. */
const BEAT_OFF = 'off';

/** Un identifiant de poste est reconnaissable à son préfixe, jamais à sa longueur. */
const ID_PREFIX = 'st_';

/** Assez d'entropie pour qu'aucun poste ne tire deux fois le même (128 bits). */
const ID_HEX_CHARS = 32;

/** Les bornes de la base, recopiées ici et vérifiées de part et d'autre. */
const MIN_ID = 8;
const MAX_ID = 64;
const MAX_APP_VERSION = 32;
const MAX_OS_VERSION = 32;
const MAX_CHECK_VERSION = 32;

/**
 * Les quatre états d'un contrôle, ceux que la base accepte (`CHECK … IN (…)`).
 * Les nommer ici plutôt que de laisser passer une chaîne libre : `last_check`
 * est agrégé par `npm run fleet:versions`, et un état inventé par un poste
 * rendrait la répartition fausse sans que personne ne s'en aperçoive.
 */
const LAST_CHECK_STATES = Object.freeze(['ok', 'feed-absent', 'html', 'unreachable']);

/**
 * Les deux formes d'installation qu'un poste peut DÉCLARER, et elles seules.
 *
 * La base les contraint (`station_versions_install_mode_enum`), et le lecteur du
 * parc (`scripts/fleet-versions.mjs`) les compte : un mode inventé par un poste
 * rendrait la répartition fausse sans que personne ne s'en aperçoive, et c'est
 * exactement la question à laquelle ce relevé doit répondre (« combien de postes
 * encore portables ? »). `null` (absent) veut dire « non mesurée » — jamais
 * « autre chose ».
 */
const INSTALL_MODES = Object.freeze(['portable', 'installed']);

/**
 * Le code du fait d'une CONVERSION, dans le journal local du poste.
 *
 * Le journal (`electron/update-journal.cjs`) est lu par DEUX lecteurs : le
 * composeur de remontée du rendu (`src/lib/desktopUpdateReport.ts`) et, à la
 * main, l'administrateur devant la machine. Le code fait donc partie du contrat
 * entre les deux, et un cas de `tests/gate-report.test.ts` fait échouer un
 * désaccord entre les deux modules.
 */
const CONVERSION_CODE = 'converted';

/**
 * @param {{ userDataDir: string }} input
 * @returns {string} chemin du relevé de ce poste.
 */
function stationPath({ userDataDir }) {
  return join(userDataDir, STATION_FILE);
}

/**
 * Ramener un champ texte à sa valeur bornée — ou à `null`.
 *
 * Un champ trop long n'est pas TRONQUÉ : il est refusé. Tronquer un
 * `app_version` de 40 caractères écrirait en base une version qui n'existe pas,
 * et le relevé mentirait précisément sur ce qu'il est censé mesurer.
 *
 * @param {unknown} value
 * @param {number} max
 * @param {number} [min]
 * @returns {string|null}
 */
function boundedText(value, max, min = 1) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text.length < min || text.length > max) return null;
  return text;
}

/**
 * @param {unknown} value
 * @returns {string|null} un identifiant de poste valide, ou null.
 */
function normalizeId(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  return text.length >= MIN_ID && text.length <= MAX_ID ? text : null;
}

/**
 * La forme d'installation de CE poste, telle qu'elle se MESURE — ou `null`.
 *
 * Deux faits d'entrée, tous deux mesurables et aucun deviné :
 *   • `packaged` — l'application est-elle EMPAQUETÉE ? Une session de
 *     développement n'a pas de forme d'installation : elle ne déclare rien
 *     (`null`), sinon un poste de bureau de développement se ferait recenser
 *     comme un poste installé de plus — et le parc compterait des machines qui
 *     n'existent pas ;
 *   • `portable` — electron-builder ne pose `PORTABLE_EXECUTABLE_FILE` que pour
 *     la cible portable : c'est la seule marque fiable de cette forme-là.
 *
 * C'est le processus principal qui a ces deux faits (il a `app.isPackaged` et
 * l'environnement du binaire) ; cette fonction les traduit, purement, pour que
 * la règle soit éprouvable sans lancer l'application.
 *
 * @param {{ packaged?: boolean, portable?: boolean }} [input]
 * @returns {'portable'|'installed'|null}
 */
function installModeOf({ packaged = true, portable = false } = {}) {
  if (!packaged) return null;
  return portable ? 'portable' : 'installed';
}

/**
 * Le fait d'une CONVERSION `portable` → `installed`, tel qu'il s'inscrit au
 * journal du poste — ou `null` quand il n'y a rien à inscrire.
 *
 * Une conversion est le seul fait de ce module qui parle du PASSÉ : la forme
 * d'aujourd'hui est `installed`, et ce qui vient d'arriver est qu'elle était
 * `portable` avant. Elle ne se voit donc qu'à l'instant où les deux existent
 * ensemble — c'est-à-dire avant que le battement ne remplace le fichier — et
 * c'est pour ça que la comparaison vit ICI, pure, plutôt que dans l'appelant.
 *
 * **Le sens compte, et il est recopié de la base à l'identique** : `portable` →
 * `installed`, et lui seul. L'inverse (relancer l'exe portable sur une machine
 * installée) n'est pas une conversion mais un retour en arrière, et il n'écrit
 * rien. La borne est copiée de `record_station_beat` (migration
 * `20261021000000_station_install_mode.sql`, `converted_at`) *exprès* : le même
 * événement doit se lire pareil dans les deux canaux, sinon le relevé daterait
 * une conversion que le journal ne nomme pas — ou l'inverse, et les deux
 * lectures divergeraient en silence.
 *
 * **Une forme JAMAIS MESURÉE n'est pas une conversion.** Un poste dont le
 * fichier d'avant ne déclarait aucune forme (version antérieure à ce champ, ou
 * application non empaquetée) est un poste dont on ne sait pas ce qu'il était :
 * en déduire « il s'est converti » serait inventer, et la base, elle, ne datera
 * rien pour lui. Le journal dit alors la même chose que le relevé : rien. C'est
 * la même discipline que le battement — un fait non mesuré reste `null`.
 *
 * @param {{ installMode?: string|null, appVersion?: string|null }|null} previous
 *   le relevé EN PLACE, lu avant que le battement ne le remplace
 * @param {{ installMode?: string|null, appVersion?: string|null }|null} next
 *   le relevé qui vient d'être écrit
 * @returns {{ code: string, version: string|null, currentVersion: string|null }|null}
 *   le fait à inscrire, ou `null` s'il n'y a pas de conversion mesurée.
 */
function conversionFact(previous, next) {
  const before = previous && typeof previous === 'object' ? previous.installMode : null;
  const after = next && typeof next === 'object' ? next.installMode : null;
  if (before !== 'portable' || after !== 'installed') return null;
  return {
    code: CONVERSION_CODE,
    // La version du PASSAGE : celle que le poste exécute au battement qui porte
    // la conversion (le même choix que `converted_to_version`), et non celle du
    // jour. `currentVersion` est celle qu'il portait AVANT, lue dans son propre
    // relevé — un `?` à l'affichage veut dire « pas mesurée », jamais « inconnue
    // parce qu'on n'a pas regardé ».
    version: next.appVersion == null ? null : String(next.appVersion),
    currentVersion: previous.appVersion == null ? null : String(previous.appVersion),
  };
}

/**
 * Rattraper l'identifiant d'un fichier devenu illisible.
 *
 * Le cas est réel et non théorique : une coupure de courant en pleine écriture,
 * ou un disque qui refuse la dernière page, laisse un JSON invalide. Relire ce
 * fichier par `JSON.parse` seul rendrait `null`, et le poste se doterait d'une
 * SECONDE identité — donc d'une seconde ligne dans le relevé, et le parc
 * compterait des machines qui n'existent pas. L'identifiant, lui, est encore
 * là, en clair dans le texte.
 *
 * @param {string} text
 * @returns {string|null}
 */
function salvageId(text) {
  const match = /"stationId"\s*:\s*"([^"]{8,64})"/.exec(String(text ?? ''));
  return match ? normalizeId(match[1]) : null;
}

/**
 * Un identifiant de poste neuf : aléatoire, et sans aucun lien avec la machine.
 *
 * `random` est injectable pour que les tests n'aient pas à espérer une valeur —
 * c'est la même discipline que la cadence de reprise des scripts de contrôle.
 *
 * @param {() => number} [random]
 * @returns {string}
 */
function randomStationId(random = Math.random) {
  let hex = '';
  while (hex.length < ID_HEX_CHARS) {
    hex += Math.floor(Number(random()) * 16).toString(16);
  }
  return `${ID_PREFIX}${hex.slice(0, ID_HEX_CHARS)}`;
}

/**
 * Le relevé de CE poste, tel qu'il est inscrit — ou `null`.
 *
 * Rien n'est recopié d'autre que les champs du contrat : ce fichier est lu par
 * un humain devant la machine, et un champ libre qui s'y glisserait le rendrait
 * illisible au moment précis où on le lit (une panne).
 *
 * Un champ absent rend `null` plutôt que la chaîne « null » : c'est la même
 * règle que le journal, et elle évite qu'un `"null"` parte en base comme une
 * version installée.
 *
 * @param {string} file
 * @param {{ fs?: typeof nodeFs }} [options]
 * @returns {{ stationId: string, appVersion: string|null, osVersion: string|null,
 *   lastCheck: string|null, lastCheckVersion: string|null, installMode: string|null,
 *   checkedAt: string|null }|null}
 */
function readStation(file, { fs = nodeFs } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // pas encore de relevé — pas une erreur
  }
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  // Fichier abîmé : l'identifiant est rattrapé AVANT d'en tirer un neuf (voir
  // `salvageId`), et le reste est considéré comme jamais mesuré.
  const stationId = raw && typeof raw === 'object' ? normalizeId(raw.stationId) : salvageId(text);
  if (!stationId) return null;
  const source = raw && typeof raw === 'object' ? raw : {};
  const lastCheck = String(source.lastCheck ?? '').trim();
  return {
    stationId,
    appVersion: boundedText(source.appVersion, MAX_APP_VERSION),
    osVersion: boundedText(source.osVersion, MAX_OS_VERSION),
    // Un état inconnu est rendu `null`, jamais recopié : la base le refuserait,
    // et le relevé ne doit pas porter un état qu'aucun contrôle n'a produit.
    lastCheck: LAST_CHECK_STATES.includes(lastCheck) ? lastCheck : null,
    lastCheckVersion: boundedText(source.lastCheckVersion, MAX_CHECK_VERSION),
    // Une forme inconnue est rendue `null` pour la même raison : la base refuse
    // un mode inventé, et un relevé qui le porterait quand même se lirait comme
    // une forme qui existe.
    installMode: INSTALL_MODES.includes(String(source.installMode ?? '').trim())
      ? String(source.installMode).trim()
      : null,
    checkedAt: typeof source.checkedAt === 'string' && source.checkedAt ? source.checkedAt : null,
  };
}

/**
 * Rendre l'identité de ce poste, en la CRÉANT si elle n'existe pas encore.
 *
 * Une identité lisible est TOUJOURS réutilisée, même quand le reste du relevé
 * est illisible : c'est la seule façon d'empêcher le parc de grossir à chaque
 * incident de disque. Le fichier n'est donc réécrit que lorsqu'il n'y a
 * vraiment rien à récupérer — un relevé existant n'est jamais écrasé par cette
 * fonction (c'est `recordBeat` qui l'écrit, avec de vrais faits).
 *
 * @param {string} file
 * @param {{ fs?: typeof nodeFs, random?: () => number, nowMs?: number }} [options]
 * @returns {string} l'identifiant du poste (jamais null : une identité se tire
 *   même quand le disque refuse de la garder, et le battement du jour porte
 *   alors celle-là).
 */
function ensureStationId(file, { fs = nodeFs, random = Math.random, nowMs = Date.now() } = {}) {
  const existing = readStation(file, { fs });
  if (existing?.stationId) return existing.stationId;

  // Rien de lisible : on rattrape l'identifiant dans le texte brut avant d'en
  // tirer un neuf — un fichier abîmé ne doit pas fabriquer un poste de plus.
  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    raw = null;
  }
  const salvaged = raw ? salvageId(raw) : null;
  const stationId = salvaged ?? randomStationId(random);

  // Le squelette : l'identité seule, et des faits à `null` tant qu'aucun
  // contrôle n'a eu lieu. `checkedAt` dit QUAND le fichier a été créé — la
  // question « depuis quand ce poste existe-t-il ? » a une réponse, et ce n'est
  // pas la même que « quand a-t-il battu pour la dernière fois ? ».
  if (!salvaged) {
    try {
      fs.mkdirSync(dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `${JSON.stringify(
          {
            stationId,
            appVersion: null,
            osVersion: null,
            lastCheck: null,
            lastCheckVersion: null,
            // La forme n'est pas un fait du jour : un squelette n'en connaît
            // aucune, et l'inscrire ici serait deviner avant d'avoir mesuré.
            installMode: null,
            checkedAt: new Date(nowMs).toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      // Disque plein ou droits : l'identité reste celle de cette session, et le
      // prochain démarrage en tirera une autre. Le battement, lui, part quand
      // même — un relevé imparfait vaut mieux qu'un poste muet.
    }
  }
  return stationId;
}

/**
 * Inscrire le fait d'un contrôle de mise à jour sur ce poste.
 *
 * Appelé par le processus principal à chaque événement de l'updater : une
 * vérification réussie, un flux absent, une origine qui répond en HTML, une
 * origine injoignable. Le battement ne part PAS d'ici (il n'y a ni réseau ni
 * session dans le processus principal) — il part du rendu, qui lit ce fichier
 * par le pont. Le fait est donc inscrit d'abord, envoyé ensuite, et un poste
 * éteint avant l'envoi ne perd rien : le fichier attend.
 *
 * @param {string} file
 * @param {{ appVersion?: string, osVersion?: string, lastCheck?: string, lastCheckVersion?: string,
 *   installMode?: string|null }} facts
 * @param {{ fs?: typeof nodeFs, random?: () => number, nowMs?: number }} [options]
 * @returns {object|null} le relevé écrit, ou null si rien n'a pu être inscrit.
 */
function recordBeat(file, facts = {}, { fs = nodeFs, random = Math.random, nowMs = Date.now() } = {}) {
  // Un appelant qui passe `null` ne doit pas faire jeter une fonction dont tout
  // le contrat est de ne jamais jeter (le défaut d'un paramètre ne couvre que
  // `undefined`).
  const given = facts && typeof facts === 'object' ? facts : {};
  const appVersion = boundedText(given.appVersion, MAX_APP_VERSION);
  const lastCheck = String(given.lastCheck ?? '').trim();
  // Deux refus, et ils sont volontaires : sans version installée il n'y a rien
  // à recenser, et sans état de contrôle le battement porterait un état inventé
  // (voir l'en-tête). Un poste apparaît donc après son premier contrôle.
  if (!appVersion) return null;
  if (!LAST_CHECK_STATES.includes(lastCheck)) return null;

  const stationId = ensureStationId(file, { fs, random, nowMs });
  // Une forme inconnue n'est PAS recopiée : elle devient `null`, exactement
  // comme un état de contrôle inconnu lu dans un fichier. C'est le champ le moins
  // essentiel du relevé — il n'empêche donc pas le battement de partir —, mais
  // il ne part jamais avec une valeur que la base refuserait.
  const installMode = INSTALL_MODES.includes(String(given.installMode ?? '').trim())
    ? String(given.installMode).trim()
    : null;
  const record = {
    stationId,
    appVersion,
    osVersion: boundedText(given.osVersion, MAX_OS_VERSION),
    lastCheck,
    lastCheckVersion: boundedText(given.lastCheckVersion, MAX_CHECK_VERSION),
    installMode,
    checkedAt: new Date(nowMs).toISOString(),
  };
  try {
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Le disque a refusé : le fait reste vrai pour cette session (le rendu peut
    // encore le lire en mémoire si on le lui donne), et surtout la mise à jour
    // continue. Un battement ne bloque jamais une mise à jour.
  }
  return record;
}

/**
 * Ce que le pont remet au rendu : le relevé, ou `null`.
 *
 * `null` a trois causes, et aucune n'est une erreur : le battement est ÉTEINT
 * sur ce poste (`STATION_HEARTBEAT=off`), le poste n'a pas encore de relevé
 * exploitable (pas de premier contrôle), ou `userData` n'est pas connu. Le
 * rendu n'a rien à décider : il envoie ce qu'on lui donne, et ne dit rien quand
 * on ne lui donne rien.
 *
 * @param {{ userDataDir?: string, fs?: typeof nodeFs, env?: object }} [input]
 * @returns {{ stationId: string, appVersion: string, osVersion: string|null,
 *   lastCheck: string, lastCheckVersion: string|null, installMode: string|null,
 *   checkedAt: string|null }|null}
 */
function beatPayload({ userDataDir, fs = nodeFs, env = process.env } = {}) {
  // Pas de date ici : `seen_at` est posé par la BASE, jamais par le poste (§7)
  // — une horloge de poste d'école peut être fausse, et un relevé qui daterait
  // les battements avec l'horloge des machines ne dirait plus qui est silencieux.
  const switchValue = String(env?.[STATION_BEAT_ENABLED_ENV] ?? '').trim().toLowerCase();
  if (switchValue === BEAT_OFF) return null;
  if (!userDataDir) return null;
  const record = readStation(stationPath({ userDataDir }), { fs });
  // Un relevé sans version ni état n'est pas encore un battement : la base le
  // refuserait, et l'envoyer produirait un 400 que personne ne lirait.
  if (!record?.appVersion || !record.lastCheck) return null;
  return record;
}

module.exports = {
  STATION_FILE,
  CONVERSION_CODE,
  STATION_BEAT_ENABLED_ENV,
  BEAT_OFF,
  ID_PREFIX,
  MIN_ID,
  MAX_ID,
  MAX_APP_VERSION,
  MAX_OS_VERSION,
  MAX_CHECK_VERSION,
  LAST_CHECK_STATES,
  INSTALL_MODES,
  stationPath,
  boundedText,
  normalizeId,
  salvageId,
  randomStationId,
  installModeOf,
  conversionFact,
  readStation,
  ensureStationId,
  recordBeat,
  beatPayload,
};
