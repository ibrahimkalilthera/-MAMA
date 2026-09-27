// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/windows-signature.mjs — mesurer la signature d'un fichier PAR
// Windows, et refuser de conclure quand on ne le peut pas.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// La signature d'un installeur n'est pas une opinion : c'est ce que
// `Get-AuthenticodeSignature` rend sur les octets, et c'est ce verdict-là
// qu'`electron-updater` exige (`Status -eq Valid`, puis le nom promis comparé au
// sujet du certificat). Deux contrôles d'atelier doivent l'interroger — celui qui
// juge le build LOCAL (`check-updater-trust.mjs`) et celui qui juge les octets
// PUBLIÉS (`check-published-updater-contract.mjs`) — et deux lectures séparées
// finiraient par ne plus poser la même question au même outil. La lecture vit
// donc ici, une seule fois.
//
// Hors Windows, il n'y a pas de mesure possible — et le refus est LIVRÉ, pas
// improvisé par chaque appelant : un contrôle qui ne peut pas mesurer est un
// contrôle absent, jamais un contrôle satisfait. Le refus nomme la suite qui,
// elle, prouve les règles pures sur toutes les plateformes, pour que
// « impossible ici » ne se lise pas comme « rien n'est vérifié ».
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';

/** Le cmdlet interrogé — c'est LE sujet de ce module, nommé une fois. */
export const SIGNATURE_CMDLET = 'Get-AuthenticodeSignature';

/**
 * La signature Authenticode de fichiers, telle que Windows la rend.
 *
 * La sortie est forcée en UTF-8 : sans cela, le motif de Windows revient
 * mojibaké (« cha�ne de certificats »), et un refus illisible est un refus qu'on
 * ne peut pas réparer — c'est le même réglage que celui du poste, qui fait
 * `chcp 65001` avant d'interroger le même cmdlet.
 *
 * @param {string[]} files chemins absolus
 * @returns {{ file: string, status: string, subject: string|null, statusMessage: string|null }[]}
 */
export function readAuthenticodeSignatures(files) {
  const list = (Array.isArray(files) ? files : []).map((file) => String(file));
  if (!list.length) return [];
  const script = list
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

/**
 * Ce qu'un appelant doit imprimer quand la signature n'est pas mesurable ici.
 *
 * @param {{ platform?: string, tests?: string }} [input] `tests` nomme la suite
 *   qui prouve les règles pures partout, pour que le refus ne laisse pas croire
 *   que rien n'est vérifié.
 * @returns {{ measurable: boolean, title: string, problems: string[] }}
 */
export function signatureMeasurementRefusal({ platform = process.platform, tests = '' } = {}) {
  if (platform === 'win32') return { measurable: true, title: '', problems: [] };
  return {
    measurable: false,
    title: 'signature non mesurable hors Windows — ce contrôle refuse de rendre un vert qu’il n’a pas mesuré',
    problems: [
      `il vérifie ce que le poste vérifie (${SIGNATURE_CMDLET}) ; sur ${platform}, aucun verdict n’est possible`,
      tests
        ? `les règles pures, elles, restent prouvées par ${tests} sur toutes les plateformes`
        : 'les règles pures, elles, restent prouvées par la suite de tests sur toutes les plateformes',
    ],
  };
}
