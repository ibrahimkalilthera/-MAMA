/**
 * Lock-in test for the calendar-notes author-only security contract
 * (supabase/migrations/20260908000000_calendar_notes_author_only.sql).
 *
 * The team-wide day notes live in the shared `calendar_notes` table. After
 * that migration:
 *   • a BEFORE INSERT trigger stamps `created_by = auth.uid()` (the app never
 *     sends it — without the trigger a `created_by = auth.uid()` restriction
 *     would be a no-op because every row would have NULL);
 *   • READ and INSERT stay open to every authenticated account (the notes are
 *     a team artefact — every account must see and add them);
 *   • UPDATE and DELETE are restricted to the author
 *     (`auth.role()='authenticated' AND created_by = auth.uid()`).
 *
 * This suite is a STATIC guard: it reads the real migration SQL file and
 * asserts the contract is present. It is pure-node, deterministic (no
 * backend, no network, no Supabase local) and fails loudly the moment someone
 * weakens the trigger, re-opens update/delete to any authenticated user, or
 * deletes the file. The behavioural proof (two accounts, RLS enforced end to
 * end) lives in the applied-prod verification — this suite pins the source of
 * truth so a regression cannot ship silently.
 *
 * All assertions are anchored to tokens unique to THIS migration so a future
 * unrelated migration touching calendar_notes cannot false-positive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL('../supabase/migrations/20260908000000_calendar_notes_author_only.sql', import.meta.url),
);
const sql = readFileSync(migrationPath, 'utf8');
// The migration is committed with CRLF line endings — normalize so the token
// assertions below are independent of the checkout's line-ending flavour.
const text = sql.replace(/\r\n/g, '\n');

/** Assert a block bounded by `fromToken` … `toToken` contains every needle
 *  (whitespace-insensitive). Guards against a partial/truncated rewrite. */
function assertBlockHas(fromToken: string, toToken: string, needles: string[], label: string) {
  const from = text.indexOf(fromToken);
  const to = toToken ? text.indexOf(toToken, from) : text.length;
  assert.ok(from >= 0, `${label}: ouverture « ${fromToken} » introuvable`);
  if (toToken) assert.ok(to > from, `${label}: fermeture « ${toToken} » introuvable après l'ouverture`);
  const block = text.slice(from, toToken ? to : text.length);
  for (const n of needles) {
    const normalized = n.replace(/\s+/g, ' ');
    assert.ok(
      block.replace(/\s+/g, ' ').includes(normalized),
      `${label}: « ${n} » absent du bloc de la migration`,
    );
  }
}

describe('calendar_notes — trigger + politiques author-only (migration 20260908000000)', () => {
  it('la migration existe et est dédiée aux notes de calendrier', () => {
    assert.ok(sql.length > 0, 'fichier de migration non vide');
    assert.ok(text.includes('calendar_notes'), 'le fichier concerne calendar_notes');
    assert.ok(text.includes('restreint la modification/suppression à l\u2019auteur') || text.includes("à l'auteur"), 'commentaire d\u2019intention présent');
  });

  it('le trigger renseigne created_by = auth.uid() à l\u2019insertion', () => {
    // Function
    assertBlockHas(
      'CREATE OR REPLACE FUNCTION public.set_calendar_note_created_by()',
      'EXECUTE FUNCTION',
      [
        'RETURNS TRIGGER AS',
        'NEW.created_by := auth.uid();',
        'RETURN NEW;',
        'LANGUAGE plpgsql',
        'SECURITY DEFINER',
      ],
      'fonction du trigger',
    );
    // Trigger wiring
    assertBlockHas(
      'CREATE TRIGGER calendar_notes_set_created_by',
      'DROP POLICY IF EXISTS "Authenticated read calendar_notes"',
      [
        'BEFORE INSERT ON public.calendar_notes',
        'FOR EACH ROW',
        'EXECUTE FUNCTION public.set_calendar_note_created_by()',
      ],
      'création du trigger',
    );
  });

  it('la lecture reste partagée : toute personne authentifiée lit', () => {
    assertBlockHas(
      'CREATE POLICY "Authenticated read calendar_notes"',
      'CREATE POLICY "Authenticated insert calendar_notes"',
      [
        'FOR SELECT',
        'USING (auth.role() = \'authenticated\')',
      ],
      'politique de lecture',
    );
    // La lecture ne doit PAS être restreinte à l'auteur.
    assert.ok(
      !text.replace(/\s+/g, ' ').includes(`FOR SELECT USING (auth.role() = 'authenticated' AND created_by = auth.uid())`),
      'la lecture ne doit jamais être verrouillée sur l\u2019auteur (partage d\u2019équipe)',
    );
  });

  it('l\u2019insertion reste ouverte : toute personne authentifiée crée une note', () => {
    assertBlockHas(
      'CREATE POLICY "Authenticated insert calendar_notes"',
      'CREATE POLICY "Owner update calendar_notes"',
      [
        'FOR INSERT',
        'WITH CHECK (auth.role() = \'authenticated\')',
      ],
      'politique d\u2019insertion',
    );
  });

  it('la modification est restreinte à l\u2019auteur (USING + WITH CHECK)', () => {
    assertBlockHas(
      'CREATE POLICY "Owner update calendar_notes"',
      'CREATE POLICY "Owner delete calendar_notes"',
      [
        'FOR UPDATE',
        'USING (auth.role() = \'authenticated\' AND created_by = auth.uid())',
        'WITH CHECK (auth.role() = \'authenticated\' AND created_by = auth.uid())',
      ],
      'politique de modification',
    );
  });

  it('la suppression est restreinte à l\u2019auteur', () => {
    assertBlockHas(
      'CREATE POLICY "Owner delete calendar_notes"',
      '', // jusqu'à la fin du fichier
      [
        'FOR DELETE',
        'USING (auth.role() = \'authenticated\' AND created_by = auth.uid())',
      ],
      'politique de suppression',
    );
  });

  it('les anciennes politiques larges « Authenticated update/delete » sont supprimées', () => {
    // Le verrou est réel : le fichier doit DROP les anciennes politiques qui
    // autorisaient tout authentifié à modifier/supprimer.
    assert.ok(
      text.includes('DROP POLICY IF EXISTS "Authenticated update calendar_notes"'),
      'l\u2019ancienne politique UPDATE large doit être supprimée',
    );
    assert.ok(
      text.includes('DROP POLICY IF EXISTS "Authenticated delete calendar_notes"'),
      'l\u2019ancienne politique DELETE large doit être supprimée',
    );
    // Et plus aucune politique ne doit nommer une UPDATE/DELETE « Authenticated ».
    const wideUpdate = /CREATE POLICY "Authenticated (update|delete) calendar_notes"/;
    assert.ok(!wideUpdate.test(text), 'aucune politique UPDATE/DELETE large « Authenticated » ne doit exister');
  });

  it('aucune politique n\u2019autorise la modification/suppression de la note d\u2019autrui', () => {
    const updatePolicies = [...text.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.calendar_notes\s+FOR UPDATE/g)];
    assert.ok(updatePolicies.length === 1, `attendu exactement 1 politique UPDATE, trouvé ${updatePolicies.length}`);
    assert.equal(updatePolicies[0]![1], 'Owner update calendar_notes', 'l\u2019unique politique UPDATE doit être author-only');

    const deletePolicies = [...text.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.calendar_notes\s+FOR DELETE/g)];
    assert.ok(deletePolicies.length === 1, `attendu exactement 1 politique DELETE, trouvé ${deletePolicies.length}`);
    assert.equal(deletePolicies[0]![1], 'Owner delete calendar_notes', 'l\u2019unique politique DELETE doit être author-only');
  });
});