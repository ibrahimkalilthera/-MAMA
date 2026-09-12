// ─────────────────────────────────────────────────────────────────────────────
// electron/preload.cjs — minimal bridge exposed to the renderer.
//
// contextIsolation is ON and nodeIntegration is OFF (see main.cjs); the app
// itself runs entirely inside the web page and talks to Supabase over HTTPS,
// so only a tiny, read-only surface is exposed here.
// ─────────────────────────────────────────────────────────────────────────────
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // ── Mises à jour ──────────────────────────────────────────────────────────
  // L'interface doit pouvoir MONTRER qu'une version attend d'être installée :
  // une boîte de dialogue fermée ne revient pas, et une application ouverte
  // toute la journée n'affichait jusqu'ici que « rien ». Surface volontairement
  // minuscule — lire l'état, s'abonner, demander l'installation — et aucune
  // fonction générique côté main (pas d'`invoke` arbitraire depuis le renderer).
  updates: {
    /**
     * L'état courant (au cas où le bandeau se monte après l'événement).
     * @returns {Promise<object>}
     */
    getState: () => ipcRenderer.invoke('updates:get-state'),
    /**
     * S'abonner aux changements d'état. Rend une fonction de désabonnement.
     * @param {(state: object) => void} onChange
     * @returns {() => void}
     */
    onState: (onChange) => {
      const handler = (_event, state) => onChange(state);
      ipcRenderer.on('updates:state', handler);
      return () => ipcRenderer.removeListener('updates:state', handler);
    },
    /** Demande l'installation (redémarrage) ou ouvre la page de téléchargement. */
    install: () => ipcRenderer.invoke('updates:install'),
  },
});