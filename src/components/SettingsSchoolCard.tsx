/**
 * ─── Le nom de l'école, écrit une fois pour tout le parc ─────────────────────
 *
 * Section des Paramètres — extraite comme les autres, pour que la vue reste sous
 * son budget de lignes. Elle lit ses données et son action par le contexte
 * (`useMainViews`), comme `SettingsClassesCard` et `SettingsUsersCard`.
 *
 * DEUX CHOSES QUE CETTE SECTION DIT, et pas seulement par son libellé :
 *
 *   • **le nom appartient à l'ÉTABLISSEMENT, pas au poste.** Il n'est donc pas
 *     adopté par un poste neuf comme les préférences d'affichage (le thème d'une
 *     salle ne regarde pas la salle d'à côté) : il est écrit UNE fois, dans
 *     `app_settings` (`school.name`), et tout le monde lit la même ligne. C'est
 *     aussi ce qui fait qu'il est écrit par l'administration — les politiques
 *     d'`app_settings` réservent l'écriture à `public.is_admin()`, et le droit de
 *     l'écrire se lit ici par `isAdminRole`, la liste qui reflète `is_admin()`
 *     (voir `npm run check:write-gates` : la porte de l'écran et la politique de
 *     la base sont croisées, pas supposées).
 *
 *   • **la LECTURE a deux issues, et l'écran ne les confond pas non plus.**
 *     « Aucune école n'a déclaré son nom » et « la base n'a pas répondu » se
 *     ressemblent à l'écran — un champ vide — mais n'autorisent pas le même
 *     geste : devant la seconde, réécrire un nom qu'on ne voit pas peut écraser
 *     celui que l'école avait déjà publié. La première est un fait silencieux,
 *     la seconde est DITE (`schoolNameReadFailed`, voir `useSchoolName`).
 *
 *   • **un enregistrement a TROIS issues, et l'écran ne les confond pas.** Le
 *     contrat (`SchoolNameSaveResult`) distingue « enregistré », « mis en file
 *     hors ligne » et « refusé », et chaque phrase le dit : annoncer
 *     « enregistré » sur un changement resté dans la file ferait croire à une
 *     écriture en base qui n'a pas eu lieu, et annoncer un échec sur un geste
 *     réellement mis en file le ferait refaire. Le bouton, lui, ne s'offre ni
 *     pour un brouillon vide ou hors bornes (`isSchoolName`, le même contrat que
 *     la base contraint), ni pour un brouillon identique à ce qui est déjà
 *     écrit.
 */
import { useEffect, useState } from 'react';
import { School } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { isAdminRole } from '../lib/deleteRights';
import { isSchoolName, SCHOOL_NAME_MAX } from '../lib/schoolName';
import type { SchoolNameSaveResult } from '../lib/schoolName';

export function SettingsSchoolCard() {
  const { t, currentTheme, auth, schoolName, schoolNameReadFailed, setSchoolName } = useMainViews();
  // Le rôle est relu ici plutôt que supposé : c'est la MÊME liste que celle de la
  // politique (`is_admin()`), donc l'écran et la base ne peuvent pas diverger.
  const canWrite = isAdminRole(auth?.profile?.role);

  const [draft, setDraft] = useState(schoolName ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SchoolNameSaveResult | null>(null);

  useEffect(() => {
    // Le nom arrive de la BASE, donc après le premier rendu (c'est la session qui
    // le lit). Le brouillon le suit — mais JAMAIS après que quelqu'un a tapé
    // quelque chose : écraser une saisie en cours serait le pire des deux sens.
    if (!touched) setDraft(schoolName ?? '');
  }, [schoolName, touched]);

  const changed = draft.trim() !== (schoolName ?? '');
  const valid = isSchoolName(draft);

  const save = async () => {
    if (!canWrite || !valid || !changed || saving) return;
    setSaving(true);
    const result = await setSchoolName(draft);
    setSaving(false);
    setStatus(result);
    // Refusé : la saisie RESTE telle quelle, l'administrateur corrige au lieu de
    // retaper. Enregistré (ici ou en file) : le poste n'a plus de saisie en cours.
    if (result !== 'refused') setTouched(false);
  };

  const statusText =
    status === 'saved'
      ? t.schoolNameSaved
      : status === 'queued'
        ? t.schoolNameQueued
        : status === 'refused'
          ? t.schoolNameRefused
          : null;

  return (
    <div data-slot="settings-school-name" className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
      <div>
        <h4 className={`text-base font-black ${currentTheme.inkStrong} flex items-center gap-2`}>
          <School size={20} className="text-blue-500" />
          {t.schoolNameTitle}
        </h4>
        <p className={`text-xs ${currentTheme.muted} mt-0.5`}>{t.schoolNameHint}</p>
      </div>

      {/* Une lecture RATÉE se dit : le champ est vide, et sans cette phrase il
          passerait pour « aucune école n'a déclaré son nom » — deux états que le
          geste suivant ne traite pas pareil, puisque l'un invite à écrire un nom
          qui existe peut-être déjà. */}
      {schoolNameReadFailed && (
        <p data-school-name-read="failed" className="text-xs font-bold text-amber-500">
          {t.schoolNameUnread}
        </p>
      )}

      {canWrite ? (
        <div className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.surfaceInset} space-y-3`}>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={draft}
              maxLength={SCHOOL_NAME_MAX}
              // Un champ texte libre SE DÉCLARE (`autoComplete="off"`) : cet écran
              // héberge aussi la fiche « Définir mot de passe », et c'est
              // exactement le voisinage qui a produit le bug du 2026-09-14 (le
              // gestionnaire de mots de passe versait l'e-mail de l'utilisateur
              // dans le champ de recherche voisin). Un nom d'école n'est
              // l'identifiant de personne.
              autoComplete="off"
              placeholder={t.schoolNamePlaceholder}
              aria-label={t.schoolNameTitle}
              onChange={(event) => {
                setTouched(true);
                setStatus(null);
                setDraft(event.target.value);
              }}
              className={`flex-1 p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
            />
            <button
              type="button"
              onClick={save}
              disabled={!valid || !changed || saving}
              className={`px-4 py-2.5 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50`}
            >
              {t.schoolNameSave}
            </button>
          </div>
          {statusText && (
            <p
              data-school-name-status={status}
              className={`text-xs font-bold ${
                status === 'saved'
                  ? 'text-slate-800 dark:text-emerald-400'
                  : status === 'refused'
                    ? 'text-rose-500'
                    : currentTheme.muted
              }`}
            >
              {statusText}
            </p>
          )}
        </div>
      ) : (
        <p className={`text-xs font-bold ${currentTheme.muted}`}>{t.schoolNameAdminOnly}</p>
      )}
    </div>
  );
}
