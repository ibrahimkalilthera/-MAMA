/**
 * Settings view shell (admin/dev only). The individual sections — localisation
 * & preferences, backup/export, class sections, and user/role management plus
 * the set-password modal — live in their own components under this directory,
 * so this file stays comfortably under the line budget. It reads its own data
 * (theme tokens, the t dict, the auth state) through the MainViewsContext, as
 * each section component does.
 */
import { useMainViews } from '../app/mainViewsContext';
import { SettingsPreferencesCard } from './SettingsPreferencesCard';
import { SettingsBackupCard } from './SettingsBackupCard';
import { SettingsClassesCard } from './SettingsClassesCard';
import { SettingsUsersCard } from './SettingsUsersCard';
import { SettingsPasswordModal } from './SettingsPasswordModal';

export function SettingsView() {
  const { t, currentTheme, auth } = useMainViews();

  // The settings tab is admin/dev-only (sidebar hides it for other roles too).
  if (!auth?.isAdmin) return null;

  return (
    <>
      <div data-slot="settings-panel" className="max-w-2xl space-y-8">
        <div className={`${currentTheme.card} p-10 rounded-3xl border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
          <h3 className={`text-xl font-bold ${currentTheme.inkStrong} mb-8`}>{t.localizationAndPreferences}</h3>
          <div data-slot="settings-sections" className="space-y-6">
            <SettingsPreferencesCard />
            <SettingsBackupCard />
            <SettingsClassesCard />
            <SettingsUsersCard />
          </div>
        </div>
      </div>

      <SettingsPasswordModal />
    </>
  );
}
