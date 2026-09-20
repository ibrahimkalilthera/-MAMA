/**
 * Team-wide calendar day notes (calendar_notes table).
 *
 * A day note added from the calendar is a TEAM artefact: every account sees
 * it (todos already behave this way through the todos table). The row lives
 * in `calendar_notes` (id uuid, note_date date, text text, created_by uuid
 * nullable, created_at timestamptz). Anyone authenticated can READ, but only
 * the AUTHOR (created_by = auth.uid()) can UPDATE or DELETE — set by the
 * `calendar_notes_set_created_by` BEFORE INSERT trigger
 * (migration 20260908000000_calendar_notes_author_only.sql).
 *
 * Locked by tests/calendar-notes-db.test.ts (supabaseClient module-mocked —
 * the real client module cannot be loaded under the test runner because
 * import.meta.env does not exist there).
 */
import { supabase } from './supabaseClient';
import { enqueueOfflineAction } from './offlineQueue';
import { createRowId } from './rowMappers';
import { isStationOffline } from './networkUtils';

/** A standalone calendar day note as displayed in the day modal. */
export interface CalendarDayNote {
  id: string;
  date: string;
  text: string;
}

/** Maps a DB row to the shape consumed by the day modal. */
const mapRow = (row: { id: string; note_date: string; text: string }): CalendarDayNote => ({
  id: row.id,
  date: row.note_date,
  text: row.text,
});

/**
 * Fetch every team day note. Returns null when the read failed (caller falls
 * back to an empty list — the modal still works, notes are just missing).
 */
export async function fetchCalendarDayNotes(): Promise<CalendarDayNote[] | null> {
  const { data, error } = await supabase
    .from('calendar_notes')
    .select('id,note_date,text')
    .order('created_at', { ascending: true });
  if (error || !data) return null;
  return (data as Array<{ id: string; note_date: string; text: string }>).map(mapRow);
}

/**
 * Persist a day note for the whole team. Returns null when the write failed
 * (caller keeps the modal open with the text); the created row (real id) is
 * returned on success.
 *
 * HORS LIGNE, la note n'est pas perdue : elle reçoit un identifiant choisi sur
 * le poste (createRowId) et part dans la file — la même note, le même écran,
 * envoyée au retour de la ligne. Rendre `null` ici (ce que faisait cette
 * fonction) aurait fermé le geste en laissant croire à un échec alors que rien
 * n'empêchait de l'enregistrer.
 */
export async function saveCalendarDayNote(date: string, text: string): Promise<CalendarDayNote | null> {
  if (isStationOffline()) {
    const localId = createRowId();
    enqueueOfflineAction('addNote', { date, text }, localId);
    return { id: localId, date, text };
  }
  const { data, error } = await supabase
    .from('calendar_notes')
    .insert({ note_date: date, text })
    .select('id,note_date,text')
    .single();
  if (error || !data) return null;
  return mapRow(data as { id: string; note_date: string; text: string });
}

/**
 * Delete a day note (the ✕ on a note row in the day modal).
 *
 * La règle honnête des autres suppressions s'applique aussi ici : la policy
 * n'autorise que l'AUTEUR de la note, et une suppression filtrée par la RLS
 * répond 200 en n'enlevant rien — `.select('id')` est donc ce qui distingue
 * « supprimée » de « refusée » (l'ancienne version annonçait un succès dans les
 * deux cas). Hors ligne, la suppression part en file.
 */
export async function deleteCalendarDayNote(id: string): Promise<boolean> {
  if (isStationOffline()) {
    enqueueOfflineAction('deleteNote', { id });
    return true;
  }
  const { data, error } = await supabase.from('calendar_notes').delete().eq('id', id).select('id');
  if (error) return false;
  return Boolean(data && data.length > 0);
}