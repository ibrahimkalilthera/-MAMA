/**
 * Re-write every `[data-i18n]` node in the active language.
 *
 * Extracted from src/App.tsx (split campaign, no behaviour change): the language
 * state itself stays in the component; this is only the DOM sweep that follows
 * it. The `setTimeout(…, 0)` is deliberate — it runs AFTER React has committed
 * the re-render, so the sweep sees the final DOM and does not race the render.
 * A key with no translation is left untouched rather than blanked.
 */
import { translations } from '../i18n/translations';
import type { Language } from './types';

export function applyLanguage(lang: Language): void {
  setTimeout(() => {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        const text = translations[lang][key as keyof typeof translations['en']];
        if (text) {
          el.textContent = text;
        }
      }
    });
  }, 0);
}
