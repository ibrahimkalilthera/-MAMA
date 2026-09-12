// Tests for scripts/lib/e2e-writes.mjs — le garde-fou « une écriture de démo
// doit pouvoir être retrouvée ».
//
// Ce module juge du TEXTE, donc ses deux erreurs possibles sont symétriques :
// rater une écriture brute (faux vert) ou accuser du code correct (faux rouge).
// Les cas ci-dessous couvrent les deux, et surtout les trois indirections que le
// code RÉEL du dépôt utilise : le jeton porté par un symbole, la clé fournie par
// l'appelant d'une aide, et la prose qui parle des marqueurs sans les écrire.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  EXEMPTIONS,
  RECONCILIATION_MARKERS,
  auditAllowlist,
  findWrites,
  isStamped,
  judgeWrites,
  stampSymbols,
  touchesSupabase,
} from '../scripts/lib/e2e-writes.mjs';
import { readdirSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Une exemption, telle que la politique du dépôt en déclare. */
type Exemption = { file: string; maxCreates: number; reason: string };

/** Un fichier de script plausible : il touche la base partagée. */
const script = (body: string) => `import { replayableWrite } from './lib/transient-http.mjs';
const supabaseBase = process.env.VITE_SUPABASE_URL;
const TS = Date.now().toString().slice(-6);
const rawApi = (path, opts) => fetch(\`\${supabaseBase}\${path}\`, opts);
${body}
`;

const problems = (body: string, allowlist: Exemption[] = []) =>
  judgeWrites({ file: 'scripts/probe.mjs', source: script(body), allowlist }).problems;

describe('e2e-writes — le contrat d’une écriture de démo', () => {
  it('refuse une création brute : un rejeu après une réponse perdue doublerait la ligne', () => {
    const found = problems(`
      await rawApi('/rest/v1/staff', {
        method: 'POST',
        body: JSON.stringify({ name: 'E2E ' + TS }),
      });
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /sans enrobage rejouable/);
  });

  it('refuse une création enrobée qui ne saurait pas retrouver sa ligne', () => {
    const found = problems(`
      const row = { name: 'E2E ' + TS };
      await replayableWrite(() => rawApi('/rest/v1/staff', {
        method: 'POST',
        body: JSON.stringify(row),
      }));
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /clé de réconciliation/);
  });

  it('refuse une création enrobée dont la ligne ne porte aucun jeton de run', () => {
    const found = problems(`
      await replayableWrite(
        () => rawApi('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ name: 'E2E fixe' }) }),
        async () => {
          const probe = await rawApi('/rest/v1/staff?name=eq.E2E');
          return probe.ok ? { status: 201 } : null;
        },
      );
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /jeton d’exécution/);
  });

  it('accepte une création enrobée, sondée par requête, sur une ligne estampillée', () => {
    assert.deepEqual(problems(`
      await replayableWrite(
        () => rawApi('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ name: \`E2E \${TS}\` }) }),
        async () => {
          const probe = await rawApi(\`/rest/v1/staff?select=*&name=eq.\${encodeURIComponent('E2E')}\`);
          return probe.ok ? { status: 201 } : null;
        },
      );
    `), []);
  });

  it('résout le jeton porté par un SYMBOLE, pas seulement écrit sur place', () => {
    // Le vrai cas du dépôt : la ligne est construite ailleurs, et c'est la
    // CONSTANTE qui porte le jeton. Exiger le marqueur à chaque site obligerait
    // du code correct à le répéter partout.
    assert.deepEqual(problems(`
      const staffName = \`PreuveBureau \${Date.now().toString().slice(-5)}\`;
      await replayableWrite(
        () => rawApi('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ name: staffName }) }),
        async () => {
          const probe = await rawApi(\`/rest/v1/staff?name=eq.\${encodeURIComponent(staffName)}\`);
          return probe.ok ? { status: 201 } : null;
        },
      );
    `), []);
  });

  it('suit une aide jusque chez ses appelants — et nomme celui qui oublie la clé', () => {
    const shared = `
      const insertOnce = (table, row, find) => replayableWrite(
        () => rawApi(\`/rest/v1/\${table}\`, { method: 'POST', body: JSON.stringify(row) }),
        async () => {
          const probe = await rawApi(\`/rest/v1/\${table}?select=*&\${find}&limit=1\`);
          return probe.ok ? { status: 201 } : null;
        },
      );
      const demo = { email: \`e2e-\${TS}@audit.local\` };
    `;
    // Les DEUX appelants fournissent leur clé : l'aide est réconciliable.
    assert.deepEqual(problems(`${shared}
      await insertOnce('staff', demo, \`email=eq.\${encodeURIComponent(demo.email)}\`);
      await insertOnce('staff', demo, \`email=eq.\${encodeURIComponent(demo.email)}\`);
    `), []);

    // Un seul appel qui omet la clé rend l'aide fautive — et c'est CET appel
    // qui est nommé, pas la définition.
    const found = problems(`${shared}
      await insertOnce('staff', demo, \`email=eq.\${encodeURIComponent(demo.email)}\`);
      await insertOnce('staff', demo);
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /appelants de insertOnce/);
    assert.match(found[0], /insertOnce\('staff', demo\)/);
  });

  it('ne descend pas d’une aide : un site hors de son corps n’est pas « couvert » par elle', () => {
    // Sans test de contenance, le site 60 lignes plus bas hériterait des
    // appelants de l'aide et le contrôle deviendrait vert sans rien vérifier.
    const found = problems(`
      const insertOnce = (table, row, find) => replayableWrite(
        () => rawApi(\`/rest/v1/\${table}\`, { method: 'POST', body: JSON.stringify(row) }),
        async () => { const p = await rawApi(\`/rest/v1/\${table}?\${find}\`); return p.ok ? { status: 201 } : null; },
      );
      const demo = { email: \`e2e-\${TS}@audit.local\` };
      await insertOnce('staff', demo, 'email=eq.x');

      // hors de l'aide
      async function autre() {
        await rawApi('/rest/v1/students', { method: 'POST', body: JSON.stringify({ name: 'E2E ' + TS }) });
      }
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /sans enrobage rejouable/);
  });

  it('ne prend pas la PROSE pour du code : un commentaire qui cite la clé ne suffit pas', () => {
    // Le dépôt a payé trois fois cette erreur. Un commentaire qui explique
    // `email=eq.…` laissait passer un POST qui ne l'écrit nulle part.
    const found = problems(`
      // La clé de réconciliation serait \`email=eq.\${email}\`, mais ce POST
      // ne la construit pas : il ne sonde rien.
      await rawApi('/rest/v1/staff', {
        method: 'POST',
        body: JSON.stringify({ name: 'E2E ' + TS }),
      });
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /sans enrobage rejouable/);
  });

  it('ne compte pas une fonction RPC ni une réinitialisation comme une création', () => {
    assert.deepEqual(problems(`
      await rawApi('/rest/v1/rpc/reset_password', { method: 'POST', body: '{}' });
      await rawApi('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: 'CI-1@example.test' }) });
    `), []);
  });

  it('laisse tranquille un script qui ne parle pas à la base partagée', () => {
    const verdict = judgeWrites({
      file: 'scripts/github-probe.mjs',
      source: "await fetch('https://api.github.com/repos/x/y', { method: 'POST' });",
    });
    assert.deepEqual(verdict, { creates: 0, mutations: 0, problems: [], exempted: null });
  });
});

describe('e2e-writes — les exemptions sont bornées dans les DEUX sens', () => {
  const entry: Exemption[] = [{ file: 'scripts/probe.mjs', maxCreates: 1, reason: 'sondes de refus RLS' }];
  const probe = `
    await rawApi('/rest/v1/students', { method: 'POST', body: JSON.stringify({ name: 'sonde' }) });
  `;

  it('couvre exactement le nombre déclaré', () => {
    assert.deepEqual(problems(probe, entry), []);
  });

  it('refuse un site de plus que déclaré : migrez, ou élargissez en le justifiant', () => {
    const found = problems(`${probe}${probe}`, entry);
    assert.equal(found.length, 1);
    assert.match(found[0], /non rejouables alors que l'exemption en tolère 1/);
  });

  it('refuse une exemption devenue trop large : le réel a été corrigé, l’exemption doit descendre', () => {
    const found = problems('', entry);
    assert.equal(found.length, 1);
    assert.match(found[0], /il n'en reste que 0/);
  });

  it('refuse une exemption sans raison — une exemption muette est un trou', () => {
    const found = problems(probe, [{ file: 'scripts/probe.mjs', maxCreates: 1, reason: '  ' }]);
    assert.ok(found.some((p) => /exemption sans raison/.test(p)));
  });

  it('refuse une exemption qui nomme un script disparu', () => {
    const found = auditAllowlist({ allowlist: [{ file: 'scripts/parti.mjs' }], present: ['scripts/autre.mjs'] });
    assert.equal(found.length, 1);
    assert.match(found[0], /introuvable dans scripts\//);
  });
});

describe('e2e-writes — les briques', () => {
  it('trouve les écritures et distingue création et mutation', () => {
    const writes = findWrites(script(`
      await rawApi('/rest/v1/staff', { method: 'POST', body: '{}' });
      await rawApi('/rest/v1/staff?id=eq.1', { method: 'PATCH', body: '{}' });
      await rawApi('/rest/v1/staff?id=eq.1', { method: 'DELETE' });
    `));
    assert.deepEqual(writes.map((w) => w.kind), ['create', 'mutate', 'mutate']);
  });

  it('propage le jeton d’un symbole à ceux qui le citent', () => {
    const stamps = stampSymbols('const TS = Date.now().toString().slice(-6);\nconst NAME = `E2E ${TS}`;\n');
    assert.ok(stamps.has('TS'));
    assert.ok(stamps.has('NAME'));
    assert.ok(isStamped('name: NAME', stamps));
    assert.equal(isStamped('name: AUTRE', stamps), false);
  });

  it('reconnaît la clé REST (=eq.) et la clé GoTrue (?email=)', () => {
    assert.ok(RECONCILIATION_MARKERS.test('email=eq.${x}'));
    assert.ok(RECONCILIATION_MARKERS.test('/auth/v1/admin/users?email=a@b.c'));
    assert.equal(RECONCILIATION_MARKERS.test('email: EMAIL'), false);
  });

  it('reconnaît un jeton écrit : interpolation d’un jeton, ephemeralEmail, randomUUID', () => {
    const stamps = new Set(['TS']);
    assert.ok(isStamped('`probe-${TS}`', stamps));
    assert.ok(isStamped("ephemeralEmail('ci-probe')", new Set()));
    assert.ok(isStamped('randomUUID()', new Set()));
    assert.equal(isStamped("'nom fixe'", stamps), false);
  });

  it('ne prend pas une interpolation quelconque pour un jeton', () => {
    // `${supabaseBase}` construit une URL, pas une identité de run. Le compter
    // comme un jeton blanchissait toute écriture voisine d'un template — et
    // c'est exactement la façon dont ce contrôle serait devenu vert pour rien.
    assert.equal(isStamped('fetch(`${supabaseBase}/rest/v1/${path}`)', new Set(['TS'])), false);
    assert.equal(isStamped('const r = { status, body: await r.json() };', new Set(['TS'])), false);
  });

  it('préfère ne rien toucher d’un fichier qui ne parle pas à Supabase', () => {
    assert.equal(touchesSupabase('fetch("https://example.org", { method: "POST" })'), false);
    assert.ok(touchesSupabase('fetch(`${supabaseBase}/rest/v1/staff`)'));
  });
});

describe('e2e-writes — les scripts RÉELS du dépôt', () => {
  // Le cœur du garde-fou vit ici : la conformité des scripts qui écrivent
  // vraiment passe par une indirection (l'aide `insertOnce`, ou le nom de sonde
  // estampillé). Un cas synthétique ne la protégerait pas — c'est ce fichier-là
  // qui a coûté le doublon du 2026-09-12.
  for (const file of [
    'scripts/verify-pdf-download.mjs',
    'scripts/verify-anon-rls.mjs',
    'scripts/verify-desktop-app.mjs',
    'scripts/verify-csp-guard.mjs',
    'scripts/e2e-business.mjs',
  ]) {
    it(`${file} : chaque création est traçable`, () => {
      // La POLITIQUE réelle, pas une politique vide : jouer ces fichiers sans
      // leurs exemptions jugerait un dépôt qui n'existe pas.
      const verdict = judgeWrites({ file, source: readFileSync(join(root, file), 'utf8'), allowlist: EXEMPTIONS });
      assert.deepEqual(verdict.problems, [], verdict.problems.join('\n'));
      assert.ok(verdict.creates > 0, 'le fichier doit bien contenir des créations à juger');
    });
  }

  it('PREUVE PAR MUTATION : retirer la clé d’un seul appelant fait rougir le contrôle', () => {
    // Sans ce cas, tout ce qui précède pourrait être vert parce que le contrôle
    // ne juge rien. On retire la clé d'UN appel sur quatre — le dépôt n'a pas
    // changé, c'est le contrôle qu'on interroge.
    const file = 'scripts/verify-pdf-download.mjs';
    const real = readFileSync(join(root, file), 'utf8');
    const mutated = real.replace(
      'insertOnce(\'payments\', p, `receipt_number=eq.${encodeURIComponent(p.receipt_number)}`)',
      "insertOnce('payments', p)",
    );
    assert.notEqual(mutated, real, 'la mutation doit s’appliquer, sinon ce cas ne prouve rien');
    const found = judgeWrites({ file, source: mutated, allowlist: EXEMPTIONS }).problems;
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /appelants de insertOnce/);
    assert.match(found[0], /clé de réconciliation/);
    // Et le JETON est jugé sur sa NATURE, pas sur sa présence : une constante qui
    // ne vient plus d'une horloge ni d'un UUID n'est plus un jeton de run, et
    // toutes les lignes qui la citent redeviennent indiscernables.
    const unstamped = real.replace(
      'const TS = Date.now().toString().slice(-6);',
      "const TS = 'fixe';",
    );
    assert.notEqual(unstamped, real, 'la mutation doit s’appliquer');
    assert.ok(
      judgeWrites({ file, source: unstamped, allowlist: EXEMPTIONS }).problems.some((p) => /jeton d’exécution/.test(p)),
      'un payload sans jeton de run doit être refusé',
    );
  });

  it('aucune écriture ne passe par la couche qui RETENTE : la reprise doit sonder d’abord', () => {
    // C'est l'invariant qui rend les deux moitiés compatibles. Retenter une
    // écriture depuis le transport la reposterait SANS sonder — exactement le
    // doublon que `replayableWrite` existe pour empêcher. On nomme donc la brique
    // retentante de chaque script (celle liée à `withTransientRetry`) et on exige
    // qu'aucune écriture rejouable ne l'appelle.
    const scripts = [
      'scripts/verify-pdf-download.mjs',
      'scripts/verify-csp-guard.mjs',
      'scripts/e2e-business.mjs',
      'scripts/verify-desktop-app.mjs',
    ];
    /** Le premier argument d'un appel, virgule de premier niveau comprise. */
    const firstArgument = (text: string, open: number): string => {
      let depth = 0;
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
          depth -= 1;
          if (depth === 0) return text.slice(open + 1, i);
        } else if (text[i] === ',' && depth === 1) return text.slice(open + 1, i);
      }
      return text.slice(open + 1);
    };
    let checked = 0;
    let briques = 0;
    for (const file of scripts) {
      const src = readFileSync(join(root, file), 'utf8');
      // La brique retentante : une aide dont le CORPS appelle withTransientRetry
      // (`const api = … => withTransientRetry(…)`, `deleteOrGone`), quel que soit
      // l'enrobage — chercher une forme exacte raterait la moitié des scripts.
      const retrying = [...src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)]
        // Le CORPS de la déclaration — pas une fenêtre de caractères, qui
        // attraperait `withTransientRetry` dans la déclaration SUIVANTE.
        .map((m) => ({
          name: m[1],
          // Une déclaration de PREMIER niveau (colonne 0) marque la fin : une
          // ligne indentée appartient au corps, même si elle commence par `const`.
          body: src.slice(m.index ?? 0).split(/\r?\n(?=(?:const|let|var|function|async function|export)\b)/)[0],
        }))
        .filter(({ body }) => body.includes('withTransientRetry('))
        .map(({ name }) => name);
      briques += retrying.length;
      for (const match of src.matchAll(/replayableWrite\(/g)) {
        const open = (match.index ?? 0) + match[0].length - 1;
        const write = firstArgument(src, open);
        assert.ok(write.trim().length > 0, `${file} : une écriture rejouable doit exister`);
        for (const name of retrying) {
          assert.ok(
            !new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(write),
            `${file} : l’écriture rejouable passe par \`${name}()\`, qui retente sans sonder — elle doublerait la ligne`,
          );
        }
        checked += 1;
      }
    }
    assert.ok(checked >= 4, 'les scripts de la chaîne doivent bien porter des écritures rejouables à juger');
    assert.ok(briques >= 4, 'chaque script de la chaîne doit nommer sa brique retentante');
  });

  it('chaque exemption nomme un script qui EXISTE — sinon elle surveille un fantôme', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        const rel = relative(root, full).split(sep).join('/');
        return statSync(full).isDirectory() ? walk(full) : [rel];
      });
    const present = walk(join(root, 'scripts')).filter((f) => f.endsWith('.mjs'));
    assert.deepEqual(auditAllowlist({ allowlist: EXEMPTIONS, present }), []);
    assert.ok(EXEMPTIONS.length > 0, 'sans exemption déclarée, ce cas ne prouve rien');
  });
});
