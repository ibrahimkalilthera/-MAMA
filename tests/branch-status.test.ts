/**
 * Le tri des branches — `npm run branches:status`.
 *
 * Ce qui est vérifié ici n'est pas « le script s'exécute » : c'est que chaque
 * verdict repose sur la preuve qu'il annonce, et que l'indice de contenu (la
 * part des lignes déjà dans la base) se calcule pour de vrai — sur un dépôt git
 * fabriqué, avec une fusion en squash reproduite à la main.
 *
 * La distinction que ces tests tiennent : `supprimable` n'est rendu que sur
 * preuve exacte (tip ancêtre, PR fusionnée) ; une couverture de contenu élevée
 * reste un INDICE et laisse la branche en `à relire`. Un test qui accepterait
 * l'inverse ferait du script un suppresseur automatique déguisé en rapport.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  VERDICT,
  classifyBranch,
  contentCoverage,
  describePr,
  formatReport,
} from '../scripts/lib/branch-status.mjs';

// `as const` sur `state` : le module type la valeur en `'open' | 'closed'`, et
// une chaîne élargie en `string` ne s'y assigne pas — c'est le compilateur qui
// garde le vocabulaire, pas la convention.
const MERGED = { number: 121, state: 'closed' as const, mergedAt: '2026-11-09T12:00:00Z' };
const OPEN = { number: 130, state: 'open' as const, mergedAt: null };
const CLOSED = { number: 109, state: 'closed' as const, mergedAt: null };

const coverage = (ratio: number | null, sampled = 10, missingFiles: string[] = []) => ({
  commits: 1,
  sampled,
  present: ratio === null ? 0 : Math.round(ratio * sampled),
  ratio,
  missingFiles,
});

describe('branches:status — la preuve avant le confort', () => {
  it('un tip ancêtre de la base est une preuve exacte', () => {
    const { verdict, reasons } = classifyBranch({ tipInBase: true });
    assert.equal(verdict, VERDICT.REMOVABLE);
    assert.match(reasons.join(' '), /ancêtre/);
  });

  it('une PR fusionnée est une preuve exacte, même sans ancêtre (fusion en squash)', () => {
    // C'est LE cas que `git branch --merged` ne voit pas : le commit de la
    // branche n'est pas un ancêtre, la PR est pourtant fusionnée.
    const { verdict, reasons } = classifyBranch({ tipInBase: false, pr: MERGED });
    assert.equal(verdict, VERDICT.REMOVABLE);
    assert.match(reasons.join(' '), /PR #121 fusionnée/);
  });

  it('une PR ouverte est du travail à garder', () => {
    const { verdict } = classifyBranch({ pr: OPEN });
    assert.equal(verdict, VERDICT.KEEP);
  });

  it('aucune PR n’est pas une preuve : la branche reste à relire', () => {
    const { verdict, reasons } = classifyBranch({ pr: null, coverage: coverage(1) });
    assert.equal(verdict, VERDICT.REVIEW);
    assert.match(reasons.join(' '), /aucune PR/);
    // 100 % de lignes retrouvées reste un indice : il est écrit, il ne décide pas.
    assert.match(reasons.join(' '), /100 % des lignes distinctives/);
    assert.match(reasons.join(' '), /indice, pas preuve/);
  });

  it('une PR fermée sans fusion n’est pas une branche morte', () => {
    const { verdict, reasons } = classifyBranch({ pr: CLOSED });
    assert.equal(verdict, VERDICT.REVIEW);
    assert.match(reasons.join(' '), /fermée sans fusion/);
  });

  it('« PR non lues » et « aucune PR » ne se confondent pas', () => {
    // `gh` absent : la question n'a pas pu être POSÉE. La confondre avec
    // « aucune PR » ferait peser sur la branche un soupçon que rien n'établit.
    const unknown = classifyBranch({ prUnknown: true });
    assert.equal(unknown.verdict, VERDICT.REVIEW);
    assert.match(unknown.reasons.join(' '), /gh indisponible/);
    assert.doesNotMatch(unknown.reasons.join(' '), /aucune PR/);
  });

  it('un fichier absent de la base est nommé, jamais résumé en pourcentage', () => {
    const { reasons } = classifyBranch({ coverage: coverage(0.5, 4, ['src/neuf.ts']) });
    assert.match(reasons.join(' '), /1 fichier\(s\) absent\(s\) de la base : src\/neuf\.ts/);
  });

  it('les libellés de PR disent l’état, pas seulement le numéro', () => {
    assert.equal(describePr({ pr: MERGED, prUnknown: false }), '#121 fusionnée');
    assert.equal(describePr({ pr: OPEN, prUnknown: false }), '#130 ouverte');
    assert.equal(describePr({ pr: CLOSED, prUnknown: false }), '#109 fermée');
    assert.equal(describePr({ pr: null, prUnknown: false }), 'aucune');
    assert.equal(describePr({ pr: null, prUnknown: true }), 'non lues');
  });
});

describe('branches:status — le rapport répond aux deux questions', () => {
  const rows = [
    {
      name: 'feat/morte',
      local: true,
      remote: true,
      pr: MERGED,
      prUnknown: false,
      coverage: coverage(1),
      verdict: VERDICT.REMOVABLE,
      reasons: ['PR #121 fusionnée'],
    },
    {
      name: 'fix/sans-pr',
      local: false,
      remote: true,
      pr: null,
      prUnknown: false,
      coverage: coverage(0.6, 20),
      verdict: VERDICT.REVIEW,
      reasons: ['aucune PR'],
    },
    {
      name: 'ui/en-cours',
      local: true,
      remote: true,
      pr: OPEN,
      prUnknown: false,
      coverage: coverage(0, 8),
      verdict: VERDICT.KEEP,
      reasons: ['PR #130 ouverte'],
    },
  ];

  const report = formatReport(rows, { base: 'origin/main' }).join('\n');

  it('liste les branches sans PR, nommément', () => {
    assert.match(report, /Sans PR \(1\) : fix\/sans-pr/);
  });

  it('nomme celles dont toutes les lignes distinctives sont déjà dans la base', () => {
    assert.match(report, /Contenu déjà intégralement dans la base \(indice\) : feat\/morte/);
  });

  it('trie par verdict : ce qui est traitable d’abord', () => {
    const order = ['feat/morte', 'ui/en-cours', 'fix/sans-pr'].map((n) => report.indexOf(n));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'supprimable, garder, à relire');
  });

  it('rappelle qu’il ne supprime rien', () => {
    assert.match(report, /Ce rapport ne supprime rien/);
  });

  it('avoue quand la colonne PR n’a pas pu être lue', () => {
    const unread = formatReport(
      [{ ...rows[1], prUnknown: true, pr: null }],
      { base: 'origin/main' },
    ).join('\n');
    assert.match(unread, /gh est indisponible ou non authentifié/);
  });
});

describe('branches:status — la couverture de contenu, mesurée sur un vrai dépôt', () => {
  /** Un dépôt jetable : `git` réel, commits réels, squash reproduit à la main. */
  function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'branch-status-'));
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.org']);
    git(['config', 'user.name', 'Test']);
    return { dir, git, adapter: (args: string[]) => git(args) };
  }

  const LONG_LINE = 'la ligne qui porte la decision et qui ne se retrouve nulle part ailleurs';

  it('une branche jamais fusionnée ne retrouve rien, et son fichier neuf est nommé', () => {
    const { dir, git, adapter } = makeRepo();
    try {
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base']);

      git(['switch', '-q', '-c', 'feat']);
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n${LONG_LINE} bis\n`);
      writeFileSync(join(dir, 'neuf.ts'), `export const neuf = '${LONG_LINE}';\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: ajoute']);
      git(['switch', '-q', 'main']);

      const result = contentCoverage({ git: adapter, base: 'main', ref: 'feat' });
      assert.equal(result.commits, 1, 'un commit absent de la base');
      assert.equal(result.present, 0, 'aucune de ses lignes n’a encore voyagé');
      assert.equal(result.ratio, 0);
      assert.deepEqual(result.missingFiles, ['neuf.ts'], 'le fichier neuf est nommé, pas ignoré');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('après une fusion en squash, le même contenu se retrouve à 100 %', () => {
    // Le cas réel du dépôt : le commit de la branche n'est JAMAIS un ancêtre
    // (squash), mais tout son contenu est dans `main`. C'est cet écart que le
    // script doit rendre visible — mesuré, pas supposé.
    const { dir, git, adapter } = makeRepo();
    try {
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base']);

      git(['switch', '-q', '-c', 'feat']);
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n${LONG_LINE} bis\n`);
      writeFileSync(join(dir, 'neuf.ts'), `export const neuf = '${LONG_LINE}';\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: ajoute']);

      git(['switch', '-q', 'main']);
      // Le squash : un AUTRE commit, le même contenu, aucun lien de parenté.
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n${LONG_LINE} bis\n`);
      writeFileSync(join(dir, 'neuf.ts'), `export const neuf = '${LONG_LINE}';\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: ajoute (#130)']);

      const result = contentCoverage({ git: adapter, base: 'main', ref: 'feat' });
      assert.equal(result.commits, 1, 'la branche n’est toujours pas un ancêtre de main');
      // Deux lignes distinctives : celle ajoutée au fichier existant, et celle du
      // fichier neuf. Le seuil dit « on a comparé quelque chose », il ne gonfle rien.
      assert.ok(result.sampled >= 2, `des lignes distinctives ont été comparées (${result.sampled})`);
      assert.equal(result.ratio, 1, 'toutes ses lignes sont déjà dans la base');
      assert.deepEqual(result.missingFiles, [], 'plus aucun fichier ne manque');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une branche identique à la base n’a rien à comparer — et le dit', () => {
    // `null` et non `1` : zéro ligne mesurée n'est pas « tout est là », c'est
    // « rien n'a été comparé ». Le rapport écrit « aucune ligne distinctive ».
    const { dir, git, adapter } = makeRepo();
    try {
      writeFileSync(join(dir, 'note.md'), `# Base\n${LONG_LINE}\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base']);
      git(['branch', 'identique']);

      const result = contentCoverage({ git: adapter, base: 'main', ref: 'identique' });
      assert.equal(result.commits, 0);
      assert.equal(result.sampled, 0);
      assert.equal(result.ratio, null, 'un zéro mesuré ne se lit pas comme un 100 %');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
