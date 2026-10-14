/**
 * Classes & sections configuration section — extracted verbatim from
 * SettingsView so the view stays under the line budget. Reads its data and
 * actions through the MainViewsContext.
 */
import { Edit2, Layers, Plus, Trash2 } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function SettingsClassesCard() {
  const { t, currentTheme, availableClasses, setShowAddClassModal, openEditClass, handleDeleteClass } = useMainViews();

  return (
    <>
                {/* Classes & Sections Configuration Card */}
                <div data-slot="settings-classes" className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.inkStrong} flex items-center gap-2`}>
                        <Layers size={20} className="text-blue-500" />
                        {t.classesGradeLevelsManagement}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {t.addSections1a1b1c1d2a7bOrCustomGradesAcrossSchoolCycles}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAddClassModal(true)}
                      className={`px-4 py-2.5 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95`}
                    >
                      <Plus size={14} />
                      <span>{t.addClassSection}</span>
                    </button>
                  </div>

                  <div className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.surfaceInset} space-y-4`}>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-2xs font-black uppercase tracking-widest text-slate-400">
                          {t.firstCycle1stTo6thYear}
                        </p>
                        <span className="text-2xs font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle1').length} {t.classesWord}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-2xs text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className={`ml-1 p-0.5 rounded-md ${currentTheme.hoverAccent} text-slate-400 transition-all`}
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className={`p-0.5 rounded-md ${currentTheme.hoverAlert} text-slate-400 transition-all`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-2xs font-black uppercase tracking-widest text-slate-400">
                          {t.secondCycle7thTo9thYear}
                        </p>
                        <span className="text-2xs font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle2').length} {t.classesWord}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-2xs text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className={`ml-1 p-0.5 rounded-md ${currentTheme.hoverAccent} text-slate-400 transition-all`}
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className={`p-0.5 rounded-md ${currentTheme.hoverAlert} text-slate-400 transition-all`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                      <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-2xs font-black uppercase tracking-widest text-slate-400">
                            {t.otherCustomClasses2}
                          </p>
                          <span className="text-2xs font-bold text-slate-400">
                            {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                            <span key={c.id} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 shadow-sm flex items-center gap-1.5">
                              <span>{c.id}</span>
                              {c.isCustom && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditClass(c)}
                                    title={t.renameClass}
                                    className={`ml-1 p-0.5 rounded-md ${currentTheme.hoverAccent} text-blue-400 transition-all`}
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClass(c)}
                                    title={t.deleteClass}
                                    className={`p-0.5 rounded-md ${currentTheme.hoverAlert} text-blue-400 transition-all`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

    </>
  );
}
