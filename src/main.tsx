import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// Load the app asynchronously so a missing/invalid Supabase configuration
// (thrown by supabaseClient.ts at module load) can be caught and rendered
// as a friendly configuration screen instead of a blank white page.
import('./App.tsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    root.render(<ConfigErrorScreen message={message} />);
  });

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0f172a',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: '#fff',
          borderRadius: 24,
          padding: 32,
          boxShadow: '0 20px 60px rgba(0,0,0,.35)',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ margin: '0 0 8px', fontSize: 20, color: '#0f172a' }}>
          Configuration manquante / Missing configuration
        </h1>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#475569', lineHeight: 1.6 }}>
          L'application ne peut pas démarrer : les variables d'environnement Supabase
          (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) sont absentes ou invalides.
          <br />
          The app cannot start: the Supabase environment variables are missing or invalid.
        </p>
        <pre
          style={{
            background: '#f1f5f9',
            borderRadius: 12,
            padding: 12,
            fontSize: 12,
            color: '#b91c1c',
            overflowX: 'auto',
            margin: '0 0 16px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#064E3B',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Réessayer / Retry
        </button>
      </div>
    </div>
  );
}
