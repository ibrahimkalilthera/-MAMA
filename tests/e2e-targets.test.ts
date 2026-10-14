// Tests for scripts/lib/e2e-target.mjs — « un contrôle n'a rien à écrire chez
// le client », exécutable.
//
// Le contrôle juge du TEXTE (des workflows YAML), donc ses deux erreurs
// possibles sont symétriques et aussi coûteuses l'une que l'autre : rater un
// job qui repoionte la base partagée (faux vert), ou accuser un job juste
// (faux rouge — et un faux rouge apprend à éteindre le contrôle). Les cas
// ci-dessous couvrent les deux, et surtout les trois pièges du format :
// la PROSE qui cite la règle, le commentaire qui décrit une pile que le job ne
// monte pas, et la commande qui vit dans un `run: |` multiligne ou derrière un
// `&&`. Les cas « dépôt réel » jouent les VRAIS fichiers : c'est là que la
// règle vaut, et c'est ce qui empêche la suite d'être verte pour rien.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  E2E_DRIVERS,
  E2E_TARGET_RULES,
  EXCEPTIONS,
  PRODUCTION_PROBES,
  READ_ONLY_INVOCATIONS,
  auditClassification,
  auditExceptions,
  auditReadOnlyDeclarations,
  formatE2eTargetReport,
  hostedSupabaseHosts,
  judgeWorkflow,
  readOnlyExcuse,
  scriptInvocations,
  scriptOf,
  targetSecrets,
  violationsOf,
} from '../scripts/lib/e2e-target.mjs';
// Le blanchiment de la prose des workflows est celui de la couche partagée :
// c'est ce qui prouve la cécité à la prose dans l'inventaire d'immunité.
import { maskYamlComments } from '../scripts/lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = '.github/workflows';

const isDriver = (script: string) => E2E_DRIVERS.some((e) => e.script === script);
const isProbe = (script: string) => PRODUCTION_PROBES.some((e) => e.script === script);

const judge = (text: string, file = `${WORKFLOWS}/probe.yml`) =>
  judgeWorkflow({ file, text, scripts: {}, isDriver, isProbe });

const workflow = (body: string) => `name: sonde\non:\n  push:\n\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;

/** Un job CONFORME : sa pile, ses clés éphémères, le garde, et le pilotage local. */
const CONFORMING = workflow(`      - name: Élever la pile
        run: supabase start
      - name: Exporter les clés
        run: |
          supabase status -o env > /tmp/recette.env
          echo "VITE_SUPABASE_URL=$API_URL" >> "$GITHUB_ENV"
      - name: Garde de recette
        run: npm run check:recette-base
      - name: Cycles métier
        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/
`);

const realWorkflow = (name: string) => readFileSync(join(root, WORKFLOWS, name), 'utf8');
const realWorkflows = () =>
  readdirSync(join(root, WORKFLOWS))
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()
    .map((n) => ({ file: `${WORKFLOWS}/${n}`, text: realWorkflow(n) }));

describe('e2e-targets — la règle, sur des cas construits', () => {
  it('laisse passer un job qui monte sa pile, garde la recette et sert en local', () => {
    const verdict = judge(CONFORMING);
    assert.equal(verdict.judged, true);
    assert.deepEqual(verdict.findings, [], JSON.stringify(verdict.findings, null, 2));
  });

  it('refuse un job qui nomme la base de l’école et prend sa cible dans un secret', () => {
    const poisoned = CONFORMING.replace(
      '          echo "VITE_SUPABASE_URL=$API_URL" >> "$GITHUB_ENV"',
      '          echo "VITE_SUPABASE_URL=https://rpcjdohfxwukbqngbprw.supabase.co" >> "$GITHUB_ENV"\n' +
        '        env:\n          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    );
    assert.notEqual(poisoned, CONFORMING, 'la mutation doit s’appliquer, sinon ce cas ne prouve rien');
    const rules = judge(poisoned).rules;
    assert.ok(rules.includes(E2E_TARGET_RULES.HOSTED_TARGET), rules.join(','));
    assert.ok(rules.includes(E2E_TARGET_RULES.SECRET_TARGET), rules.join(','));
  });

  it('refuse un job sans pile à lui — même si un commentaire affirme le contraire', () => {
    // Le piège du format, dans le sens « absolution » : la phrase ne monte rien.
    const described = CONFORMING.replace('        run: supabase start', '        # supabase start est lancé plus haut');
    const rules = judge(described).rules;
    assert.ok(rules.includes(E2E_TARGET_RULES.NO_OWN_STACK), rules.join(','));

    const removed = CONFORMING.replace('        run: supabase start\n', '');
    assert.ok(judge(removed).rules.includes(E2E_TARGET_RULES.NO_OWN_STACK));
  });

  it('ne prend pas la PROSE du workflow pour du code : un en-tête qui cite la règle n’accuse personne', () => {
    // Les en-têtes des workflows RÉELS expliquent la règle, donc citent la base
    // de l'école et les secrets. Les prendre pour du code rendrait un faux rouge
    // sur du travail juste — mesuré sur business-e2e.yml et pdf-e2e.yml.
    const withProse = `# Ce job écrivait dans https://rpcjdohfxwukbqngbprw.supabase.co avec\n# SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }} — réparé.\n${CONFORMING}`;
    assert.deepEqual(judge(withProse).findings, []);
  });

  it('refuse un garde de recette qui passe APRÈS la première écriture', () => {
    const late = CONFORMING.replace(
      '      - name: Garde de recette\n        run: npm run check:recette-base\n      - name: Cycles métier\n        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/',
      '      - name: Cycles métier\n        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/\n      - name: Garde de recette\n        run: npm run check:recette-base',
    );
    assert.notEqual(late, CONFORMING, 'la mutation doit s’appliquer');
    const findings = judge(late).findings;
    const tardy = findings.find((f) => f.rule === E2E_TARGET_RULES.NO_RECETTE_GATE);
    assert.ok(tardy, JSON.stringify(findings, null, 2));
    assert.match(tardy!.detail, /après la première écriture/);
  });

  it('refuse une écriture pilotée hors loopback, dans les deux écritures du drapeau', () => {
    for (const form of ['--url=https://mama-thera-finance.vercel.app/', '--url https://mama-thera-finance.vercel.app/']) {
      const away = CONFORMING.replace('--url=http://127.0.0.1:4173/', form);
      assert.notEqual(away, CONFORMING);
      assert.ok(
        judge(away).rules.includes(E2E_TARGET_RULES.WRITER_NOT_LOOPBACK),
        `la forme ${form} doit être jugée`,
      );
    }
    // `localhost` est du loopback : la règle vise l'hôte, pas une écriture.
    const local = CONFORMING.replace('127.0.0.1:4173', 'localhost:4173');
    assert.deepEqual(judge(local).findings, []);
  });

  it('ne juge PAS une mesure qui vise la base réelle : elle est déclarée, pas accusée', () => {
    // Le cas réel : `prod-anon-rls.yml` sonde la production en anon. Le refuser
    // serait refuser son métier — et c'est ainsi qu'on apprend à éteindre un
    // contrôle. Ce job n'est donc pas un E2E : il n'est pas jugé.
    const probe = workflow(`      - name: Sondes anon sur la base distante
        run: node scripts/verify-anon-rls.mjs --remote
`);
    const verdict = judge(probe);
    assert.equal(verdict.judged, false);
    assert.deepEqual(verdict.findings, []);
    assert.equal(verdict.probes.length, 1, 'la mesure déclarée doit être NOMMÉE, pas fondue dans le décor');
  });

  it('excuse une invocation en lecture seule, et elle seule', () => {
    const driver = (flag: string) =>
      CONFORMING.replace(
        '      - name: Cycles métier\n        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/',
        `      - name: Politique servie\n        run: node scripts/verify-csp-guard.mjs --url=https://mama-thera-finance.vercel.app/ ${flag}`,
      );
    assert.deepEqual(judge(driver('--policy-only')).findings, []);
    const without = judge(driver(''))
      .findings.filter((f) => f.rule === E2E_TARGET_RULES.WRITER_NOT_LOOPBACK);
    assert.equal(without.length, 1, 'sans le drapeau, la même invocation vise la production');
  });
});

describe('e2e-targets — les briques de lecture', () => {
  it('blanchit les commentaires YAML, en gardant guillemets et longueur', () => {
    const src = ['run: echo "$API_URL" # commentaire', "  x: 'valeur # gardée'", '# tout un commentaire'].join('\n');
    const masked = maskYamlComments(src);
    assert.equal(masked.length, src.length, 'la longueur ne bouge pas : un décalage désigne la bonne ligne');
    assert.equal(masked.split('\n').length, src.split('\n').length);
    assert.doesNotMatch(masked, /commentaire/);
    assert.match(masked, /run: echo "\$API_URL"/);
    assert.match(masked, /'valeur # gardée'/);
  });

  it('reconnaît la base de l’école parmi les hôtes hébergés', () => {
    const hosts = hostedSupabaseHosts(
      'VITE_SUPABASE_URL=https://rpcjdohfxwukbqngbprw.supabase.co\nAUTRE=https://vulbmmzhcmnzswcvswfk.supabase.co',
    );
    assert.equal(hosts.length, 2);
    assert.equal(hosts[0].shared, true);
    assert.equal(hosts[1].shared, false);
  });

  it('ne retient que les secrets qui DÉSIGNENT une base', () => {
    const found = targetSecrets(
      'A: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\nB: ${{ secrets.GITHUB_TOKEN }}\nC: ${{ secrets.DEPENDABOT_REBASE_TOKEN }}',
    );
    assert.deepEqual(found.map((f) => f.name), ['SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('suit un script appelé par `node` ou par une entrée npm', () => {
    assert.equal(scriptOf(['node', 'scripts/e2e-business.mjs', '--url=x']), 'scripts/e2e-business.mjs');
    assert.equal(
      scriptOf(['npm', 'run', 'check:owners'], { 'check:owners': 'node scripts/check-owner-accounts.mjs' }),
      'scripts/check-owner-accounts.mjs',
    );
    assert.equal(scriptOf(['npm', 'ci']), null);
  });

  it('trouve les invocations dans un bloc multiligne, avec leurs drapeaux et leur ligne', () => {
    const invocations = scriptInvocations({
      file: 'x.yml',
      text: CONFORMING,
      scripts: {},
    });
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].script, 'scripts/e2e-business.mjs');
    assert.deepEqual(invocations[0].args, ['--url=http://127.0.0.1:4173/']);
    assert.ok(invocations[0].line > 1);
  });

  it('ne prend pas une invocation écrite dans un commentaire pour une invocation', () => {
    const commented = `# node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/\n${CONFORMING.replace(
      '        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/',
      '        run: echo rien',
    )}`;
    assert.equal(scriptInvocations({ file: 'x.yml', text: commented, scripts: {} }).length, 0);
  });

  it('reconnaît le drapeau déclaré en lecture seule', () => {
    const entry = readOnlyExcuse({ script: 'scripts/verify-csp-guard.mjs', args: ['--policy-only'] });
    assert.equal(entry?.flag, '--policy-only');
    assert.equal(readOnlyExcuse({ script: 'scripts/verify-csp-guard.mjs', args: [] }), null);
  });
});

describe('e2e-targets — le classement et les dérogations sont bornés DANS LES DEUX SENS', () => {
  const drivers = [{ script: 'scripts/e2e-business.mjs', because: 'pilote l’app' }];
  const probes = [{ script: 'scripts/verify-anon-rls.mjs', because: 'sonde la base réelle en anon' }];

  it('refuse un script qui écrit et que la CI appelle sans être classé', () => {
    const problems = auditClassification({
      invokedWriters: ['scripts/e2e-business.mjs', 'scripts/nouveau-e2e.mjs', 'scripts/verify-anon-rls.mjs'],
      drivers,
      probes,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /scripts\/nouveau-e2e\.mjs/);
    assert.match(problems[0], /sans être classé/);
  });

  it('refuse un classement devenu inutile : plus aucun workflow ne l’appelle', () => {
    const problems = auditClassification({
      invokedWriters: ['scripts/e2e-business.mjs'],
      drivers,
      probes,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /verify-anon-rls\.mjs/);
    assert.match(problems[0], /plus AUCUN workflow ne l’appelle/);
  });

  it('refuse un classement sans raison, et une brique classée des deux côtés', () => {
    assert.ok(
      auditClassification({ invokedWriters: ['scripts/x.mjs'], drivers: [{ script: 'scripts/x.mjs', because: '  ' }], probes: [] })
        .some((p) => /sans raison/.test(p)),
    );
    const both = auditClassification({
      invokedWriters: ['scripts/x.mjs'],
      drivers: [{ script: 'scripts/x.mjs', because: 'pilote' }],
      probes: [{ script: 'scripts/x.mjs', because: 'mesure' }],
    });
    assert.ok(both.some((p) => /à la fois comme E2E et comme mesure/.test(p)));
  });

  it('exige qu’un drapeau de lecture seule EXISTE dans la source, et serve', () => {
    const declared = [{ script: 'scripts/verify-csp-guard.mjs', flag: '--policy-only', because: 'sans compte' }];
    const sources = { 'scripts/verify-csp-guard.mjs': 'if (argv.includes("--policy-only")) { … }' };
    assert.deepEqual(
      auditReadOnlyDeclarations({ declared, sources, used: ['scripts/verify-csp-guard.mjs --policy-only'] }),
      [],
    );
    assert.ok(
      auditReadOnlyDeclarations({ declared, sources: { 'scripts/verify-csp-guard.mjs': 'aucun drapeau' }, used: ['scripts/verify-csp-guard.mjs --policy-only'] })[0].includes(
        'n’a aucune preuve dans la source',
      ),
    );
    assert.ok(
      auditReadOnlyDeclarations({ declared, sources, used: [] })[0].includes('plus AUCUN workflow ne l’emploie'),
    );
    assert.ok(
      auditReadOnlyDeclarations({ declared: [{ ...declared[0], because: ' ' }], sources, used: ['scripts/verify-csp-guard.mjs --policy-only'] })[0].includes(
        'sans raison',
      ),
    );
  });

  it('tolère une dérogation exacte, et refuse dès qu’elle couvre trop ou trop peu', () => {
    const entry = [{ file: 'a.yml', covers: ['hosted-target', 'secret-target'], because: 'migration en cours' }];
    const results = [{ file: 'a.yml', judged: true, rules: ['hosted-target', 'secret-target'] }];
    const ok = auditExceptions({ exceptions: entry, results });
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.tolerated.length, 1);

    // Une brèche NON déclarée reste une violation : c'est ce qui empêche une
    // exception de devenir une porte ouverte sur tout le reste.
    const grown = auditExceptions({
      exceptions: entry,
      results: [{ file: 'a.yml', judged: true, rules: ['hosted-target', 'secret-target', 'no-own-stack'] }],
    });
    assert.equal(grown.problems.length, 1);
    assert.match(grown.problems[0], /ne couvre pas no-own-stack/);

    const shrunk = auditExceptions({
      exceptions: entry,
      results: [{ file: 'a.yml', judged: true, rules: ['hosted-target'] }],
    });
    assert.match(shrunk.problems[0], /rétrécissez/);

    // Le réel réparé rend la dérogation INUTILE : elle doit tomber.
    const fixed = auditExceptions({ exceptions: entry, results: [{ file: 'a.yml', judged: false, rules: [] }] });
    assert.match(fixed.problems[0], /DEVENUE INUTILE/);

    const ghost = auditExceptions({ exceptions: entry, results: [{ file: 'b.yml', judged: true, rules: ['hosted-target'] }] });
    assert.match(ghost.problems[0], /introuvable/);

    const mute = auditExceptions({
      exceptions: [{ file: 'a.yml', covers: [], because: '' }],
      results,
    });
    assert.ok(mute.problems.some((p) => /sans raison/.test(p)));
  });

  it('rend un ÉCHEC quand il n’y a rien à juger — un contrôle qui ne lit rien ne prouve rien', () => {
    const report = formatE2eTargetReport({
      results: [],
      scanned: { workflows: 0, judged: 0, invocations: 0 },
    });
    assert.equal(report.vacuous, true);
    assert.equal(report.failed, true);
    assert.match(report.lines.map((l) => l.text).join('\n'), /aucun workflow E2E jugé/);
  });

  it('ne rend PAS de verdict vert à côté d’une violation — un message mélangé ne se lit plus', () => {
    const poisoned = judge(
      workflow('      - name: Cycles\n        run: node scripts/e2e-business.mjs --url=http://127.0.0.1:4173/\n'),
    );
    const report = formatE2eTargetReport({
      results: [poisoned],
      scanned: { workflows: 1, judged: 1, invocations: 1 },
    });
    assert.equal(report.failed, true);
    const text = report.lines.map((l) => l.text).join('\n');
    assert.match(text, /ne monte aucune pile à lui/);
    assert.doesNotMatch(text, /aucun n’écrit dans la base de l’école/);
  });

  it('nomme les jobs de mesure au lieu de les taire', () => {
    const probeJob = judge(
      workflow('      - name: Sondes\n        run: node scripts/verify-anon-rls.mjs --remote\n'),
      `${WORKFLOWS}/prod-anon-rls.yml`,
    );
    const report = formatE2eTargetReport({
      results: [judge(CONFORMING), probeJob],
      scanned: { workflows: 2, judged: 1, invocations: 2 },
    });
    assert.match(report.lines.map((l) => l.text).join('\n'), /visent la base réelle par conception/);
  });
});

describe('e2e-targets — le DÉPÔT réel', () => {
  const results = realWorkflows().map((w) => judgeWorkflow({ file: w.file, text: w.text, scripts: {}, isDriver, isProbe }));

  it('ne trouve aucune violation hors dérogation, et juge bien les E2E', () => {
    assert.deepEqual(violationsOf({ results, exceptions: EXCEPTIONS }), []);
    const judged = results.filter((r) => r.judged).map((r) => r.file);
    assert.ok(judged.length >= 3, `les trois E2E du dépôt doivent être jugés (jugés : ${judged.join(', ')})`);
  });

  it('les deux E2E qui ont reçu leur pile sont CONFORMES, en-têtes compris', () => {
    for (const file of [`${WORKFLOWS}/business-e2e.yml`, `${WORKFLOWS}/pdf-e2e.yml`]) {
      const verdict = results.find((r) => r.file === file);
      assert.ok(verdict, `${file} doit être lu`);
      assert.equal(verdict!.judged, true, `${file} pilote l’application : il doit être jugé`);
      assert.deepEqual(verdict!.findings, [], JSON.stringify(verdict!.findings, null, 2));
    }
  });

  it('la dérogation du dépôt couvre EXACTEMENT la brèche de desktop-e2e.yml', () => {
    // Ce cas est la preuve de la brèche, pas sa justification : le jour où le
    // job monte sa pile, il échoue — et il faudra retirer l'entrée.
    const verdict = results.find((r) => r.file === `${WORKFLOWS}/desktop-e2e.yml`);
    assert.ok(verdict, 'desktop-e2e.yml doit être lu');
    assert.equal(verdict!.judged, true);
    assert.deepEqual(
      verdict!.rules,
      [
        E2E_TARGET_RULES.HOSTED_TARGET,
        E2E_TARGET_RULES.NO_OWN_STACK,
        E2E_TARGET_RULES.NO_RECETTE_GATE,
        E2E_TARGET_RULES.SECRET_TARGET,
      ],
      JSON.stringify(verdict!.rules),
    );
    const entry = EXCEPTIONS.find((e) => e.file === `${WORKFLOWS}/desktop-e2e.yml`);
    assert.deepEqual([...entry!.covers].sort(), [...verdict!.rules].sort());
  });

  it('les veilles qui visent la base réelle ne sont PAS jugées par la règle E2E', () => {
    for (const file of [
      `${WORKFLOWS}/prod-anon-rls.yml`,
      `${WORKFLOWS}/owner-accounts-watch.yml`,
      `${WORKFLOWS}/payment-ledger-watch.yml`,
    ]) {
      const verdict = results.find((r) => r.file === file);
      assert.equal(verdict!.judged, false, `${file} n’est pas un E2E : le juger serait un faux rouge`);
    }
  });

  it('PREUVE PAR MUTATION : repointer le vrai business-e2e.yml sur la base de l’école rougit', () => {
    // Sans ce cas, tout ce qui précède pourrait être vert parce que le contrôle
    // ne lit rien. Le dépôt n'a pas changé : c'est le contrôle qu'on interroge.
    const real = realWorkflow('business-e2e.yml');
    const poisoned = real.replace(
      '            echo "SUPABASE_URL=$API_URL"',
      '            echo "SUPABASE_URL=https://rpcjdohfxwukbqngbprw.supabase.co"',
    );
    assert.notEqual(poisoned, real, 'la mutation doit s’appliquer, sinon ce cas ne prouve rien');
    const verdict = judgeWorkflow({
      file: `${WORKFLOWS}/business-e2e.yml`,
      text: poisoned,
      scripts: {},
      isDriver,
      isProbe,
    });
    assert.ok(verdict.rules.includes(E2E_TARGET_RULES.HOSTED_TARGET), JSON.stringify(verdict.findings, null, 2));

    // Et la seconde moitié : retirer la pile montée par le job rougit aussi.
    const stackless = real.replace('        run: supabase start\n', '');
    assert.notEqual(stackless, real);
    assert.ok(
      judgeWorkflow({ file: 'x.yml', text: stackless, scripts: {}, isDriver, isProbe }).rules.includes(
        E2E_TARGET_RULES.NO_OWN_STACK,
      ),
    );
  });

  it('les scripts RÉELS classés existent, et la déclaration de lecture seule aussi', () => {
    for (const entry of [...E2E_DRIVERS, ...PRODUCTION_PROBES]) {
      assert.doesNotThrow(() => readFileSync(join(root, entry.script), 'utf8'), `${entry.script} doit exister`);
      assert.ok(entry.because.trim().length > 20, `${entry.script} doit dire POURQUOI`);
    }
    for (const entry of READ_ONLY_INVOCATIONS) {
      const source = readFileSync(join(root, entry.script), 'utf8');
      assert.match(source, new RegExp(entry.flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});
