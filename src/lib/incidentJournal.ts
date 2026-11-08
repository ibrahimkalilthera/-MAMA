/**
 * Journal d'incidents du POSTE.
 *
 * Le défaut réparé n'est pas « il manque un rapport de crash » : c'est qu'une
 * panne chez l'école n'existait NULLE PART. Une exception non attrapée laissait
 * une console que personne n'ouvre, sur un poste que personne ne voit ; le
 * lendemain, la seule trace était « ça a planté », sans heure, sans version, sans
 * fichier. Le guichet ne pouvait ni dire ce qui s'était passé, ni transmettre de
 * quoi le réparer.
 *
 * Ce module tient donc un anneau BORNÉ d'incidents — les plus récents d'abord —
 * que l'écran peut montrer et copier. Trois choix, et ils sont des refus :
 *
 *   • **Aucune donnée d'élève.** Un message d'erreur peut citer un nom, un
 *     téléphone, une adresse : le journal ne garde ni la pile complète ni un
 *     contexte libre, tronque le message, et masque les chiffres longs, les
 *     courriels et les requêtes d'URL. Un journal de diagnostic qui recopie le
 *     registre de l'école serait une fuite, pas un secours.
 *   • **Borne dure.** `localStorage` a un quota partagé avec la file hors ligne
 *     et l'instantané : un journal non borné finirait par empêcher d'enregistrer
 *     un paiement. 40 entrées suffisent à raconter une journée de panne.
 *   • **Ne lève jamais.** Un incident qui échoue à se noter ne doit pas devenir
 *     un second incident : l'écriture rend `null` et le geste continue.
 *
 * Ce que ce module NE fait pas : il n'envoie rien. Aucune donnée ne quitte le
 * poste de sa propre initiative — c'est l'école qui copie le rapport et le
 * transmet, et seulement si elle le décide.
 */

const STORAGE_KEY = 'mama_thera_incident_journal';

/**
 * Combien d'incidents l'anneau garde. Assez pour une journée de guichet
 * (une panne en produit quelques-uns, pas des milliers), assez peu pour ne
 * jamais peser sur le quota du stockage local.
 */
export const INCIDENT_JOURNAL_MAX = 40;

/** Un incident tel qu'il est STOCKÉ — déjà expurgé, jamais un objet d'origine. */
export interface IncidentEntry {
  at: string;
  kind: 'uncaught' | 'rejection' | 'boundary' | 'manual';
  name: string;
  message: string;
  where: string;
}

interface RecordInput {
  kind: IncidentEntry['kind'];
  error: unknown;
  where?: string;
  now?: Date;
}

/**
 * Même convention que `offlineQueue.ts` : `localStorage` s'il existe, une Map
 * mémoire sinon (tests, rendu hors navigateur). Deux adaptateurs différents
 * feraient diverger le comportement observé du comportement réel.
 */
const memoryStore = new Map<string, string>();
const storage = {
  getItem(key: string): string | null {
    return typeof localStorage === 'undefined' ? (memoryStore.get(key) ?? null) : localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') {
      memoryStore.set(key, value);
      return;
    }
    localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof localStorage === 'undefined') {
      memoryStore.delete(key);
      return;
    }
    localStorage.removeItem(key);
  },
};

/** Les chiffres d'un identifiant ou d'un montant ne sont pas un diagnostic. */
const LONG_DIGITS = /\d{5,}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** La requête d'une URL peut porter un jeton : on ne la garde pas. */
const URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s]*/g;

/**
 * Expurger un texte libre avant de le stocker.
 *
 * L'ordre compte : on masque d'abord les courriels (qui contiennent des
 * chiffres), puis les requêtes d'URL, puis les suites de chiffres. Une seule
 * passe dans un autre ordre laisserait passer un fragment.
 */
export function redactIncidentText(raw: string, maxLength = 180): string {
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  const masked = singleLine
    .replace(EMAIL, '[courriel]')
    .replace(URL_QUERY, '$1?…')
    .replace(LONG_DIGITS, '#');
  return masked.length > maxLength ? `${masked.slice(0, maxLength - 1)}…` : masked;
}

/**
 * Réduire un emplacement au dernier segment utile : `usePayments.ts:290`.
 *
 * Une pile entière nomme des fonctions et parfois des données ; on ne garde que
 * le fichier et la ligne, qui suffisent à ouvrir le bon endroit sans recopier
 * le contexte d'exécution.
 */
export function shortenIncidentWhere(where: string | undefined): string {
  if (!where) return '';
  const withoutQuery = where.split('?')[0];
  const segments = withoutQuery.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? '';
  // `fichier.ts:290:12` → `fichier.ts:290` : la colonne n'aide pas à réparer.
  return last.replace(/^(.+?:\d+):\d+$/, '$1').slice(0, 80);
}

/** Le nom d'une erreur, sans supposer qu'elle en est une. */
function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return typeof error;
}

/** Le texte d'une erreur, sans jamais appeler `toString` sur un objet libre. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return 'valeur absente';
  return `valeur de type ${typeof error}`;
}

function isEntry(value: unknown): value is IncidentEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<IncidentEntry>;
  return (
    typeof entry.at === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.where === 'string'
  );
}

/**
 * Lire l'anneau. Un contenu illisible rend une liste VIDE sans l'écraser : la
 * prochaine écriture repartira de zéro, et c'est acceptable ici — un journal de
 * diagnostic n'est pas une file de gestes, rien n'y est rejouable.
 */
export function readIncidents(): IncidentEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, INCIDENT_JOURNAL_MAX);
  } catch {
    return [];
  }
}

export function clearIncidents(): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* un journal qu'on n'a pas pu vider ne doit pas faire échouer l'écran */
  }
}

/**
 * Noter un incident — et rendre compte de l'écriture.
 *
 * `null` veut dire « rien n'a été gardé » (stockage refusé). L'appelant n'a rien
 * à faire de ce retour : le journal est un secours, pas une condition du geste.
 */
export function recordIncident(input: RecordInput): IncidentEntry | null {
  try {
    const entry: IncidentEntry = {
      at: (input.now ?? new Date()).toISOString(),
      kind: input.kind,
      name: redactIncidentText(errorName(input.error), 60),
      message: redactIncidentText(errorMessage(input.error)),
      where: shortenIncidentWhere(input.where),
    };
    const next = [entry, ...readIncidents()].slice(0, INCIDENT_JOURNAL_MAX);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return entry;
  } catch {
    // Quota atteint ou stockage indisponible : on n'ajoute pas d'incident au
    // premier incident. L'écran continue.
    return null;
  }
}

/**
 * Une panne du PROCESSUS PRINCIPAL, telle que `electron/incident-journal.cjs`
 * l'a écrite dans `userData`.
 *
 * Elle vit dans un autre fichier que ce module, et c'est voulu : une exception
 * qui tue le processus principal ne peut pas être notée par du code qui tourne
 * dans ce processus-là. L'écran les lit par le pont desktop et les AJOUTE au
 * rapport, pour qu'un seul texte raconte la panne entière.
 */
export interface StationIncidentEntry {
  at: string;
  kind: string;
  message: string;
}

/**
 * Les lignes du poste, à la suite du journal de la page.
 *
 * Le message vient d'un fichier local, pas d'une API : il est ré-expurgé ici
 * quand même — un journal écrit par une version antérieure n'a pas de garantie
 * sur ce qu'il contient, et un rapport qu'on colle dans un courriel ne doit pas
 * dépendre de la discipline d'un autre module.
 */
export function stationIncidentLines(entries: StationIncidentEntry[]): string[] {
  if (entries.length === 0) return [];
  return [
    `poste (processus principal) — ${entries.length} panne${entries.length > 1 ? 's' : ''} retenue${entries.length > 1 ? 's' : ''}`,
    ...entries.map(
      (entry) =>
        `${redactIncidentText(entry.at, 40)} · ${redactIncidentText(entry.kind, 40)} · ${redactIncidentText(entry.message)}`,
    ),
  ];
}

/**
 * Le texte copiable. Il s'ouvre par ce que le support demandera d'abord —
 * version, poste, navigateur — puis une ligne par incident, dans l'ordre du
 * plus récent. Il est BORNÉ : c'est un rapport à coller dans un message, pas
 * une archive.
 */
export function formatIncidentReport(
  entries: IncidentEntry[] = readIncidents(),
  env: { appVersion?: string; station?: string; userAgent?: string } = {},
  station: StationIncidentEntry[] = [],
): string {
  const header = [
    'Journal d’incidents — MAMA THERA',
    `version : ${env.appVersion ?? 'inconnue'} · poste : ${env.station ?? 'inconnu'}`,
  ];
  if (env.userAgent) header.push(`navigateur : ${redactIncidentText(env.userAgent, 90)}`);
  header.push(`${entries.length} incident${entries.length > 1 ? 's' : ''} enregistré${entries.length > 1 ? 's' : ''}`);
  const lines = entries.map((entry) => {
    const where = entry.where ? ` · ${entry.where}` : '';
    return `${entry.at} · ${entry.kind} · ${entry.name} · ${entry.message}${where}`;
  });
  return [...header, ...lines, ...stationIncidentLines(station)].join('\n');
}

/** La surface minimale d'une fenêtre : un émetteur d'événements suffit. */
interface CaptureTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Brancher la capture sur une fenêtre, et rendre le débranchement.
 *
 * On écoute les DEUX canaux : `error` (exception non attrapée) et
 * `unhandledrejection` (promesse rejetée sans `.catch`). Le second est le plus
 * silencieux — une écriture qui échoue dans une promesse oubliée ne casse aucun
 * rendu, et c'est précisément le genre de panne que personne ne signale.
 */
export function installIncidentCapture(win: Window & typeof globalThis): () => void {
  const target = win as unknown as CaptureTarget;

  const onError = (event: Event): void => {
    const failure = event as unknown as { error?: unknown; message?: string; filename?: string; lineno?: number };
    const error = failure.error ?? failure.message ?? 'erreur inconnue';
    const where = failure.filename ? `${failure.filename}:${failure.lineno ?? 0}` : undefined;
    recordIncident({ kind: 'uncaught', error, where });
  };

  const onRejection = (event: Event): void => {
    const rejection = event as unknown as { reason?: unknown };
    recordIncident({ kind: 'rejection', error: rejection.reason ?? 'promesse rejetée' });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
