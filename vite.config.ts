import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
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
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'motion', 'lucide-react'],
            'vendor-supabase': ['@supabase/supabase-js'],
          },
        },
      },
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
