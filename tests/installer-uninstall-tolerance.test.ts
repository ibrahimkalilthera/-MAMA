// Suite de la réparation « une mise à jour de poste ne s'arrête plus sur le
// plantage du vieux désinstalleur » (`build/installer.nsh`).
//
// C'est une réparation de CANAL, donc invérifiable sur une seule machine, et
// c'est ce qui la rend dangereuse à écrire : il suffit de peu pour qu'elle ne se
// déclenche jamais tout en ayant l'air d'un remède. Le piège a été MESURÉ le
// 2026-10-12 avec le `makensis` d'`electron-builder` (3.0.4.1) : NSIS garde le
// code de sortie en 32 bits signé et l'affiche `-1073740940`, et
// `${If} $R0 == 0xC0000374` est FAUX — tout comme `$R0 == 3221226356`. Écrire le
// code en hexadécimal (sa forme lisible, celle de tous les documents) aurait donc
// produit un fichier vert, relu, et sans effet : la même mise à jour bloquée, avec
// en plus la certitude qu'elle était réparée.
//
// Les cas ci-dessous lisent le fichier qui décide, et refusent les trois façons de
// rater le remède : l'include non câblé (le fichier existe et n'est jamais lu), la
// macro manquante (le gabarit retombe sur le verdict d'origine), le code écrit
// sous une forme qui ne se compare pas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// Les lignes de CODE d'un script NSIS : `#` commente jusqu'à la fin de la ligne.
// Le blanchiment partagé (`maskComments`) connaît TypeScript, pas NSIS — un
// lecteur de commentaires NSIS n'est donc pas une copie de cette règle-là, et il
// est indispensable ici : sans lui, une tolérance CITÉE en commentaire (la prose
// de ce dépôt en cite toujours la valeur exacte) satisferait les vérifications.
const nsisCode = (text: string): string[] =>
  text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#'));

describe('la mise à jour d’un poste déjà installé ne s’arrête plus sur le plantage du vieux désinstalleur', () => {
  const code = nsisCode(read('build/installer.nsh'));
  const joined = code.join('\n');

  it('le script NSIS est CÂBLÉ dans la configuration, donc chargé au build', () => {
    // `app-builder-lib` le lirait aussi par convention (un `installer.nsh` à la
    // racine des ressources de build), et c'est justement pourquoi le nommer est
    // nécessaire : un fichier que rien ne nomme est un fichier que rien ne relit.
    assert.match(
      read('electron-builder.yml'),
      /^\s*include:\s*build\/installer\.nsh\s*$/m,
      'sans `nsis.include`, build/installer.nsh n’entre dans aucun installeur et le défaut reste entier',
    );
  });

  it('définit les DEUX macros que le gabarit insère', () => {
    // `handleUninstallResult` (installUtil.nsh) insère `customUnInstallCheck` pour
    // SHELL_CONTEXT et `customUnInstallCheckCurrentUser` pour HKEY_CURRENT_USER —
    // deux branches, deux insertions. N'en définir qu'une laisserait l'autre au
    // verdict par défaut : la boîte, le niveau 2, la mise à jour arrêtée.
    for (const macro of ['customUnInstallCheck', 'customUnInstallCheckCurrentUser']) {
      assert.match(
        joined,
        new RegExp(`!macro\\s+${macro}\\b`),
        `sans !macro ${macro}, la branche correspondante garde le verdict d’origine (la boîte, l’arrêt)`,
      );
    }
  });

  it('ne tolère QUE le code mesuré, et l’écrit en décimal signé', () => {
    // Le zéro n'est pas une tolérance : c'est le désinstalleur qui a fait son
    // travail. Tout autre code doit rester un échec (voir le cas suivant).
    const compared = [...joined.matchAll(/\$R0\s*==\s*(-?\w+)/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(compared)].sort(),
      ['-1073740940', '0'],
      'la comparaison doit porter sur le code mesuré (-1073740940 = 0xC0000374, STATUS_HEAP_CORRUPTION) et sur zéro, pas sur autre chose',
    );
  });

  it('n’écrit PAS ce code en hexadécimal, parce que la mesure dit que la comparaison serait fausse', () => {
    // Mesuré le 2026-10-12, makensis 3.0.4.1 : `${If} $R0 == 0xC0000374` est FAUX
    // quand `$R0` vaut ce que NSIS affiche `-1073740940`. C'est LE piège de cette
    // réparation — elle ne se déclencherait jamais, sans que rien ne rougisse.
    assert.doesNotMatch(
      joined,
      /\$R0\s*==\s*0x/i,
      'une comparaison en hexadécimal est fausse sous NSIS : la tolérance ne se déclencherait jamais (mesuré)',
    );
  });

  it('conserve le refus d’origine pour tout autre code', () => {
    // Tolérer « tout code non nul » accepterait un désinstalleur qui a échoué pour
    // une raison que personne n'a regardée, et l'installeur écraserait alors une
    // version dont on ne sait pas ce qu'elle est devenue. Un échec inconnu doit
    // rester un échec visible — et c'est le verdict d'`app-builder-lib`, mot pour mot.
    assert.match(joined, /MessageBox MB_OK\|MB_ICONEXCLAMATION "\$\(uninstallFailed\): \$R0"/);
    assert.match(joined, /SetErrorLevel 2/);
    assert.match(joined, /\bQuit\b/);
  });
});
