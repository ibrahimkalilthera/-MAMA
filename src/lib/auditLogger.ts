import { supabase } from './supabaseClient';
import { enqueueOfflineAction } from './offlineQueue';
import { isConnectivityFailure, isStationOffline } from './networkUtils';

export interface AuditLogEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  /**
   * L'instant du GESTE. Pour une entrée saisie hors ligne, c'est celui du poste
   * qui l'a faite — jamais l'instant où le câble est revenu (voir `syncedAt`).
   */
  createdAt: string;
  /**
   * Le geste a été SAISI sans réseau, puis écrit à la reconnexion.
   *
   * C'est un DRAPEAU, pas une déduction : il est posé au rejeu. Le chercher dans
   * `details` (un « [replay] » glissé dans un texte libre) rapprocherait deux
   * entrées d'un même mot — le dépôt refuse ce raccourci partout ailleurs, il ne
   * le prend pas ici.
   */
  recordedOffline?: boolean;
  /** L'instant où la ligne a atteint la base. En ligne : ≈ `createdAt`. */
  syncedAt?: string;
}

export interface LogAuditParams {
  action: string;
  targetType?: string;
  targetId?: string | null;
  details?: string;
  user?: {
    id?: string;
    email?: string;
    full_name?: string;
    role?: string;
  } | null;
  /**
   * L'instant du geste, pour une entrée qui a attendu la ligne.
   *
   * Le drain de la file hors ligne est le SEUL appelant qui le pose : il rejoue
   * un geste fait plus tôt, et sans cette date la base écrirait l'heure du
   * câble retrouvé. Absent (le cas courant), l'entrée est en ligne et le serveur
   * horodate lui-même.
   */
  offlineCaptureAt?: string;
}

// ─── Actor resolution ────────────────────────────────────────────────────────
// Most call sites live in the data layer and don't know the current user.
// Resolve it once per page-load from the session + user_profiles, so the
// trail records WHO acted instead of a generic "system".
//
// L'ACTEUR DÉCLARÉ passe avant tout le reste : `useAuth` appelle setAuditActor
// dès qu'une session existe (y compris une session HORS LIGNE, dont
// `supabase.auth.getUser()` ne peut rien dire). Sans lui, un geste enregistré
// sans réseau était attribué à « System Staff » — et le restait, parce qu'un
// acteur introuvable était mémorisé pour toute la page (voir ci-dessous).
let registeredActor: LogAuditParams['user'] | undefined;
let cachedActor: LogAuditParams['user'] | undefined;

/**
 * Identifier l'utilisateur courant une fois pour toutes (appelé par useAuth).
 *
 * `null` = personne (déconnexion) ; `undefined` n'est jamais posé par ce setter :
 * l'appelant dit toujours ce qu'il sait.
 */
export function setAuditActor(actor: LogAuditParams['user'] | null): void {
  registeredActor = actor ?? null;
  // L'acteur mémorisé par une résolution précédente est périmé : c'est celui de
  // l'ancien compte, ou `null` parce que la ligne était coupée.
  cachedActor = undefined;
}

async function resolveActor(): Promise<LogAuditParams['user']> {
  if (registeredActor) return registeredActor;
  if (cachedActor !== undefined) return cachedActor;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      cachedActor = null;
      return null;
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .maybeSingle();
    cachedActor = {
      id: user.id,
      email: user.email || 'system',
      full_name: profile?.full_name || (user.user_metadata?.full_name as string) || 'System Staff',
      role: profile?.role || 'staff',
    };
    return cachedActor;
  } catch (err) {
    // Une ligne coupée n'est PAS « personne » : mémoriser `null` ici faisait
    // rester le reste de la session sans nom d'auteur, même une fois le réseau
    // revenu (le cache ne se rechargeait jamais). On rend `null` pour cette
    // entrée, et la tentative suivante re-résoudra.
    if (isConnectivityFailure(err)) return null;
    cachedActor = null;
    return null;
  }
}

/**
 * Persists an audit log entry in Supabase audit_logs table.
 *
 * SANS RÉSEAU, l'entrée n'est pas perdue : elle part dans la file hors ligne,
 * avec son ACTEUR FIGÉ (nom, courriel, rôle au moment du geste) — la retrouver
 * au rejeu l'attribuerait à la personne qui a rebranché le câble.
 *
 * La valeur de retour dit alors « prise en charge » (en file, elle sera écrite
 * au retour de la ligne), et non « déjà dans la base » : les deux sont incon-
 * fondables dans le journal affiché, qui marque les entrées en attente.
 */
export async function logAuditEvent({
  action,
  targetType,
  targetId,
  details,
  user,
  offlineCaptureAt,
}: LogAuditParams): Promise<boolean> {
  const actor = user ?? (await resolveActor());
  // Une entrée rejouée porte la date de son GESTE et se déclare hors ligne : les
  // deux vont ensemble, et c'est ce couple que l'écran et le PDF lisent pour
  // écrire la ligne en rouge. Un rejeu sans date garderait `now()`, donc la
  // semaine d'archive serait celle du câble — la faute exacte qu'on répare.
  const offlineRow = offlineCaptureAt
    ? { created_at: offlineCaptureAt, recorded_offline: true }
    : {};
  if (isStationOffline()) {
    enqueueOfflineAction('addAuditLog', {
      userId: actor?.id ?? null,
      userEmail: actor?.email,
      userName: actor?.full_name,
      userRole: actor?.role,
      action,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      details: details ?? null,
    });
    return true;
  }
  try {
    const { error } = await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_email: actor?.email || 'system',
      user_name: actor?.full_name || actor?.email || 'System Staff',
      user_role: actor?.role || 'staff',
      action,
      target_type: targetType || null,
      target_id: targetId || null,
      details: details || null,
      ...offlineRow,
    });

    if (error) {
      console.warn('Failed to persist audit log entry:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Audit logging exception:', err);
    return false;
  }
}
