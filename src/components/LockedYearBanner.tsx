/**
 * Locked academic-year banner — extracted verbatim from App.tsx. Shown when
 * the selected year is in the locked list (read-only mode).
 */
import { Lock } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';

export interface LockedYearBannerProps {
  t: TranslationDict;
  show: boolean;
}

export function LockedYearBanner({ t, show }: LockedYearBannerProps) {
  if (!show) return null;
  return (
    <div className="mb-8 flex items-center justify-between p-6 bg-rose-50 border border-rose-200 rounded-3xl text-rose-800 shadow-sm no-print">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-rose-100 rounded-2xl text-rose-600">
          <Lock size={24} />
        </div>
        <div>
          <p className="font-extrabold text-lg">
            {t.academicYearLocked}
          </p>
          <p className="text-xs opacity-90">
            {t.thisAcademicYearHasBeenClosedAndArchivedAllRecordsAreCurrentlyInReadOnlyMode}
          </p>
        </div>
      </div>
      <span className="px-4 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black uppercase tracking-wider">
        {t.readOnly}
      </span>
    </div>
  );
}
