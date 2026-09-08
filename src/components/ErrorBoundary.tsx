/**
 * ErrorBoundary — filet de sécurité React autour des zones lazy de l'app.
 *
 * Sans lui, un crash pendant le rendu d'un chunk chargé paresseusement
 * (MainViews, AppModals, ArchivesView, les hôtes de modals Excel/Bordereau…)
 * démonte TOUT l'arbre React → écran blanc silencieux, sans message ni moyen
 * de reprise. C'est exactement le mécanisme du bug « clic sur Importer Excel →
 * page vide » : un module lazy qui jette au rendu, sous un `Suspense
 * fallback={null}` sans garde-fou.
 *
 * Ce composant capture l'erreur au niveau de SA zone (jamais plus haut — un
 * crash dans une modal n'éteint pas la page, et inversement), la logue
 * TOUJOURS dans la console (le débogage n'est jamais masqué) et affiche une
 * carte d'erreur stylée avec le thème courant + un bouton « Recharger »
 * (window.location.reload). Un bouton « Réessayer » remonte le sous-arbre
 * fautif localement quand l'erreur est transitoire.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  /** Theme tokens from the app theme engine (card, border, muted, isDark). */
  currentTheme: {
    card: string;
    border: string;
    muted: string;
    isDark: boolean;
  };
  children: ReactNode;
  /** Short label of the guarded zone, e.g. « la vue » / « cette fenêtre ». */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The error is ALWAYS logged — the UI fallback never hides the console.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { currentTheme, label } = this.props;
    return (
      <div role="alert" className="w-full p-6 flex items-center justify-center">
        <div className={`relative w-full max-w-md ${currentTheme.card} p-6 rounded-3xl border ${currentTheme.border} shadow-2xl space-y-4`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-rose-500/10 text-rose-600">
              <AlertTriangle size={20} />
            </div>
            <h3 className={`text-sm font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
              {label ? `Une erreur est survenue dans ${label}` : 'Une erreur est survenue'}
            </h3>
          </div>
          <p className={`text-xs font-semibold leading-relaxed ${currentTheme.muted}`}>
            Quelque chose a planté dans cette zone. L&apos;erreur a été enregistrée dans la
            console (touche F12) pour le débogage — rechargez la page pour repartir.
          </p>
          {error.message ? (
            <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-words p-3 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-rose-300' : 'bg-slate-50 text-rose-600'}`}>
              {error.message}
            </pre>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRetry}
              className="h-11 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.97]"
            >
              <RotateCcw size={14} />
              Réessayer
            </button>
            <button
              onClick={this.handleReload}
              className={`h-11 px-4 rounded-2xl border ${currentTheme.border} text-xs font-bold ${currentTheme.isDark ? 'text-white' : 'text-slate-700'} hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center gap-2`}
            >
              <RefreshCw size={14} />
              Recharger
            </button>
          </div>
        </div>
      </div>
    );
  }
}