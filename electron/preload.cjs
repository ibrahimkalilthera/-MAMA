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
    /**
     * Relancer une vérification / un téléchargement.
     *
     * Existe pour un seul cas, et il compte : une mise à jour OBLIGATOIRE dont
     * le téléchargement a échoué. Sans ce canal, le remède affiché à l'écran
     * serait d'attendre l'intervalle suivant (30 min) — c'est-à-dire, du point
     * de vue de l'utilisateur bloqué devant son poste, aucun remède. Canal nommé
     * et sans arguments, comme les trois autres : aucune surface générique.
     */
    retry: () => ipcRenderer.invoke('updates:check-now'),
    /**
     * Le journal local du poste : les blocages inscrits sur CETTE machine.
     *
     * Exposé pour une raison précise : quand le poste est bloqué et qu'aucune
     * session n'existe, l'envoi au journal d'audit est impossible — le journal
     * local est alors le SEUL canal, et il faut pouvoir le lire à l'écran pour
     * le recopier. Lecture seule, bornée à 20 entrées.
     */
    journal: () => ipcRenderer.invoke('updates:journal'),
    /**
     * Ouvrir le journal dans l'explorateur (le fichier est créé s'il n'existe
     * pas encore) : un administrateur devant le poste doit pouvoir le récupérer
     * sans ligne de commande, et un fichier introuvable serait un cul-de-sac.
     */
    openJournal: () => ipcRenderer.invoke('updates:open-journal'),
  },
});