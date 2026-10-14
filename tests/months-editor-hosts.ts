/**
 * ─── LES PORTES DE L'ÉDITEUR DES MOIS, DÉCLARÉES AVEC LEUR HÔTE ─────────────
 *
 * L'éditeur des mois n'existe qu'une fois (`src/components/PaymentMonthsEditor.tsx`)
 * — c'est la règle du dépôt : une seule UI de mois, une seule ligne de reçu
 * (`formatPaidMonths`). Ce qui peut exister plusieurs fois, ce sont les PORTES qui
 * l'ouvrent : le carnet des paiements d'une fiche, le parcours de rattrapage de la
 * même fiche, la passe groupée de l'écran École, et le parcours élève par élève du
 * même écran.
 *
 * ─── Le défaut que ce verrou empêche ────────────────────────────────────────
 * La fiche d'un élève porte DEUX de ces portes. Si chacune ouvrait l'éditeur de
 * son côté, le même reçu en afficherait deux : vingt-quatre pastilles au lieu de
 * douze, et le `waitForSelector` du pixel-check ne saurait plus lequel il juge.
 * C'est écrit dans la fiche elle-même (`editorHost: 'ledger' | 'backfill' | null`)
 * et le contrat est tenu par les deux moitiés :
 *
 *   • l'HÔTE de l'éditeur est UN SEUL à la fois (`StudentDetailsModal`) ;
 *   • chaque porte DÉCLARE son hôte et n'ouvre qu'avec le jeton qui la nomme
 *     (`editorHost === 'ledger'` dans le carnet, `editorHost === 'backfill'` remis
 *     au parcours par la fiche).
 *
 * ─── Ce que l'inventaire ci-dessous verrouille ──────────────────────────────
 *   • EXHAUSTIVITÉ — tout fichier qui REND `<PaymentMonthsEditor` est déclaré. Un
 *     TROISIÈME point d'entrée ne peut donc pas apparaître en silence : il fait
 *     rougir le verrou tant qu'il n'a pas déclaré son hôte ;
 *   • VÉRITÉ — chaque hôte déclaré monte vraiment sa porte (motif JSX), et chaque
 *     porte ouvre vraiment sous sa condition (`when`) — une déclaration périmée
 *     est un écart, pas une décoration ;
 *   • EXCLUSIVITÉ — sur un écran qui porte PLUSIEURS portes, chacune déclare un
 *     JETON, l'hôte le lui REMET (`handed`) et le jeton appartient au type que le
 *     fichier d'hôtes DÉCLARE (`useState<…>`). Un jeton neuf oblige donc à étendre
 *     cette déclaration-là, jamais à la contourner ;
 *   • SILENCE REFUSÉ — une porte seule sur son écran DÉCLARE `token: null` (et
 *     `handed: null`). L'omission est un écart : c'est le silence qui laisserait
 *     passer une seconde porte sur le même écran ; et un jeton sur un écran qui
 *     n'en porte qu'une est une exclusivité imaginaire, refusée aussi.
 *
 * Le jugement est PUR (`judgeMonthsEditorHosts`) : il prend un corpus
 * `{ file, text }[]` et rend des écarts NOMMÉS. La suite
 * (`tests/months-editor-hosts.test.ts`) l'exécute sur l'arbre réel et prouve
 * chaque règle par une mutation — c'est la même forme que `judgeWriteGates`.
 *
 * La prose est blanchie par la couche partagée (`maskComments`) : une porte
 * RACONTÉE dans un commentaire n'est pas une porte, et un motif cité dans un
 * commentaire ne prouve rien.
 */
import { maskComments } from '../scripts/lib/source-text.mjs';

/** Le composant unique, et le motif qui dit qu'un fichier le REND. */
export const MONTHS_EDITOR = 'src/components/PaymentMonthsEditor.tsx';
// Sans le drapeau `g` à dessein : un motif partagé entre fichiers garderait un
// `lastIndex` d'un fichier à l'autre, et le scan sauterait des portes.
const EDITOR_TAG = /<PaymentMonthsEditor\b/;

/**
 * Un ÉCRAN : l'endroit où des portes peuvent se rejoindre. Deux portes du même
 * écran doivent s'exclure ; une porte seule n'a rien à arbitrer, et le DIT.
 */
export interface MonthsEditorScreen {
  /** L'identité de l'écran — c'est elle qui groupe les portes à arbitrer. */
  id: string;
  /** Le fichier qui DÉCLARE l'ensemble des hôtes de cet écran. */
  hosts: string;
  /**
   * L'état qui porte cet ensemble (`editorHost`), lu dans ce fichier — jamais
   * recopié : un écran qui n'a pas encore d'ensemble d'hôtes déclare `null`, et
   * le jour où il reçoit une seconde porte, il doit le nommer.
   */
  state: string | null;
}

/**
 * Une PORTE : un composant qui rend l'éditeur des mois, son hôte, et la preuve
 * des deux moitiés de l'exclusivité.
 */
export interface MonthsEditorDoor {
  /** Le fichier de la porte (celui qui rend `<PaymentMonthsEditor`). */
  door: string;
  /** L'écran où elle peut s'afficher — une identité de `MONTHS_EDITOR_SCREENS`. */
  screen: string;
  /** Son HÔTE : qui la monte. */
  host: string;
  /** La preuve que l'hôte la monte vraiment (un motif de RENDU, pas d'import). */
  mounts: RegExp;
  /**
   * Le jeton qui l'arbitre, ou `null` — DÉCLARÉ dans tous les cas : `null` veut
   * dire « seule porte de mon écran », et l'omettre est un écart (le silence).
   */
  token: string | null;
  /** L'hôte REMET le jeton à la porte (dès que l'écran en porte plusieurs). */
  handed: { file: string; pattern: RegExp } | null;
  /** Où l'éditeur s'OUVRE, dans cette porte. */
  when: { file: string; pattern: RegExp };
}

/**
 * ─── L'INVENTAIRE ───────────────────────────────────────────────────────────
 *   • `student-file` — la FICHE d'un élève, qui porte deux portes : le parcours
 *     de rattrapage (au-dessus) et le carnet des paiements (en dessous). Les deux
 *     ouvrent le même éditeur, sur le même reçu possible : c'est là que le jeton
 *     `editorHost` fait le travail.
 *   • `silent-receipts-tab` — l'écran École, qui porte lui aussi DEUX portes
 *     depuis le parcours élève par élève : la passe groupée (une classe, un choix
 *     de mois commun) et le parcours (la liste dans son ordre, un reçu à la fois).
 *     L'ensemble des hôtes vit dans la vue (`editorHost`), et il a fallu l'ÉTENDRE
 *     pour la seconde porte — c'est exactement ce que ce verrou exige.
 */
export const MONTHS_EDITOR_SCREENS: MonthsEditorScreen[] = [
  {
    id: 'student-file',
    hosts: 'src/components/StudentDetailsModal.tsx',
    state: 'editorHost',
  },
  {
    id: 'silent-receipts-tab',
    hosts: 'src/components/SilentReceiptsView.tsx',
    state: 'editorHost',
  },
];

export const MONTHS_EDITOR_DOORS: MonthsEditorDoor[] = [
  {
    // Le geste direct, sur une ligne du carnet (« Renseigner les mois »).
    door: 'src/components/PaymentLedger.tsx',
    screen: 'student-file',
    host: 'src/components/StudentDetailsModal.tsx',
    mounts: /<PaymentLedger\b/,
    token: 'ledger',
    // La fiche remet l'ensemble à son carnet, qui compare.
    handed: { file: 'src/components/StudentDetailsModal.tsx', pattern: /editorHost=\{editorHost\}/ },
    // Et le carnet ne remplace la ligne par l'éditeur que si c'est LUI l'hôte.
    when: { file: 'src/components/PaymentLedger.tsx', pattern: /editorHost === 'ledger'/ },
  },
  {
    // Le parcours de rattrapage : un reçu, un enregistrement, le suivant.
    door: 'src/components/PaymentMonthsBackfill.tsx',
    screen: 'student-file',
    host: 'src/components/StudentDetailsModal.tsx',
    mounts: /<PaymentMonthsBackfill\b/,
    token: 'backfill',
    // La fiche remet le jeton au parcours : sans lui, il ne reçoit aucun reçu à
    // éditer (`null`) — c'est ce qui l'empêche d'ouvrir un second éditeur.
    handed: { file: 'src/components/StudentDetailsModal.tsx', pattern: /editorHost === 'backfill'/ },
    when: { file: 'src/components/PaymentMonthsBackfill.tsx', pattern: /editingPaymentId === p\.id/ },
  },
  {
    // La passe groupée : une classe, un choix de mois commun, un reçu à la fois.
    door: 'src/components/SilentReceiptsPass.tsx',
    screen: 'silent-receipts-tab',
    host: 'src/components/SilentReceiptsView.tsx',
    mounts: /<SilentReceiptsPass\b/,
    token: 'pass',
    // La vue remet l'ensemble des hôtes — la moitié « qui arbitre » de la règle.
    handed: { file: 'src/components/SilentReceiptsView.tsx', pattern: /editorHost=\{editorHost\}/ },
    // Et la passe ne rend l'éditeur que lorsqu'elle le DÉTIENT.
    when: { file: 'src/components/SilentReceiptsPass.tsx', pattern: /editorHost === 'pass'/ },
  },
  {
    // Le parcours élève par élève : la liste dans son ordre, un reçu à la fois,
    // sans ouvrir une seule fiche. Seconde porte du MÊME écran, sur le même
    // éditeur — donc un jeton DISTINCT de celui de la passe.
    door: 'src/components/SilentReceiptsWalk.tsx',
    screen: 'silent-receipts-tab',
    host: 'src/components/SilentReceiptsView.tsx',
    mounts: /<SilentReceiptsWalk\b/,
    token: 'walk',
    handed: { file: 'src/components/SilentReceiptsView.tsx', pattern: /editorHost=\{editorHost\}/ },
    when: { file: 'src/components/SilentReceiptsWalk.tsx', pattern: /editorHost === 'walk'/ },
  },
];

export interface MonthsEditorSource {
  file: string;
  text: string;
}

export interface MonthsEditorHostsJudgement {
  /** Les écarts, nommés — chacun commence par son code, lisible sans décodeur. */
  problems: string[];
  /** Les fichiers qui RENDENT l'éditeur, avec leur ligne (le corpus réel). */
  found: { file: string; line: number }[];
  /** Les portes de chaque écran — la matière de l'exclusivité. */
  screens: Map<string, string[]>;
}

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/** Les fichiers du corpus qui RENDENT l'éditeur — prose blanchie, donc jamais une citation. */
export function doorsIn(sources: readonly MonthsEditorSource[]): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  for (const source of sources) {
    const text = maskComments(source.text);
    const hit = EDITOR_TAG.exec(text);
    if (hit) out.push({ file: source.file, line: lineOf(text, hit.index) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Les jetons que le fichier d'hôtes DÉCLARE — lus dans le `useState<…>` de
 * l'état nommé par l'écran. `null` quand la déclaration ne se lit pas : le
 * jugement le DIT au lieu de deviner la liste.
 */
function declaredTokens(
  byFile: Map<string, string>,
  screen: MonthsEditorScreen,
): string[] | null {
  const text = byFile.get(screen.hosts);
  if (text === undefined || screen.state === null) return null;
  const pattern = new RegExp(`\\[\\s*${screen.state}\\s*,[^\\]]*\\]\\s*=\\s*useState<([^>]*)>`);
  const hit = pattern.exec(maskComments(text));
  if (!hit) return null;
  return hit[1]
    .split('|')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '' && part !== 'null');
}

/**
 * Le jugement, dans le sens de la demande : toute porte vers l'éditeur des mois
 * déclare son hôte, et deux portes d'un même écran ne peuvent pas l'ouvrir en
 * même temps.
 */
export function judgeMonthsEditorHosts({
  doors = MONTHS_EDITOR_DOORS,
  screens = MONTHS_EDITOR_SCREENS,
  sources = [],
}: {
  doors?: readonly MonthsEditorDoor[];
  screens?: readonly MonthsEditorScreen[];
  sources?: readonly MonthsEditorSource[];
} = {}): MonthsEditorHostsJudgement {
  const problems: string[] = [];
  const screensOf = new Map<string, string[]>();
  const byFile = new Map(sources.map((source) => [source.file, source.text]));
  const masked = (file: string): string | null => {
    const text = byFile.get(file);
    return text === undefined ? null : maskComments(text);
  };

  // ── Non-vacuité : un corpus vide n'est pas un état sain, c'est un regard qui
  //    n'a rien atteint. Le contrôle refuse de conclure.
  if (sources.length === 0) {
    problems.push('CORPUS VIDE — aucun fichier lu : le verrou n’a rien atteint, donc il ne prouve rien.');
    return { problems, found: [], screens: screensOf };
  }
  const found = doorsIn(sources);
  if (found.length === 0) {
    problems.push(
      `AUCUNE PORTE TROUVÉE — aucun fichier ne rend <PaymentMonthsEditor> : le scan est aveugle, ` +
        `et un scan aveugle ne peut pas dire qu’il n’y a pas de porte.`,
    );
  }

  const declared = new Set<string>();
  for (const door of doors) {
    // ── La déclaration elle-même : une porte nommée deux fois, un écran inconnu.
    if (declared.has(door.door)) {
      problems.push(`PORTE DUPLIQUÉE — « ${door.door} » est déclarée deux fois dans l’inventaire.`);
      continue;
    }
    declared.add(door.door);

    const screen = screens.find((entry) => entry.id === door.screen);
    if (!screen) {
      problems.push(
        `ÉCRAN INCONNU — « ${door.door} » déclare l’écran « ${door.screen} », qui n’est pas déclaré : ` +
          'nommez l’écran, ou rattachez la porte à un écran existant.',
      );
      continue;
    }
    const list = screensOf.get(screen.id);
    if (list) list.push(door.door);
    else screensOf.set(screen.id, [door.door]);

    // ── La déclaration dit-elle VRAI ? La porte rend-elle encore l'éditeur, et
    //    son hôte la monte-t-il vraiment ?
    if (!found.some((entry) => entry.file === door.door)) {
      problems.push(
        `PORTE DISPARUE — « ${door.door} » est déclarée mais ne rend plus <PaymentMonthsEditor> : entrée périmée.`,
      );
    }
    const hostText = masked(door.host);
    if (hostText === null) {
      problems.push(
        `HÔTE INTROUVABLE — « ${door.door} » déclare l’hôte « ${door.host} », absent du corpus lu.`,
      );
    } else if (!door.mounts.test(hostText)) {
      problems.push(
        `HÔTE MUET — « ${door.host} » ne monte pas « ${door.door} » (motif ${door.mounts}) : ` +
          'la porte est déclarée chez un hôte qui ne la rend pas.',
      );
    }
    const whenText = masked(door.when.file);
    if (whenText === null) {
      problems.push(
        `CONDITION ILLISIBLE — « ${door.door} » : la source « ${door.when.file} » de son ouverture n’a pas été lue.`,
      );
    } else if (!door.when.pattern.test(whenText)) {
      problems.push(
        `CONDITION ABSENTE — « ${door.door} » n’ouvre plus sous ${door.when.pattern} dans ${door.when.file} : ` +
          'la condition qui la garde a disparu de la source.',
      );
    }
  }

  // ── Un HÔTE qui monte plusieurs portes n'a pas plusieurs écrans : ce qu'il
  //    rend peut s'afficher ENSEMBLE, donc ses portes doivent être du même écran
  //    et s'arbitrer par un jeton. Sans cette règle, une porte neuve se
  //    déclarerait « seule sur son écran » tout en vivant chez l'hôte d'une autre
  //    — exactement le chemin silencieux vers deux éditeurs à l'écran.
  const byHost = new Map<string, MonthsEditorDoor[]>();
  for (const door of doors) {
    const list = byHost.get(door.host);
    if (list) list.push(door);
    else byHost.set(door.host, [door]);
  }
  for (const [host, mounted] of byHost) {
    if (mounted.length < 2) continue;
    if (new Set(mounted.map((door) => door.screen)).size === 1) continue;
    problems.push(
      `ÉCRAN MAL DÉCLARÉ — l’hôte « ${host} » monte ` +
        `${mounted.map((door) => `« ${door.door} » (écran « ${door.screen} »)`).join(' et ')} : ` +
        'les portes d’un même hôte ne sont pas deux écrans — déclarez-les sur le même écran, et arbitrez-les par un jeton.',
    );
  }

  // ── Le rendu SANS déclaration : c'est le troisième point d'entrée, celui que
  //    ce verrou existe pour arrêter.
  for (const entry of found) {
    if (declared.has(entry.file)) continue;
    problems.push(
      `PORTE NON DÉCLARÉE — ${entry.file}:${entry.line} rend l’éditeur des mois sans se déclarer : ` +
        'ajoutez-la à l’inventaire avec son hôte, son écran, et son jeton si l’écran en porte déjà une autre.',
    );
  }

  // ── L'ÉCRAN : l'exclusivité, ses deux moitiés, et le silence refusé.
  for (const [id, doorsOfScreen] of screensOf) {
    const screen = screens.find((entry) => entry.id === id);
    if (!screen) continue;
    const shared = doorsOfScreen.length > 1;
    const tokens = declaredTokens(byFile, screen);

    for (const name of doorsOfScreen) {
      const door = doors.find((entry) => entry.door === name);
      if (!door) continue;
      if (!shared) {
        if (door.token !== null || door.handed !== null) {
          problems.push(
            `JETON INUTILE — « ${door.door} » est seule sur l’écran « ${id} » et déclare un arbitrage ` +
              `(jeton ${JSON.stringify(door.token)}) : un jeton que rien ne partage est une exclusivité imaginaire.`,
          );
        }
        continue;
      }
      if (door.token === null) {
        problems.push(
          `ÉCRAN NON ARBITRÉ — l’écran « ${id} » porte ${doorsOfScreen.length} portes et « ${door.door} » ` +
            'ne déclare aucun jeton d’hôte : deux portes sans arbitrage ouvrent deux éditeurs à la fois.',
        );
        continue;
      }
      if (!door.handed) {
        problems.push(
          `JETON NON REMIS — « ${door.door} » déclare le jeton « ${door.token} » mais son hôte ne le lui remet pas : ` +
            'la porte ne peut pas s’effacer devant l’autre.',
        );
        continue;
      }
      const handedText = masked(door.handed.file);
      if (handedText === null || !door.handed.pattern.test(handedText)) {
        problems.push(
          `JETON NON REMIS — « ${door.door} » : ${door.handed.file} ne contient plus ${door.handed.pattern} — ` +
            'l’arbitrage est déclaré, pas appliqué.',
        );
      }
      if (tokens === null) {
        problems.push(
          `TYPE D’HÔTES ILLISIBLE — l’écran « ${id} » déclare ses hôtes dans ${screen.hosts} sans état lisible : ` +
            'un ensemble d’hôtes qu’on ne lit pas ne peut pas être vérifié.',
        );
      } else if (!tokens.includes(door.token)) {
        problems.push(
          `JETON NON DÉCLARÉ — le jeton « ${door.token} » de « ${door.door} » n’est pas membre de l’ensemble ` +
            `déclaré dans ${screen.hosts} (${tokens.map((t) => `'${t}'`).join(', ')}) — étendez la DÉCLARATION des hôtes.`,
        );
      }
    }

    // ── Deux portes qui déclarent le MÊME jeton ne s'excluent pas : elles
    //    s'ouvriraient ensemble, ou jamais.
    const seen = new Map<string, string>();
    for (const name of doorsOfScreen) {
      const door = doors.find((entry) => entry.door === name);
      if (!door?.token) continue;
      const other = seen.get(door.token);
      if (other) {
        problems.push(
          `JETON PARTAGÉ — l’écran « ${id} » : « ${other} » et « ${door.door} » déclarent le même jeton ` +
            `« ${door.token} » — deux portes ne s’excluent pas avec un seul jeton.`,
        );
      } else {
        seen.set(door.token, door.door);
      }
    }
  }

  return { problems, found, screens: screensOf };
}
