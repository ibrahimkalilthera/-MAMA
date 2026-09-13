// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/updater-contract-repair.mjs — dégeler un poste SANS réinstaller.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// MESURÉ le 2026-09-13 dans la bibliothèque que le poste EXÉCUTE — le seul juge,
// puisque c'est son propre code qui refuse l'installeur :
//
//   electron-updater/out/ElectronAppAdapter.js:23
//     return path.join(process.resourcesPath, "app-update.yml")
//   electron-updater/out/NsisUpdater.js:85-90
//     publisherName = (await this.configOnDisk.value).publisherName
//     if (publisherName == null) return null          ← AUCUNE vérification
//   electron-updater/out/windowsExecutableCodeSignatureVerifier.js:44-88
//     `data.Status === 0` (Valid) exigé, puis le nom promis est comparé — et pour
//     un nom sans « = » (`Mama Thera Finance (test)`), `parseDn` rend une carte
//     VIDE, donc la comparaison tombe sur le CN SEUL : `name === subject.get("CN")`.
//
// Conséquence, et c'est ce qui décide de tout : ce qui bloque un poste gelé est un
// fichier SUR ce poste — `<dossier d'install>/resources/app-update.yml`, relu à
// chaque vérification par l'application DÉJÀ installée, avec son propre code.
// Aucun changement de canal, de flux, de release ou de signature ne peut
// l'atteindre : le poste refuse l'installeur AVANT de l'exécuter.
//
// Le remède est donc local — et il ne demande ni droits administrateur ni
// réinstallation : une installation par utilisateur (`%LOCALAPPDATA%`) a un
// dossier `resources/` inscriptible par cet utilisateur, et retirer la promesse
// de ce fichier fait retourner `null` à `verifySignature` : le poste redevient un
// poste normal, que le flux du `sha512` suffit à convaincre.
//
// POURQUOI LE REMÈDE EST RÉSERVÉ AUX PROMESSES INSATISFIABLES
// ----------------------------------------------------------
// Une promesse *satisfiable* (un signataire qu'un vrai certificat peut porter) est
// une garantie : la retirer accepterait des octets non signés, c'est-à-dire
// baisser la sécurité d'un poste qui n'était pas cassé. Ce module ne touche donc
// que ce qu'AUCUN certificat ne peut honorer — une promesse VIDE (aucune liste
// vide n'est satisfiable) ou un signataire de TEST (un certificat auto-signé n'est
// approuvé que sur la machine qui l'a créé). Le reste est nommé et refusé.
// ─────────────────────────────────────────────────────────────────────────────

import { looksLikeTestSigner, parsePublisherNames } from './updater-trust.mjs';

/**
 * Ce que ce contrat de mise à jour impose au poste, et si c'est tenable.
 *
 * @param {unknown} text contenu d'un `app-update.yml`
 * @returns {{ promised: boolean, names: string[], frozen: boolean, because: string }}
 */
export function contractState(text) {
  const { promised, names } = parsePublisherNames(text);
  if (!promised) {
    return {
      promised: false,
      names,
      frozen: false,
      because: 'aucun signataire promis — le poste juge les octets par le `sha512` du flux, donc il se met à jour',
    };
  }
  if (!names.length) {
    return {
      promised: true,
      names,
      frozen: true,
      because: 'promesse VIDE — aucune liste vide n’est satisfiable, donc aucune mise à jour ne s’installera jamais',
    };
  }
  const test = names.filter((name) => looksLikeTestSigner(name));
  if (test.length) {
    return {
      promised: true,
      names,
      frozen: true,
      because:
        `signataire de TEST gravé (« ${test[0]} ») — un certificat auto-signé n’est approuvé que sur la machine ` +
        'qui l’a créé, donc Windows ne rendra jamais « Valid » nulle part ailleurs',
    };
  }
  return {
    promised: true,
    names,
    frozen: false,
    because: `promesse satisfiable par un certificat nommé « ${names[0]} » — la retirer baisserait la sécurité de ce poste`,
  };
}

/**
 * Retirer la promesse de signataire d'un `app-update.yml`, en gardant le reste
 * OCTET POUR OCTET (fournisseur, dépôt, cache, et le style de fin de ligne).
 *
 * La forme retirée est celle qu'écrit electron-builder — une ligne
 * `publisherName:`, puis des items indentés `- nom` — parce que c'est la forme
 * MESURÉE dans les installeurs publiés. Une autre forme (en ligne, `publisherName:
 * X`) est retirée aussi, mais si le texte restait porteur d'une promesse après
 * l'opération, l'appelant doit le voir : c'est pour ça que `parsePublisherNames`
 * est la référence, et pas cette fonction.
 *
 * @param {unknown} text
 * @returns {{ text: string, changed: boolean, removed: string[] }}
 */
export function stripPublisherPromise(text) {
  const lines = String(text ?? '').split(/(?<=\n)/);
  const removed = [];
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^publisherName:/.test(line)) {
      removed.push(line.replace(/[\r\n]+$/, ''));
      // Les items de la liste : indentés, et `- nom`. On s'arrête au premier qui
      // ne l'est pas, pour ne jamais emporter la clé SUIVANTE.
      let next = index + 1;
      while (next < lines.length && /^\s+-\s*\S/.test(lines[next])) {
        removed.push(lines[next].replace(/[\r\n]+$/, ''));
        next += 1;
      }
      index = next - 1;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join(''), changed: removed.length > 0, removed };
}
