/**
 * Settings view shell (admin/dev only). The individual sections — localisation
 * & preferences, the school name, backup/export, class sections, and user/role
 * management plus the set-password modal — live in their own components under
 * this directory, so this file stays comfortably under the line budget. It reads
 * its own data (theme tokens, the t dict, the auth state) through the
 * MainViewsContext, as each section component does.
 *
 * L'ordre des sections est un CONTRAT, pas une mise en page :
 * `scripts/lib/settings-composition.mjs` porte la table que lisent les deux
 * preuves (`check-settings-composition.mjs` sur la source, et
 * `tests/settings-composition.test.tsx` sur le DOM monté). Ajouter une section
 * sans mettre la table à jour fait échouer les deux.
 */
import { useMainViews } from '../app/mainViewsContext';
import { SettingsHelpCard } from './SettingsHelpCard';
import { SettingsPreferencesCard } from './SettingsPreferencesCard';
import { SettingsSchoolCard } from './SettingsSchoolCard';
import { SettingsYearMonthsCard } from './SettingsYearMonthsCard';
import { SettingsBackupCard } from './SettingsBackupCard';
import { SettingsDiagnosticsCard } from './SettingsDiagnosticsCard';
import { SettingsClassesCard } from './SettingsClassesCard';
import { SettingsUsersCard } from './SettingsUsersCard';
import { SettingsPasswordModal } from './SettingsPasswordModal';

export function SettingsView() {
  const { t, currentTheme, auth } = useMainViews();

  // The settings tab is admin/dev-only (sidebar hides it for other roles too).
  if (!auth?.isAdmin) return null;

  /**
   * Le sommaire des sections, et il ne recopie pas la liste : chaque entrée
   * pointe un `data-slot` que la section déclare DÉJÀ pour le contrat de
   * composition. Un bloc ajouté sans entrée de sommaire ne casse rien — il manque
   * simplement ici — tandis qu'un doublon de liste aurait pu désigner un bloc qui
   * n'existe plus. Huit sections, ~3 écrans de défilement : un sommaire valait
   * mieux qu'un ordre à mémoriser.
   */
  const sections: { slot: string; label: string }[] = [
    { slot: 'settings-first-steps', label: t.firstStepsTitle },
    { slot: 'settings-system-language', label: t.localizationAndPreferences },
    { slot: 'settings-school-name', label: t.schoolNameTitle },
    { slot: 'settings-year-months', label: t.schoolMonthsTitle },
    { slot: 'settings-backup', label: t.backupSettings },
    { slot: 'settings-diagnostics', label: t.stationHealth },
    { slot: 'settings-classes', label: t.classesGradeLevelsManagement },
    { slot: 'settings-staff-access', label: t.staffAccessRoleManagement },
  ];

  const goTo = (slot: string): void => {
    const target = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <div data-slot="settings-panel" className="max-w-2xl space-y-8">
        <nav aria-label={t.settingsIndexNav} className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              key={section.slot}
              type="button"
              onClick={() => goTo(section.slot)}
              className={`px-3 py-1.5 rounded-lg border ${currentTheme.border} ${currentTheme.surfaceInset} text-2xs font-bold ${currentTheme.muted} ${currentTheme.hoverSurface} transition-all`}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className={`${currentTheme.card} p-10 rounded-3xl border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
          <h3 className={`text-xl font-bold ${currentTheme.inkStrong} mb-8`}>{t.localizationAndPreferences}</h3>
          <div data-slot="settings-sections" className="space-y-6">
            <SettingsHelpCard />
            <SettingsPreferencesCard />
            {/* Le nom de l'école est une identité, pas une préférence : il suit
                immédiatement les réglages d'affichage, avant les sections
                d'exploitation (sauvegarde, classes, comptes). */}
            <SettingsSchoolCard />
            {/* Les mois de l'année suivent le nom : le nom dit QUI est l'école,
                la plage dit CE QUE ses reçus réclament — deux faits de
                l'établissement, écrits une fois, avant l'exploitation. */}
            <SettingsYearMonthsCard />
            <SettingsBackupCard />
            <SettingsDiagnosticsCard />
            <SettingsClassesCard />
            <SettingsUsersCard />
          </div>
        </div>
      </div>

      <SettingsPasswordModal />
    </>
  );
}
