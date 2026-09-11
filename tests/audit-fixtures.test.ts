// Suite for scripts/lib/audit-fixtures.mjs — the hermetic backend behind the
// theme contrast audit.
//
// What it locks, and why each assertion exists:
//   • the router answers the three real client contracts (password grant, user,
//     PostgREST table reads — including the `object+json` shape `.single()`
//     needs, which errors on anything else);
//   • an unknown route is a LOUD 501, never an empty 200: a surface that lost
//     its backend must fail the audit, not scan fewer texts and stay green;
//   • the fixture host is not a real domain, so an un-intercepted request can
//     only fail — it can never reach production;
//   • every table the app queries has fixture rows (derived from src/, so a new
//     table in the app fails HERE instead of silently emptying a view);
//   • the CI job and the audit script carry no secret any more — that is the
//     whole point of the fixture backend, and it must not come back.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  FIXTURE_URL,
  FIXTURE_TABLE_NAMES,
  FIXTURE_TABLES,
  FIXTURE_ACADEMIC_YEAR,
  FIXTURE_USER,
  fixtureRoute,
  fixtureSession,
  isFixtureUrl,
} = await import('../scripts/lib/audit-fixtures.mjs');

const route = (over: Record<string, string> = {}) =>
  fixtureRoute({ method: 'GET', pathname: '/', accept: '', ...over });

describe('audit-fixtures — routage', () => {
  it('le grant mot de passe renvoie une session complète, non expirée', () => {
    const r = route({ method: 'POST', pathname: '/auth/v1/token', search: '?grant_type=password' });
    assert.equal(r.status, 200);
    const s = JSON.parse(r.body);
    assert.equal(s.token_type, 'bearer');
    assert.ok(s.access_token && s.refresh_token, 'access_token et refresh_token requis');
    assert.ok(s.expires_at > Math.floor(Date.now() / 1000), 'la session doit être valide');
    assert.equal(s.user.id, FIXTURE_USER.id);
    assert.equal(s.user.user_metadata.role, 'admin');
  });

  it('renvoie un profil admin (la coquille complète est rendue)', () => {
    const r = route({ pathname: '/rest/v1/user_profiles', accept: 'application/vnd.pgrst.object+json' });
    assert.equal(r.status, 200);
    const p = JSON.parse(r.body);
    assert.equal(p.role, 'admin');
    assert.ok(!Array.isArray(p), '.single() exige un objet, pas un tableau');
  });

  it('sert chaque table en tableau, et la Première ligne en mode objet', () => {
    for (const table of FIXTURE_TABLE_NAMES) {
      const list = route({ pathname: `/rest/v1/${table}` });
      assert.equal(list.status, 200, table);
      const rows = JSON.parse(list.body);
      assert.ok(Array.isArray(rows) && rows.length > 0, `${table} doit avoir au moins une ligne`);
      const single = route({ pathname: `/rest/v1/${table}`, accept: 'application/vnd.pgrst.object+json' });
      assert.equal(single.status, 200, table);
      assert.ok(!Array.isArray(JSON.parse(single.body)), table);
    }
  });

  it('répond aux écritures sans planter (l\'audit ne fait que lire)', () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const r = route({ method, pathname: '/rest/v1/todos' });
      assert.ok(r.status === 201 || r.status === 204, `${method} → ${r.status}`);
    }
    assert.equal(JSON.parse(route({ method: 'POST', pathname: '/rest/v1/rpc/admin_set_user_password' }).body), true);
  });

  it('répond 501 — jamais un 200 vide — sur une table ou une route inconnue', () => {
    const t = route({ pathname: '/rest/v1/table_qui_nexiste_pas' });
    assert.equal(t.status, 501);
    assert.equal(JSON.parse(t.body).table, 'table_qui_nexiste_pas');
    const p = route({ pathname: '/edge-function/inconnue' });
    assert.equal(p.status, 501);
  });

  it('ne cible pas un domaine réel, et ne route que le sien', () => {
    assert.match(new URL(FIXTURE_URL).hostname, /\.invalid$/, 'le domaine doit être réservé');
    assert.ok(isFixtureUrl(`${FIXTURE_URL}/rest/v1/students`));
    assert.ok(!isFixtureUrl('https://rpcjdohfxwukbqngbprw.supabase.co/rest/v1/students'));
    assert.ok(!isFixtureUrl('http://127.0.0.1:4173/'));
    assert.ok(!isFixtureUrl('pas une url'));
  });

  it('est déterministe : deux appels donnent le même contenu', () => {
    const a = route({ pathname: '/rest/v1/students' }).body;
    const b = route({ pathname: '/rest/v1/students' }).body;
    assert.equal(a, b);
    // Seule la date d'expiration suit l'horloge (les deux parts doivent rester
    // identiques, sinon l'audit mesurerait un jour un contenu différent).
    assert.deepEqual({ ...fixtureSession(1_000_000) }, { ...fixtureSession(1_000_000) });
  });
});

const collectSources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

// The dataset is only "real content" if the APP keeps it. Every year-filtered
// view drops a row whose academicYear differs from selectedYear, so a fixture
// year that no longer matches the app's default turns whole surfaces empty while
// the audit keeps reporting green — which is exactly what happened: every row was
// 2025-2026, the app opens on 2026-2027, the Élèves table rendered zero rows and
// "Fiche Élève" was reported "non applicable (aucun déclencheur)" in all six
// themes. These assertions pin the two together so the drift can only happen as
// a red test.
describe('audit-fixtures — année scolaire', () => {
  const provider = readFileSync(join(root, 'src/app/YearProvider.tsx'), 'utf8');
  const appDefault = provider.match(/useState<string>\('(\d{4}-\d{4})'\)/)?.[1];
  const fixtureSource = readFileSync(join(root, 'scripts/lib/audit-fixtures.mjs'), 'utf8');
  const auditSource = readFileSync(join(root, 'scripts/theme-contrast-audit.mjs'), 'utf8');

  it('le jeu de données porte l’année sur laquelle l’app s’ouvre', () => {
    assert.ok(appDefault, 'année par défaut introuvable dans YearProvider.tsx — le test doit être mis à jour, pas supprimé');
    assert.equal(
      FIXTURE_ACADEMIC_YEAR,
      appDefault,
      'FIXTURE_ACADEMIC_YEAR doit suivre YearProvider : sinon les vues filtrées par année se vident en silence',
    );
  });

  it('aucune ligne de fixture ne porte une année en dur', () => {
    const literals = [...fixtureSource.matchAll(/\b(?:academic_year|year):\s*'(\d{4}-\d{4})'/g)].map((m) => m[1]);
    assert.deepEqual(literals, [], `années écrites en dur (elles doivent passer par FIXTURE_ACADEMIC_YEAR) : ${literals.join(', ')}`);
  });

  it('les élèves de fixture survivent au filtre d’année de la vue Élèves', () => {
    const kept = FIXTURE_TABLES.students.filter(
      (s) => !s.academic_year || s.academic_year === FIXTURE_ACADEMIC_YEAR,
    );
    assert.ok(
      kept.length > 0,
      'aucun élève ne passerait le filtre `!selectedYear || academicYear === selectedYear` — la fiche élève ne serait pas mesurée',
    );
  });

  it('la fiche élève ne peut plus être sautée en silence', () => {
    const step = auditSource.slice(auditSource.indexOf("openOverlay(theme, 'Fiche Élève'"), auditSource.indexOf("// Relance parent modal"));
    assert.ok(step.length > 0, 'l’étape Fiche Élève a disparu de l’audit');
    assert.match(step, /aucune ligne élève/, 'une table vide doit ÉCHOUER l’étape, pas la déclarer non applicable');
    assert.doesNotMatch(
      step,
      /catch\s*\{[\s\S]{0,120}return null/,
      'cette surface est une couverture requise : plus de sortie silencieuse quand les données manquent',
    );
    assert.match(step, /div\.cursor-pointer/, 'le déclencheur (cellule nom/avatar) doit rester explicite');
  });
});

describe('audit-fixtures — couverture et absence de secret', () => {
  it('chaque table interrogée par src/ a des lignes fixtures', () => {
    const queried = new Set<string>();
    for (const file of collectSources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)) queried.add(m[1]);
    }
    assert.ok(queried.size > 0, 'aucune table détectée — le scan est cassé');
    const missing = [...queried].filter((t) => !FIXTURE_TABLE_NAMES.includes(t));
    assert.deepEqual(
      missing,
      [],
      `tables interrogées sans fixture (elles rendraient vide, et l'audit scannerait moins de textes) : ${missing.join(', ')}`,
    );
  });

  it('ni le job CI de contraste ni le script ne portent un secret', () => {
    const workflow = readFileSync(join(root, '.github/workflows/perf-guard.yml'), 'utf8');
    assert.ok(
      !workflow.includes('secrets.'),
      'perf-guard.yml ne doit référencer aucun secret : sinon le gate saute sur les PR Dependabot',
    );
    const audit = readFileSync(join(root, 'scripts/theme-contrast-audit.mjs'), 'utf8');
    assert.ok(
      !audit.includes('SERVICE_ROLE'),
      'le compte éphémère par clé service-role ne doit pas revenir dans l\'audit',
    );
    // The audit step must not be gated on credentials any more — a skipped step
    // is exactly the failure mode this backend removed.
    const auditStep = workflow.slice(workflow.indexOf('Theme contrast audit'));
    assert.ok(!auditStep.includes('if:'), 'l\'étape d\'audit ne doit plus être conditionnelle');
  });
});
