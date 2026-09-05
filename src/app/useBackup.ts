/**
 * Backup/restore domain hook — extracted to its own module like the other
 * domains (useExports, useUsers).
 *
 * Owns the Settings-tab backup flow:
 *  - `handleExportBackup`: serialize the whole DB (exportBackup) and download
 *    it as a versioned JSON file, then audit-log EXPORT_BACKUP;
 *  - `handleRestoreBackup`: consume the file picked through the hidden input,
 *    validate it (parseBackupFile), run the upsert restore, toast the
 *    per-table result and audit-log RESTORE_BACKUP.
 *
 * Role gate: admin OR dev only (same rule as useAuthWelcome's isAdmin) —
 * staff/general_manager/econome get an error toast and nothing happens.
 * The destructive nature of restore is handled by the UI layer, which opens
 * a ConfirmDialog in type-to-confirm mode (word: RESTAURER) BEFORE calling
 * handleRestoreBackup; this hook assumes that gate.
 */
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { useToast } from '../lib/useToast';
import type { TranslationDict } from '../i18n/translations';
import type { UserProfile } from '../lib/useAuth';
import { logAuditEvent } from '../lib/auditLogger';
import { supabase } from '../lib/supabaseClient';
import {
  backupFileName,
  exportBackup,
  parseBackupFile,
  restoreBackup,
  RESTORE_CONFIRM_WORD,
} from '../lib/backup';

export { RESTORE_CONFIRM_WORD };

export interface UseBackupDeps {
  t: TranslationDict;
  profile: UserProfile | null;
  isAdmin: boolean;
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>;
}

export function useBackup(deps: UseBackupDeps) {
  const { t, profile, isAdmin, toast } = deps;

  const [backupBusy, setBackupBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const auditUser = profile
    ? { id: profile.id, email: profile.email, full_name: profile.fullName, role: profile.role }
    : null;

  const assertAdmin = (): boolean => {
    if (!isAdmin) {
      toast.error(t.backupAdminOnly);
      return false;
    }
    return true;
  };

  /** Serialize the whole DB and download it as a versioned JSON snapshot. */
  const handleExportBackup = async (): Promise<void> => {
    if (!assertAdmin()) return;
    setBackupBusy(true);
    try {
      const snapshot = await exportBackup(supabase, profile?.email ?? null);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t.backupExportDone);
      void logAuditEvent({
        action: 'EXPORT_BACKUP',
        targetType: 'database',
        details: JSON.stringify({ file: backupFileName() }),
        user: auditUser,
      });
    } catch (err) {
      toast.error(`${t.backupExportFailed}: ${String(err)}`);
    } finally {
      setBackupBusy(false);
    }
  };

  /** Open the file picker for the restore wizard. */
  const openRestorePicker = (): void => {
    if (!assertAdmin()) return;
    fileInputRef.current?.click();
  };

  /**
   * File-input onChange: validate then restore. `confirmed` must be true —
   * the UI only calls this after the typed confirmation, as a belt-and-braces
   * check the hook enforces itself.
   */
  const handleRestoreFileSelected = async (
    e: ChangeEvent<HTMLInputElement>,
    confirmed: boolean,
  ): Promise<void> => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Reset so picking the same file again re-fires onChange.
    input.value = '';
    if (!assertAdmin()) return;
    if (!confirmed) return;
    if (!file) return;

    setBackupBusy(true);
    try {
      const parsed = await parseBackupFile(file);
      if ('errors' in parsed) {
        toast.error(parsed.errors.join(' '));
        return;
      }
      const result = await restoreBackup(supabase, parsed.snapshot);
      if (result.ok) {
        const total = Object.values(result.counts).reduce<number>((s, n) => s + (n ?? 0), 0);
        toast.success(t.backupRestoreDone.replace('{count}', String(total)));
        void logAuditEvent({
          action: 'RESTORE_BACKUP',
          targetType: 'database',
          details: JSON.stringify({ file: file.name, counts: result.counts }),
          user: auditUser,
        });
      } else {
        toast.error(`${t.backupRestoreFailed}: ${result.error ?? ''}`);
      }
    } catch (err) {
      toast.error(`${t.backupRestoreFailed}: ${String(err)}`);
    } finally {
      setBackupBusy(false);
    }
  };

  return {
    backupBusy,
    fileInputRef,
    handleExportBackup,
    openRestorePicker,
    handleRestoreFileSelected,
  };
}
