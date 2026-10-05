/**
 * Localisation & Préférences card (language, currency, theme selection, logo) —
 * extracted verbatim from SettingsView so the view stays under the line budget.
 * Reads its data and actions through the MainViewsContext.
 */
import { AlignJustify, Check, DollarSign, Globe, UploadCloud } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { useDensity } from '../app/densityContext';
import type { ThemeOption } from '../app/mainViewsProps';

export function SettingsPreferencesCard() {
  const {
    t, lang, currentTheme, theme, setTheme, toggleLanguage, schoolLogo, setSchoolLogo,
    logoColor, setLogoColor, logoInputRef, handleLogoUpload,
  } = useMainViews();
  const { density, setDensity } = useDensity();

  return (
    <>
                <div data-slot="settings-system-language" className={`flex items-center justify-between p-6 ${currentTheme.surfaceInset} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-blue-600 shadow-sm`}>
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>{t.systemLanguage}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.changeTheInterfaceLanguage}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
                    className={`px-6 py-2 ${currentTheme.card} border ${currentTheme.border} rounded-xl text-sm font-bold ${currentTheme.inkStrong} hover:bg-slate-50 transition-all`}
                  >
                    {t.english}
                  </button>
                </div>

                <div data-slot="settings-currency-format" className={`flex items-center justify-between p-6 ${currentTheme.surfaceInset} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-emerald-600 shadow-sm`}>
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>{t.currencyFormat}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.current} {t.currency}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.currency}</span>
                </div>

                <div data-slot="settings-table-density" className={`flex items-center justify-between p-6 ${currentTheme.surfaceInset} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-blue-600 shadow-sm`}>
                      <AlignJustify size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>{t.densityMode}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.densityHint}</p>
                    </div>
                  </div>
                  <div role="group" aria-label={t.densityMode} className={`inline-flex p-1 rounded-xl ${currentTheme.card} border ${currentTheme.border}`}>
                    {([['comfort', t.densityComfort], ['compact', t.densityCompact]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={density === value}
                        onClick={() => setDensity(value)}
                        className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${
                          density === value
                            ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentShadow}`
                            : `${currentTheme.muted} ${currentTheme.accentSoftHover}`
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Theme Selection */}
                <div data-slot="settings-theme-settings" className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.themeSettings}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {([
                      { id: 'navy', label: t.corporateNavy, color: 'bg-[#0f172a]' },
                      { id: 'emerald', label: t.emeraldGreen, color: 'bg-[#064E3B]' },
                      { id: 'cream', label: t.warmCreamLedger, color: 'bg-[#FDFBF7]' },
                      { id: 'bordeaux', label: t.bordeauxRed, color: 'bg-[#881337]' },
                      { id: 'slate', label: t.slateSlate, color: 'bg-[#1E293B]' },
                      { id: 'midnight', label: t.midnightDark, color: 'bg-[#030712]' }
                    ] as ThemeOption[]).map((tOption) => (
                      <button
                        key={tOption.id}
                        onClick={() => setTheme(tOption.id)}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                          theme === tOption.id
                            ? `${currentTheme.accentBorder} ${currentTheme.accentSoft} shadow-md`
                            : `${currentTheme.border} ${currentTheme.rowHover}`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${tOption.color} border border-slate-200 shadow-inner flex items-center justify-center`}>
                          {theme === tOption.id && <Check size={14} className={`flex-shrink-0 ${tOption.id === 'cream' ? 'text-slate-800' : 'text-white'}`} />}
                        </div>
                        <span className={`text-xs font-bold ${currentTheme.inkStrong} text-center`}>{tOption.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo Upload */}
                <div data-slot="settings-upload-logo" className={`space-y-4 pt-4 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.uploadLogo}</h4>
                  <div className="flex items-center gap-6">
                    <div
                      onClick={() => logoInputRef.current?.click()}
                      className={`w-24 h-24 rounded-3xl border-2 border-dashed ${currentTheme.border} flex flex-col items-center justify-center cursor-pointer ${currentTheme.accentBorderHover} transition-all overflow-hidden relative group`}
                    >
                      {schoolLogo ? (
                        <>
                          <img src={schoolLogo} alt="Logo" className="w-full h-full object-contain p-2" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <UploadCloud size={20} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={24} className={currentTheme.muted} />
                          <span className={`text-2xs ${currentTheme.muted} mt-2 font-bold`}>{t.upload}</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${currentTheme.inkStrong}`}>{t.logoAccentColor}</p>
                      <p className={`text-xs ${currentTheme.muted} mb-4`}>{t.headerSync}</p>
                      {logoColor && (
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-lg border border-white/20 shadow-sm"
                            style={{ backgroundColor: logoColor }}
                          />
                          <span className={`text-xs font-mono font-bold ${currentTheme.muted}`}>{logoColor.toUpperCase()}</span>
                          <button
                            onClick={() => { setSchoolLogo(null); setLogoColor(null); }}
                            className="text-xs text-rose-500 font-bold hover:underline"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="file"
                    ref={logoInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>

    </>
  );
}
