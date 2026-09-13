// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/updater-trust.mjs — le parc pourra-t-il encaisser sa PROCHAINE mise à jour ?
//
// MESURÉ le 2026-09-13 sur l'installeur que le canal servait (1.0.8, 129 081 184
// octets, téléchargé depuis /releases/latest) :
//
//   app-update.yml EMBARQUÉ → publisherName: [ "Mama Thera Finance (test)" ]
//   Get-AuthenticodeSignature → UnknownError
//     « une chaîne de certificats a été traitée mais s'est terminée par un
//       certificat racine qui n'est pas approuvé »
//
// Or electron-updater n'accepte une mise à jour que si `Status -eq Valid` ET si
// le `SignerCertificate.Subject` contient le nom promis (NsisUpdater.js →
// windowsExecutableCodeSignatureVerifier.js) ; sinon il lève
// ERR_UPDATER_INVALID_SIGNATURE. Conséquence, et c'est le vrai défaut — le
// warning n'en est que le symptôme visible : **tout poste équipé de cette
// version refuse à jamais toutes les suivantes**, et rien dans la chaîne ne le
// disait. Un certificat de test n'est pas une signature : c'est une promesse que
// Windows ne peut pas tenir.
//
// Ce module porte le verdict, PUR, pour que chaque refus se prouve sans
// PowerShell ni machine — et pour que le publieur puisse refuser AVANT d'écrire
// quoi que ce soit sur le canal.
//
// Quatre refus, chacun adossé à une règle réelle du poste :
//   • une promesse de signataire VIDE (`[]`) → electron-updater compare à une
//     liste vide, ne trouve rien, et refuse : aucune promesse vide n'est
//     satisfiable ;
//   • un nom de signataire de TEST gravé dans le contrat → refusé MÊME si la
//     chaîne est « Valid » ici, parce qu'un certificat auto-signé n'est approuvé
//     que sur la machine qui l'a créé (la leçon du pin Node, transposée) ;
//   • des octets sans signature sous une promesse de signataire → le poste exige
//     un signataire qui n'existe pas ;
//   • une chaîne non approuvée, ou un sujet qui ne porte pas le nom promis → le
//     poste refuse la mise à jour, et le dire maintenant vaut mieux qu'un parc
//     figé qu'on découvre six mois plus tard.
//
// Une ABSENCE de promesse n'est pas un refus : c'est l'état d'un build non
// signé, seul état qui laisse le parc se mettre à jour tant qu'aucun certificat
// de confiance n'est posé — au prix du « éditeur inconnu » de Windows, qui est
// nommé plutôt que tu.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un signataire qui se déclare lui-même de test (ou de développement).
 *
 * Les jetons sont cherchés en MOTS entiers : « Contest School » n'est pas un
 * certificat de test, « Mama Thera Finance (test) » en est un. Le refus vaut
 * pour la forme mesurée — c'est un nom qui ne sera approuvé nulle part ailleurs,
 * donc une promesse que le poste ne pourra pas honorer.
 */
const TEST_SIGNER = /(^|[^a-z])(test|tests|testing|dev|dev-sign|demo|staging|sandbox)([^a-z]|$)/i;

/** Le nom d'un signataire se déclare-t-il lui-même de test ? */
export const looksLikeTestSigner = (name) => TEST_SIGNER.test(String(name ?? ''));

/**
 * Lire la promesse de signataire (`publisherName`) d'un `app-update.yml`.
 *
 * Trois formes réelles, et elles ne veulent pas dire la même chose :
 *   `publisherName:` (vide)          → presente mais sans nom (illisible) ;
 *   `publisherName: Mama Thera`      → un nom, en ligne ;
 *   `publisherName:\n  - Mama Thera` → la forme écrite par electron-builder.
 *
 * @param {unknown} text
 * @returns {{ promised: boolean, names: string[] }} — `promised: false` = la clé
 *   est absente, donc le poste n'exigera rien de l'installeur téléchargé.
 */
export function parsePublisherNames(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const names = [];
  let promised = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+#.*$/, '');
    const head = /^publisherName:\s*(.*)$/.exec(line);
    if (!head) continue;
    promised = true;
    const inline = head[1].trim().replace(/^['"]|['"]$/g, '');
    if (inline) names.push(inline);
    // La forme en bloc : chaque `- nom` qui suit, tant qu'on reste indenté. Un
    // commentaire de fin est retiré comme ailleurs — un nom de signataire qui
    // garderait « # le vrai » ne correspondrait plus à aucun certificat.
    for (const nestedRaw of lines.slice(index + 1)) {
      const nested = nestedRaw.replace(/\s+#.*$/, '');
      if (!nested.trim()) continue;
      const item = /^\s+-\s*(.+?)\s*$/.exec(nested);
      if (!item) break;
      names.push(item[1].replace(/^['"]|['"]$/g, ''));
    }
    break;
  }
  return { promised, names };
}

/**
 * Le sujet d'un certificat porte-t-il le nom promis ?
 *
 * Même règle que le poste : un nom en forme complète (`CN=…, O=…`) se compare
 * champ par champ, un simple CN se compare au CN. Elle est reproduite ici pour
 * que le refus tombe au moment de publier, pas au moment où un poste essaie.
 */
export function subjectMatchesPublisher(subject, name) {
  const dn = String(subject ?? '');
  const wanted = String(name ?? '').trim();
  if (!wanted) return false;
  const fields = (value) =>
    new Map(
      String(value)
        .split(',')
        .map((part) => part.split('='))
        .filter((pair) => pair.length === 2)
        .map(([k, v]) => [k.trim().toUpperCase(), v.trim()]),
    );
  const promised = fields(wanted);
  if (promised.size > 1 && [...promised.keys()].some((k) => k !== 'CN')) {
    const actual = fields(dn);
    return [...promised.entries()].every(([k, v]) => actual.get(k) === v);
  }
  return dn.includes(`CN=${wanted}`);
}

/**
 * Le verdict : ces octets permettront-ils au parc de recevoir la version
 * SUIVANTE ? (Question distincte de « cette version est-elle installable ? »,
 * à laquelle un certificat non approuvé répond aussi « non ».)
 *
 * @param {{ publisherNames: string[]|null, signature: { status?: string, subject?: string|null,
 *   statusMessage?: string|null, file?: string }|null }} input
 * @returns {{ ok: boolean, problems: string[], notes: string[] }}
 */
export function updaterTrustVerdict({ publisherNames, signature }) {
  const problems = [];
  const notes = [];
  const status = String(signature?.status ?? '').trim();
  const subject = signature?.subject ?? null;
  const signed = status && status !== 'NotSigned' && status !== 'Unknown';

  // Aucune promesse : le poste vérifie l'empreinte du flux (sha512) mais ne
  // réclame aucun signataire — c'est le seul état vivable sans certificat.
  if (publisherNames == null) {
    notes.push(
      'aucun signataire promis — le poste jugera les octets par le `sha512` du flux, pas par un certificat',
    );
    if (!signed) {
      notes.push(
        'Windows affichera « éditeur inconnu » à l’installation : c’est le prix de cet état, et il ' +
          'disparaît le jour où un certificat approuvé (OV/EV, ou Azure Trusted Signing) est posé',
      );
    } else {
      notes.push(
        `les octets portent une signature (${subject}) qu’aucun signataire ne promet — elle ne sert ` +
          'qu’à SmartScreen, et un futur installeur signé d’un autre certificat s’installerait sans être vérifié',
      );
    }
    return { ok: true, problems, notes };
  }

  if (!publisherNames.length) {
    problems.push(
      'le poste promet une liste de signataires VIDE — electron-updater ne peut satisfaire aucune ' +
        'liste vide, donc AUCUNE mise à jour ne s’installerait jamais sur ce parc',
    );
  }

  for (const name of publisherNames) {
    if (looksLikeTestSigner(name)) {
      problems.push(
        `« ${name} » est un signataire de TEST gravé dans le contrat des postes — un certificat ` +
          'auto-signé n’est approuvé que sur la machine qui l’a créé : le parc refusera toutes les ' +
          'mises à jour (ERR_UPDATER_INVALID_SIGNATURE), et Windows affichera « éditeur inconnu »',
      );
    }
  }

  if (!signature) {
    problems.push(
      'la signature des octets n’a pas pu être lue (hors Windows, ou fichier absent) — une promesse ' +
        'de signataire qui n’est pas mesurée n’est pas vérifiée',
    );
    return { ok: false, problems, notes };
  }

  if (!signed) {
    problems.push(
      `le poste exige ${publisherNames.map((n) => `« ${n} »`).join(' ou ')} mais les octets ne portent ` +
        'AUCUNE signature — le poste refusera la mise à jour',
    );
    return { ok: false, problems, notes };
  }

  if (status !== 'Valid') {
    problems.push(
      `Get-AuthenticodeSignature rend « ${status} » au lieu de « Valid »` +
        (signature.statusMessage ? ` (« ${signature.statusMessage} »)` : '') +
        ' — le poste n’accepte qu’une chaîne APPROUVÉE, donc il refusera cette mise à jour ; ' +
        'un certificat de test peut sembler valide sur la machine qui l’a créé et ne l’être nulle part ailleurs',
    );
  }

  const matched = publisherNames.filter((name) => subjectMatchesPublisher(subject, name));
  if (!matched.length && publisherNames.length) {
    problems.push(
      `le signataire réel « ${subject} » ne porte pas le nom promis ` +
        `${publisherNames.map((n) => `« ${n} »`).join(' / ')} — electron-updater compare le sujet ` +
        'du certificat, donc il refusera la mise à jour',
    );
  }

  if (!problems.length) {
    notes.push(`signature approuvée : ${subject} — le parc pourra recevoir la version suivante`);
  }
  return { ok: problems.length === 0, problems, notes };
}
