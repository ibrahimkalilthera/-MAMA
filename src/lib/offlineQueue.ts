import type { Parent, Student, Staff, SalaryPayment, Expense, VendorExpense, Todo, Payment } from './domainTypes';
import type { PaymentMotif } from './paymentMotifs';
import type { DisplayPreferenceName } from './displayPreferences';

/**
 * Offline Action Queue Manager
 * 
 * Manages queued mutations in localStorage when internet connectivity is lost in Bamako.
 * Enables optimistic UI updates and auto-sync when connection is restored.
 */

export type OfflineActionType =
  | 'addPayment'
  | 'deletePayment'
  | 'updatePaymentMonths'
  | 'addExpense'
  | 'updateExpense'
  | 'deleteExpense'
  | 'addVendorExpense'
  | 'updateVendorExpense'
  | 'deleteVendorExpense'
  | 'addStudent'
  | 'updateStudent'
  | 'deleteStudent'
  | 'addStaff'
  | 'updateStaff'
  | 'deleteStaff'
  | 'addSalaryPayment'
  | 'deleteSalaryPayment'
  | 'addParent'
  | 'updateParent'
  | 'deleteParent'
  | 'addTodo'
  | 'updateTodo'
  | 'deleteTodo'
  | 'addClass'
  | 'updateClass'
  | 'deleteClass'
  | 'addNote'
  | 'deleteNote'
  | 'setCurrentYear'
  | 'addAuditLog'
  | 'updateUserRole'
  | 'setDisplayPreference'
  // Le nom de l'école déclaré sans réseau (voir OfflinePayload, plus bas) : le
  // geste attend la ligne comme les autres, et il part au drainage suivant.
  | 'setSchoolName';

/** Une classe personnalisée, telle que le formulaire la produit (codes compris). */
export interface QueuedClassFields {
  code: string;
  cycle: string;
  year: string;
  section: string;
  nameFr: string;
  nameEn: string;
}

/**
 * L'acteur d'une entrée de journal — figé AU MOMENT DU GESTE.
 *
 * Le retrouver au rejeu le ferait attribuer à la personne qui a rebranché le
 * câble, et non à celle qui a enregistré l'élève : le journal doit dire qui a
 * fait quoi, pas qui passait par là quand la ligne est revenue.
 */
export interface QueuedAuditEntry {
  userId?: string | null;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
  /** Instantané structuré (voir `AuditLogEntry.metadata`) — voyage avec l'entrée. */
  metadata?: Record<string, unknown> | null;
}

/** Payload shape for each queued action type, so replay sites are type-checked. */
export type OfflinePayload =
  | { type: 'addPayment'; payload: { studentId: string; payment: Omit<Payment, 'receiptNumber'> & { receiptNumber?: string } } }
  /**
   * Suppression d'un paiement saisi par erreur. Le montant, le reçu et la date
   * voyagent avec le geste : le rejeu les écrit dans le journal d'audit, sans
   * avoir à relire une ligne qui n'existe plus. Le MOTIF voyage aussi
   * (`scolarite` / `inscription`, voir `src/lib/paymentMotifs.ts`) : l'instantané
   * du rejeu doit être aussi complet que celui du chemin en ligne, sinon une
   * restauration rendrait un reçu d'inscription muet sur son motif.
   */
  | { type: 'deletePayment'; payload: { studentId: string; paymentId: string; amount: number; receiptNumber?: string; date: string; academicYear?: string; studentName?: string; motif?: PaymentMotif } }
  /**
   * Renseigner les mois couverts d'un reçu ANTÉRIEUR à la colonne `months`, ou
   * saisi sans cocher. Le montant, le reçu, la date et l'élève voyagent avec le
   * geste : le rejeu écrit la même entrée de journal que le chemin en ligne sans
   * avoir à relire la ligne `payments` (et l'école sait de quel reçu on parle).
   *
   * Le montant est porté POUR LE JOURNAL, pas pour l'écriture : la mise à jour
   * ne touche que `months` — c'est la limite dite de `paymentRights.ts`
   * (une policy est au niveau de la ligne, pas de la colonne).
   */
  | { type: 'updatePaymentMonths'; payload: { studentId: string; paymentId: string; months: string[]; amount: number; receiptNumber?: string; date: string; studentName?: string } }
  | { type: 'addExpense'; payload: Omit<Expense, 'id'> }
  | { type: 'updateExpense'; payload: { id: string; updates: Partial<Expense> } }
  | { type: 'deleteExpense'; payload: { id: string } }
  | { type: 'addVendorExpense'; payload: Omit<VendorExpense, 'id'> }
  | { type: 'updateVendorExpense'; payload: { id: string; updates: Partial<VendorExpense> } }
  | { type: 'deleteVendorExpense'; payload: { id: string } }
  | { type: 'addStudent'; payload: Omit<Student, 'id' | 'payments'> }
  | { type: 'updateStudent'; payload: { id: string; updates: Partial<Student> } }
  | { type: 'deleteStudent'; payload: { id: string } }
  | { type: 'addStaff'; payload: Omit<Staff, 'id'> }
  | { type: 'updateStaff'; payload: { id: string; updates: Partial<Staff> } }
  | { type: 'deleteStaff'; payload: { id: string } }
  | { type: 'addSalaryPayment'; payload: Omit<SalaryPayment, 'id'> }
  /**
   * Suppression d'un paiement de salaire saisi par erreur.
   *
   * Le MEMBRE, le montant, la date et l'année voyagent avec le geste : le rejeu
   * écrit la même entrée de journal que le chemin en ligne, avec le même
   * instantané (`salaryUndo.ts`), sans avoir à relire une ligne qui n'existe
   * plus. Une suppression saisie sans réseau reste donc annulable — sinon la
   * ligne « supprimée » du journal ne porterait rien à réinsérer.
   */
  | { type: 'deleteSalaryPayment'; payload: { id: string; staffId: string; staffName?: string; amount: number; date: string; academicYear?: string } }
  | { type: 'addParent'; payload: Omit<Parent, 'id'> }
  | { type: 'updateParent'; payload: { id: string; updates: Partial<Parent> } }
  | { type: 'deleteParent'; payload: { id: string } }
  | { type: 'addTodo'; payload: Omit<Todo, 'id'> }
  | { type: 'updateTodo'; payload: { id: string; updates: Partial<Todo> } }
  | { type: 'deleteTodo'; payload: { id: string } }
  | { type: 'addClass'; payload: QueuedClassFields }
  | { type: 'updateClass'; payload: { id: string; updates: QueuedClassFields } }
  | { type: 'deleteClass'; payload: { id: string } }
  | { type: 'addNote'; payload: { date: string; text: string } }
  | { type: 'deleteNote'; payload: { id: string } }
  | { type: 'setCurrentYear'; payload: { year: string } }
  | { type: 'addAuditLog'; payload: QueuedAuditEntry }
  | { type: 'updateUserRole'; payload: { id: string; role: string } }
  /**
   * Un réglage d'affichage changé sans réseau (thème, densité, verre, langue).
   *
   * Ces quatre préférences vivent en base pour voyager avec la sauvegarde : le
   * rejeu écrit la MÊME ligne que le chemin en ligne
   * (`displayPreferenceRow`, src/lib/dataOps/settings.ts). Le nom voyage plutôt
   * que la clé `app_settings` : la correspondance nom → clé n'existe qu'à un
   * endroit, et une file écrite par une version antérieure ne peut pas porter
   * une clé que le contrat ne connaît pas.
   */
  | { type: 'setDisplayPreference'; payload: { name: DisplayPreferenceName; value: string } }
  /**
   * Le NOM DE L'ÉCOLE déclaré sans réseau.
   *
   * Ce n'est pas une préférence de poste : c'est un fait de l'ÉTABLISSEMENT,
   * écrit une fois pour tout le parc (`school.name`), et il accompagne ensuite
   * chaque remontée de poste. Le nom voyage plutôt que la clé `app_settings` —
   * la correspondance nom → clé n'existe qu'à un endroit
   * (`src/lib/schoolName.ts`), et une file écrite par une version antérieure ne
   * peut pas porter une clé que le contrat ne connaît pas.
   */
  | { type: 'setSchoolName'; payload: { name: string } };

export interface QueueItemBase {
  id: string;
  createdAt: string;
  attempts: number;
  /**
   * The id the app gave the row while it was offline (`off_<kind>_…`, see
   * createTempId), for the actions that CREATE a row. The replay uses it to
   * rewrite the later actions that point at that row: a payment recorded for a
   * pupil enrolled offline would otherwise be sent with a student_id no
   * database ever had, and would stay queued forever.
   */
  localId?: string;
  /**
   * Pourquoi la base a refusé la DERNIÈRE tentative de cette entrée.
   *
   * Sans lui, « refusée — à vérifier » ne dit rien d'exploitable : l'école ne
   * peut pas savoir s'il faut corriger une donnée, rétablir un droit, ou
   * constater qu'une cible a disparu. C'est un texte COURT, lu du message
   * serveur (jamais un objet) — voir `describeReplayError` dans offlineReplay.
   */
  lastError?: string | null;
  /** Quand la dernière tentative a eu lieu (ISO), ou absent. */
  lastAttemptAt?: string;
}

export type QueueItem = QueueItemBase & OfflinePayload;

const STORAGE_KEY = 'mama_thera_offline_queue';

/**
 * Le plafond de la file, NOMMÉ — et pourquoi il existe.
 *
 * Une file hors ligne sans borne n'est pas une file, c'est une fuite : chaque
 * entrée porte le payload entier d'un geste, et `localStorage` a un quota
 * (quelques mégaoctets par origine, partagés avec le cache de données du poste).
 * Quand le quota est atteint, `setItem` LÈVE — et l'ancienne version avalait
 * cette exception dans un `console.error` alors que l'écran venait d'annoncer
 * « enregistré » : le paiement était perdu en étant annoncé écrit.
 *
 * 2 000 gestes est très au-delà de ce qu'une école hors ligne accumule entre
 * deux reconnexions (une grosse journée au bureau en produit quelques dizaines),
 * et très en deçà de ce qui remplit un quota. Atteindre ce plafond ne veut donc
 * pas dire « la file est pleine » mais « quelque chose ne remonte plus » : le
 * geste est alors REFUSÉ en le disant, au lieu d'être perdu en silence. Une file
 * qui refuse est un incident visible ; une file qui avale est de l'argent perdu.
 */
export const OFFLINE_QUEUE_MAX_ITEMS = 2000;

/**
 * L'écriture de la file a échoué : le geste n'est PAS enregistré.
 *
 * L'erreur est nommée et porteuse de sa cause, parce que c'est ce que l'écran
 * doit pouvoir dire — « enregistré » est une promesse, et une promesse qu'on ne
 * peut pas tenir ne s'annonce pas.
 */
export class OfflineQueueWriteError extends Error {
  readonly reason: 'queue-full' | 'storage-failed' | 'storage-unreadable';

  constructor(reason: 'queue-full' | 'storage-failed' | 'storage-unreadable', detail?: string) {
    const message =
      reason === 'queue-full'
        ? `File hors ligne pleine (${OFFLINE_QUEUE_MAX_ITEMS} gestes en attente) : ce geste n’a PAS été enregistré.`
        : reason === 'storage-unreadable'
          ? 'La file hors ligne stockée sur ce poste n’est pas lisible : ce geste n’a PAS été enregistré, et rien n’a été écrasé.'
          : `Le stockage de ce poste a refusé l’écriture (${detail ?? 'quota atteint'}) : ce geste n’a PAS été enregistré.`;
    super(message);
    this.name = 'OfflineQueueWriteError';
    this.reason = reason;
  }
}

/**
 * Le magasin est-il indéchiffrable ?
 *
 * `getOfflineQueue` rend `[]` quand le texte stocké est illisible — pratique, et
 * dangereux : le prochain `enqueue` écrit alors une file qui ne contient QUE le
 * geste neuf, et les gestes en attente sont perdus par l'écriture suivante. Une
 * lecture ratée ne doit donc pas se traduire par un écrasement : on retient que
 * le magasin est indéchiffrable, et toute écriture est REFUSÉE tant qu'il l'est
 * (l'école peut alors décider, plutôt que de perdre en silence).
 */
let storageUnreadable: string | null = null;

/**
 * Storage backend: browser localStorage when available, an in-memory map
 * otherwise (SSR and the node test runner) — so the queue can be exercised
 * end-to-end without a DOM. Browser behaviour is unchanged.
 */
const memoryStore = new Map<string, string>();
const storage = {
  getItem(key: string): string | null {
    return typeof localStorage === 'undefined'
      ? (memoryStore.get(key) ?? null)
      : localStorage.getItem(key);
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

/**
 * Retrieve all pending offline items from localStorage.
 */
export function getOfflineQueue(): QueueItem[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      storageUnreadable ??= 'le contenu stocké n’est pas une liste de gestes';
      console.error('File hors ligne illisible :', storageUnreadable);
      return [];
    }
    return parsed;
  } catch (err) {
    // Le texte est LÀ mais illisible : on ne le remplace pas (voir
    // `storageUnreadable`), et on le dit — une file qu'on n'a pas pu lire n'est
    // pas une file vide.
    storageUnreadable ??= String((err as Error)?.message ?? err);
    console.error('File hors ligne illisible :', err);
    return [];
  }
}

/**
 * Écrire la file — et RENDRE COMPTE de l'écriture.
 *
 * L'ancienne version avalait son exception : l'appelant ne pouvait pas savoir
 * que le geste n'était pas rangé, et l'écran annonçait « enregistré ». Le retour
 * est donc explicite, et le seul appelant qui a le droit d'ignorer le refus est
 * celui qui n'enregistre pas un geste neuf (retrait d'une entrée déjà envoyée,
 * marque d'échec) — et il le DIT dans son journal.
 *
 * @returns `{ ok: true }`, ou la cause du refus — jamais une exception muette.
 */
export function saveOfflineQueue(queue: QueueItem[]):
  | { ok: true }
  | { ok: false; reason: 'storage-failed' | 'storage-unreadable'; detail: string } {
  if (storageUnreadable) {
    return { ok: false, reason: 'storage-unreadable', detail: storageUnreadable };
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(queue));
    return { ok: true };
  } catch (err) {
    const detail = String((err as Error)?.message ?? err);
    console.error('Écriture de la file hors ligne refusée :', detail);
    return { ok: false, reason: 'storage-failed', detail };
  }
}

/**
 * Enqueue a new action for later synchronization.
 *
 * `localId` is the offline id of the row this action creates (optional: only
 * the creating actions have one) — see QueueItemBase.localId.
 */
export function enqueueOfflineAction(
  type: OfflineActionType,
  payload: OfflinePayload['payload'],
  localId?: string,
): QueueItem {
  // `type` and `payload` arrive as two independent arguments, so the
  // discriminated-union correlation cannot be verified structurally — assert
  // at this single boundary and let the union narrow every replay site.
  const item = {
    id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    localId,
  } as QueueItem;

  const queue = getOfflineQueue();
  // Le plafond AVANT l'écriture : une file pleine refuse le geste, elle ne le
  // remplace pas et ne le perd pas.
  if (queue.length >= OFFLINE_QUEUE_MAX_ITEMS) {
    throw new OfflineQueueWriteError('queue-full', `${queue.length} gestes`);
  }
  queue.push(item);
  const saved = saveOfflineQueue(queue);
  if (!saved.ok) {
    // Le geste n'est PAS rangé : le dire est tout l'objet de ce retour. L'appelant
    // qui annoncerait « enregistré » malgré ça mentirait à l'école.
    throw new OfflineQueueWriteError(saved.reason, saved.detail);
  }

  return item;
}

/**
 * Remove a successfully processed item from the queue.
 */
export function removeOfflineAction(id: string): void {
  const queue = getOfflineQueue().filter(item => item.id !== id);
  // Ici, un refus d'écriture ne perd AUCUN geste : l'entrée reste en file, donc
  // elle sera rejouée — et le rejeu est idempotent (même id de ligne, la base
  // refuse en 23505). C'est le seul endroit où l'échec est bruyant sans être
  // fatal, et il le reste : le journal le porte.
  const saved = saveOfflineQueue(queue);
  if (!saved.ok) console.error('Retrait d’une entrée non écrit : elle sera rejouée.', saved.detail);
}

/**
 * Clear all items in the offline queue.
 */
export function clearOfflineQueue(): void {
  try {
    storage.removeItem(STORAGE_KEY);
    // Le vidage est aussi la seule sortie de secours d'un magasin indéchiffrable :
    // sans cette remise à zéro, un contenu illisible bloquerait toute écriture
    // pour toujours, et l'école n'aurait aucun moyen de repartir.
    storageUnreadable = null;
  } catch (err) {
    console.error('Failed to clear offline queue:', err);
  }
}

/**
 * Count one more failed attempt at sending this item.
 *
 * An item whose replay fails STAYS queued (it is retried on the next pass, and
 * nothing may be silently dropped). Counting the attempt is what lets the
 * screen DISTINGUISH « en attente d'envoi » from « refused, and it will not go
 * through on its own » — a payment stuck on a deleted pupil would otherwise be
 * retried forever, invisible, while the receipt is already in the parent's hand.
 */
/**
 * Compter une tentative en échec ET retenir POURQUOI.
 *
 * L'ancienne version ne comptait que le nombre d'essais : la bannière pouvait
 * dire « refusée », jamais « refusée parce que… ». Une file qui ne peut pas
 * dire la cause laisse l'école devant un bouton « Synchroniser » qui rejouera
 * le même refus — c'est le défaut que la raison répare. `reason` absent laisse
 * la dernière connue en place (un échec de transport ne doit pas effacer la
 * cause réelle déjà apprise).
 */
export function markOfflineFailure(id: string, reason?: string | null): void {
  const at = new Date().toISOString();
  const queue = getOfflineQueue().map(item =>
    item.id === id
      ? { ...item, attempts: item.attempts + 1, lastAttemptAt: at, lastError: reason ?? item.lastError ?? null }
      : item,
  );
  const saved = saveOfflineQueue(queue);
  // Même raison que pour le retrait : la marque d'échec perdue laisse l'entrée
  // en file (elle sera retentée), et la cause est journalisée.
  if (!saved.ok) console.error('Marque d’échec non écrite.', saved.detail);
}

/**
 * Compatibilité : compter un essai sans raison connue. Délègue à
 * `markOfflineFailure` pour qu'il n'existe qu'un seul chemin d'écriture.
 */
export function markOfflineAttempt(id: string): void {
  markOfflineFailure(id, null);
}

/**
 * Get total number of pending offline actions.
 */
export function getOfflineQueueCount(): number {
  return getOfflineQueue().length;
}

/**
 * Ce type d'action attend-il déjà dans la file ?
 *
 * Sert aux gestes IDEMPOTENTS et répétés par nature — la déclaration d'année est
 * retentée à chaque démarrage : sans ce garde-fou, un poste qui redémarre dix
 * fois hors ligne empile dix fois la même écriture.
 */
export function isActionQueued(type: OfflineActionType): boolean {
  return getOfflineQueue().some(item => item.type === type);
}

/**
 * How many queued actions have already failed at least once. They are still
 * queued (never dropped) — this is the number the user must know about.
 */
export function getOfflineQueueFailures(): number {
  return getOfflineQueue().filter(item => item.attempts > 0).length;
}

/** Une entrée refusée, vue par ce que l'école a besoin de savoir. */
export interface OfflineQueueFailure {
  id: string;
  type: OfflineActionType;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
}

/**
 * Les entrées que la base a refusées, avec la raison du dernier refus.
 *
 * La bannière n'en montre qu'une ; un diagnostic (ou un futur écran) peut les
 * parcourir toutes. L'ordre est celui de la file : le refus le plus ancien
 * d'abord, le plus récent à la fin.
 */
export function getOfflineQueueFailureDetails(): OfflineQueueFailure[] {
  return getOfflineQueue()
    .filter(item => item.attempts > 0)
    .map(item => ({
      id: item.id,
      type: item.type,
      attempts: item.attempts,
      lastError: item.lastError ?? null,
      lastAttemptAt: item.lastAttemptAt ?? null,
    }));
}

/**
 * La raison du dernier refus CONNU, ou `null`.
 *
 * C'est ce que la bannière peut nommer : « refusée — colonne inconnue », etc.
 * Une raison absente (refus sans message) rend `null`, jamais une phrase vide.
 */
export function getLastOfflineFailureReason(): string | null {
  const reasons = getOfflineQueueFailureDetails().filter(failure => failure.lastError);
  return reasons.length ? reasons[reasons.length - 1].lastError : null;
}
