/**
 * ─── Le montant d'un mois, DÉCIDÉ au guichet ────────────────────────────────
 *
 * La ligne « à régler pour ce mois » n'est plus un chiffre subi : l'économe,
 * l'admin ou le dev peut la FIXER. Ce composant est l'éditeur de cette
 * décision — un bouton discret tant que personne ne clique, puis un champ et
 * deux issues (enregistrer, renoncer).
 *
 * Il ne calcule rien et n'écrit rien lui-même : le montant en vigueur arrive en
 * prop (`due`), et l'écriture est `onSave`, qui rend `true` seulement quand la
 * base a accepté. Un refus laisse l'éditeur OUVERT avec la valeur saisie — on
 * ne referme pas sur un mensonge.
 *
 * Le brouillon part de la valeur RÉELLE (une décision antérieure comprise), pas
 * d'un zéro : le guichet corrige un montant, il ne le réinvente pas.
 */
import { useState } from 'react';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';

export interface PaymentMonthDueEditorProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  /** Le montant réellement en vigueur pour ce mois (décision ou part annuelle). */
  due: number;
  /** Écrit la décision ; `false` = refus (l'éditeur reste ouvert). */
  onSave: (amount: number) => Promise<boolean>;
}

export function PaymentMonthDueEditor({ t, currentTheme, due, onSave }: PaymentMonthDueEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const value = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0;

  const save = async () => {
    if (saving || !valid) return;
    setSaving(true);
    const written = await onSave(value);
    setSaving(false);
    if (written) setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        data-slot="payment-month-due-edit"
        onClick={() => {
          setDraft(String(due));
          setEditing(true);
        }}
        className={`text-2xs font-bold underline decoration-dotted ${currentTheme.muted} hover:opacity-80 transition-all`}
      >
        {t.monthDueEdit}
      </button>
    );
  }

  return (
    <div className="space-y-2" data-slot="payment-month-due-editor">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className={`block text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.monthDueLabel}</span>
          <input
            type="number"
            min="0"
            step="1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`w-40 px-4 py-2 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-xl focus:outline-none ${currentTheme.accentRing} text-sm font-semibold ${currentTheme.inkStrong}`}
          />
        </label>
        <button
          type="button"
          data-slot="payment-month-due-save"
          disabled={saving || !valid}
          onClick={() => { void save(); }}
          className={`px-4 py-2 rounded-xl border text-xs font-black transition-all ${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.inkStrong} ${currentTheme.rowHover} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {t.monthDueSave}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setEditing(false)}
          className={`px-4 py-2 rounded-xl border text-xs font-bold transition-all ${currentTheme.border} ${currentTheme.muted} disabled:opacity-50`}
        >
          {t.cancel}
        </button>
      </div>
      <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{t.monthDueHint}</p>
    </div>
  );
}
