import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {readFileSync} from 'node:fs';
import {defineConfig, loadEnv} from 'vite';
import {buildStamp} from './scripts/lib/build-stamp.mjs';
import {declaredPolicies, policyWithLocalStack} from './scripts/lib/csp-origins.mjs';
import {electronCspMetaPlugin} from './scripts/lib/electron-csp-meta.mjs';
import {serviceWorkerPlugin} from './scripts/lib/service-worker.mjs';
import {devRuntimeBanner} from './scripts/lib/runtime-banner.mjs';

/**
 * La politique CSP du dépôt, LUE à sa source (`vercel.json`) : jamais recopiée.
 *
 * Un second exemplaire finirait par s'écarter du servi, et c'est précisément ce
 * que la garde CSP juge. Deux valeurs déclarées seraient un choix silencieux :
 * on refuse plutôt que d'en servir une au hasard.
 */
function repoCsp(): string {
  const json = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const values = declaredPolicies(json);
  if (values.length !== 1) {
    throw new Error(
      `vercel.json doit déclarer UNE seule politique Content-Security-Policy (${values.length} lue(s)) — ` +
        'le serveur d\u2019aperçu local ne peut pas choisir à votre place.',
    );
  }
  return values[0];
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // La pile de recette (`pdf-e2e.yml`) fait tourner l'application sur SA PROPRE
  // base locale. Or la politique servie nomme la base de l'ÉCOLE : le navigateur
  // refuserait chaque requête, et une garde CSP qui lit des violations ne
  // mesurerait plus rien (une page sans politique ne peut pas violer). On sert
  // donc ici la politique du dépôt étendue à l'origine locale — la seule
  // dérivation admise, faite par `policyWithLocalStack` — et SEULEMENT quand
  // cette origine est demandée : aucun autre usage de `vite preview` ne change.
  const localStackOrigin = (process.env.MAMA_LOCAL_SUPABASE_ORIGIN || '').trim();
  const previewHeaders = localStackOrigin
    ? {'Content-Security-Policy': policyWithLocalStack(repoCsp(), localStackOrigin)}
    : undefined;
  return {
    // `devRuntimeBanner` prints, at server start, which runtime is serving and
    // warns when another Node major is present in the environment (a mismatch
    // never fails here — it fails in CI, on a bundle built by another runtime).
    // `buildStamp` écrit dans le HTML le commit dont il vient : sans cette
    // identité, la CI ne peut pas distinguer « la prod sert le build que je
    // viens de publier » d'« elle sert encore le précédent », et un pixel-check
    // jugerait alors un autre commit que le sien.
    //
    // `serviceWorkerPlugin()` écrit `dist/sw.js` à la fin du bundle : c'est ce qui
    // rend le SITE ouvrable à froid sans réseau (le poste installé, lui, charge
    // son interface depuis le disque — voir son en-tête).
    //
    // `electronCspMetaPlugin()` n'agit QUE sur le build de bureau
    // (`--outDir electron-ui-dist`) : il écrit la politique du poste
    // (`electron/csp-policy.cjs`) dans le `<head>` de l'artefact, pour que
    // l'installeur porte son verrou même si le câblage d'exécution disparaissait.
    // Le site servi garde la sienne, en en-tête (`vercel.json`).
    plugins: [react(), tailwindcss(), devRuntimeBanner(), buildStamp(), serviceWorkerPlugin(), electronCspMetaPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Rolldown (Vite ≥ 8) only accepts manualChunks as a function.
          manualChunks(id) {
            if (id.includes('/node_modules/react') || id.includes('/node_modules/react-dom') || id.includes('/node_modules/motion') || id.includes('/node_modules/lucide-react')) {
              return 'vendor-react';
            }
            if (id.includes('/node_modules/@supabase')) {
              return 'vendor-supabase';
            }
          },
        },
      },
    },
    preview: {
      headers: previewHeaders,
    },
    server: {
      // Dev server binds 0.0.0.0 for remote demos over tunnels. Instead of
      // `allowedHosts: true` (any Host header accepted — DNS-rebinding lax),
      // accept only known tunnel suffixes plus the usual dev hosts (Vite
      // always allows localhost and IP literals regardless of this list).
      // Add another tunnel provider via TUNNEL_HOSTS="a.com,b.com" in the env.
      allowedHosts: env.TUNNEL_HOSTS
        ? env.TUNNEL_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
        : ['.loca.lt', '.ngrok-free.app', '.ngrok.io', '.trycloudflare.com'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
