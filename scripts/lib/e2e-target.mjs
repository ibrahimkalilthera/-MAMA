/**
 * ─── OÙ UN E2E A LE DROIT D'ÉCRIRE ─────────────────────────────────────────
 *
 * Le 2026-10-12, les deux workflows E2E du dépôt ont reçu **leur propre pile**
 * Supabase : `business-e2e.yml` et `pdf-e2e.yml` ne créent plus ni compte
 * éphémère ni ligne de démo dans la base de l'école. La règle qui l'a imposé se
 * dit en une phrase — **« un contrôle n'a rien à écrire chez le client »** — et
 * elle était, jusqu'ici, **seulement documentée** : rien n'empêchait le
 * prochain job de repointer la base partagée, et personne ne l'aurait vu avant
 * que l'école ne retrouve des lignes de démonstration dans ses comptes.
 *
 * Ce module rend la règle exécutable. Pour chaque workflow, il répond à trois
 * questions :
 *   1. **Ce job est-il un E2E ?** Il l'est s'il lance un script du dépôt qui
 *      ÉCRIT (création ou mutation), et cette qualité se LIT — elle ne se
 *      déclare pas : c'est `judgeWrites` (`scripts/lib/e2e-writes.mjs`) qui
 *      tranche, sur la source du script. Un script qui ne fait que lire ne
 *      sujet à juger : `verify-anon-rls.mjs --remote` sonde la base réelle en
 *      anon pur, sans y écrire une ligne.
 *   2. **Où ce job écrit-il ?** Cinq refus, chacun mesurable dans le texte :
 *      un hôte Supabase hébergé nommé en dur (la base partagée est le cas
 *      grave, et c'est le SEUL projet dont ce dépôt garde des secrets) ; une
 *      cible prise dans un `secrets.*` Supabase ; l'absence de pile montée par
 *      le job ; l'absence (ou le retard) du garde `check:recette-base`, qui
 *      refuse d'écrire sur une base qui porte déjà des données d'école ; une
 *      invocation d'écriture servie ailleurs qu'en loopback.
 *   3. **Sinon, l'exception est-elle bornée ?** Une dérogation doit NOMMER le
 *      workflow, dire POURQUOI, et couvrir EXACTEMENT les refus observés — une
 *      exception qui couvre plus (le réel a été corrigé) comme une exception
 *      qui couvre moins (une nouvelle brèche est apparue) font échouer le
 *      contrôle. Une porte ouverte qui ne se referme jamais est pire qu'un
 *      contrôle absent, parce qu'elle rassure.
 *
 * ─── CE QUE CE MODULE LIT, ET CE QUI POURRAIT LE TROMPER ───────────────────
 * Il lit des workflows YAML — un format où **la prose et le code se
 * ressemblent** : les en-têtes de ces fichiers expliquent la règle, et citent
 * donc des hôtes Supabase et des commandes (`vulbmmzhcmnzswcvswfk`,
 * `supabase start`) que le job n'utilise plus. Prendre cette prose pour du code
 * rendrait un faux rouge sur du travail juste, et — dans l'autre sens — un
 * commentaire qui DÉCRIT la pile ferait passer un job qui n'en monte aucune.
 * Les commentaires sont donc blanchis AVANT tout jugement (`maskYamlComments`),
 * et le jugement porte sur le texte blanchi. Deux pièges sont nommés comme tels
 * dans les cas de test : la prose ne compte ni pour accuser ni pour absoudre.
 *
 * Un troisième piège n'est pas de la prose mais du **décor** : une commande peut
 * vivre dans un `run: |` multiligne, ou dans un `&&`, ou derrière un `if`. Le
 * découpage est celui de `scripts/lib/ci-commands.mjs` (déjà éprouvé par le
 * contrôle de parité CI ↔ package.json) : une seule définition du découpage,
 * donc une seule vérité sur ce qu'un job exécute vraiment.
 *
 * ─── LIMITE ASSUMÉE ────────────────────────────────────────────────────────
 * C'est un contrôle de TEXTE : il prouve où un job DIT qu'il écrit, pas ce qui
 * a été écrit ce jour-là. La preuve d'exécution appartient au garde
 * anti-résidus (`verify-ephemeral-cleanup.mjs`), qui compte les comptes
 * éphémères réellement présents dans la base visée.
 */
import { SHARED_PROJECT_REF, SHARED_PROJECT_URL } from './shared-project.mjs';
import { EXEMPTIONS as E2E_WRITE_EXEMPTIONS, judgeWrites } from './e2e-writes.mjs';
import { extractRunBlocks, splitCommandSegments, tokenize } from './ci-commands.mjs';
// Le blanchiment de la prose des workflows vit dans la couche partagée, comme
// celui du CSS et du balisage : une copie locale serait la cinquième règle de
// blanchiment de ce dépôt, donc la cinquième occasion de se tromper.
import { maskYamlComments } from './source-text.mjs';

/** Les refus, nommés une fois pour être cités sans faute de frappe. */
export const E2E_TARGET_RULES = {
  /** Un hôte Supabase hébergé est écrit en dur dans un job qui écrit. */
  HOSTED_TARGET: 'hosted-target',
  /** La cible vient d'un secret Supabase — donc du projet de l'école. */
  SECRET_TARGET: 'secret-target',
  /** Le job n'échafaude aucune pile à lui (`supabase start`). */
  NO_OWN_STACK: 'no-own-stack',
  /** Le garde de recette est absent, ou passe APRÈS la première écriture. */
  NO_RECETTE_GATE: 'no-recette-gate',
  /** Une écriture est pilotée ailleurs qu'en loopback. */
  WRITER_NOT_LOOPBACK: 'writer-not-loopback',
};

/** La phrase imprimée pour chaque refus. */
export const RULE_LABELS = {
  [E2E_TARGET_RULES.HOSTED_TARGET]: 'vise un projet Supabase hébergé',
  [E2E_TARGET_RULES.SECRET_TARGET]: 'prend sa cible dans un secret Supabase',
  [E2E_TARGET_RULES.NO_OWN_STACK]: 'ne monte aucune pile à lui',
  [E2E_TARGET_RULES.NO_RECETTE_GATE]: 'écrit sans garde de recette (ou après la première écriture)',
  [E2E_TARGET_RULES.WRITER_NOT_LOOPBACK]: 'pilote une écriture hors loopback',
};

/**
 * Les variables d'environnement qui DÉSIGNENT une base. Les lire depuis un
 * `secrets.*` dans un job qui écrit, c'est viser le projet de l'école : c'est
 * le seul projet Supabase dont ce dépôt garde des secrets de cible, et une pile
 * montée par le job n'en a besoin d'aucune — ses clés sont éphémères et rendues
 * par la CLI (`supabase status -o env`).
 */
export const TARGET_SECRETS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ACCESS_TOKEN',
];

/** La commande qui monte la pile du job, et celle qui rend ses clés éphémères. */
export const STACK_COMMANDS = ['supabase start', 'supabase status -o env'];

/** Le garde qui refuse d'écrire sur une base qui porte déjà des données d'école. */
export const RECETTE_GATE = 'check:recette-base';

/** Ce qui est loopback — la seule adresse où un E2E a le droit de piloter. */
const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i;

/**
 * Les invocations qui ÉCRIVENT le plus souvent, mais qui sont en lecture seule
 * par leur drapeau — déclarées ici, avec leur raison, et vérifiées dans les
 * deux sens : le drapeau doit EXISTER dans la source du script (sinon la
 * déclaration excuse un mot qu'aucun script ne connaît), et il doit être
 * UTILISÉ par un workflow (sinon elle excuse un site qui n'existe plus).
 *
 * Ce n'est pas une tolérance d'écriture : `--policy-only` ne crée aucun compte
 * et n'ouvre aucun navigateur (« la politique servie, comparée mot pour mot à
 * vercel.json »). Un E2E qui n'écrit pas n'a rien à faire de la règle « n'écris
 * pas chez le client ».
 */
export const READ_ONLY_INVOCATIONS = [
  {
    script: 'scripts/verify-csp-guard.mjs',
    flag: '--policy-only',
    because: 'juge la politique servie, sans compte ni navigateur — rien n’est créé ni modifié',
  },
];

/**
 * ─── QUI PILOTE L'APPLICATION, ET QUI MESURE LA BASE RÉELLE ─────────────────
 *
 * Cette distinction n'est pas un confort, c'est le cœur de la règle. Un **E2E**
 * pilote l'application ou le binaire SOUS TEST (un navigateur, un binaire
 * empaqueté, un formulaire) : il lui faut un compte et parfois une ligne de
 * démo, donc c'est lui qui écrit chez le client, et c'est lui que les cinq
 * refus jugent. Une **mesure** vise la base réelle **à dessein** — la sauvegarde
 * lit la production pour la sauvegrader, la veille des comptes propriétaires
 * prouve que le login délivre encore des sessions, le garde anon sonde `anon`
 * contre la base servie. Les confondre donnerait un contrôle qui refuse le
 * travail des veilles, c'est-à-dire un faux rouge qui apprend à l'éteindre.
 *
 * Les deux listes sont **bornées dans les deux sens** : un script d'écriture
 * appelé par la CI et absent des deux est une ERREUR (« classez-le »), et une
 * entrée que plus aucun workflow n'appelle est une entrée morte. La liste des
 * scripts à classer n'est pas tenue à la main : c'est `judgeWrites` qui dit
 * lesquels écrivent, sur leur source.
 *
 * Les raisons disent ce que le script FAIT vraiment, y compris ce qui dérange :
 * `check-owner-accounts.mjs` écrit bel et bien un compte jetable dans la base
 * de l'école, chaque semaine, pour prouver le chemin de login — un E2E qui
 * ferait la même chose serait refusé, et c'est écrit ici plutôt que caché.
 */
export const E2E_DRIVERS = [
  { script: 'scripts/e2e-business.mjs', because: 'pilote les deux cycles métier dans l’app servie en local' },
  {
    script: 'scripts/verify-pdf-download.mjs',
    because: 'pilote l’app servie en local : connexion réelle, clics réels, PDF mesuré au pixel',
  },
  {
    script: 'scripts/verify-csp-guard.mjs',
    because: 'navigue les sept pages de l’app en session réelle (et juge la politique servie en `--policy-only`, sans compte)',
  },
  {
    script: 'scripts/verify-desktop-app.mjs',
    because: 'lance le binaire empaqueté, s’y connecte et y déclenche un téléchargement réel',
  },
  {
    script: 'scripts/verify-installed-parent-form.mjs',
    because: 'installe l’installeur publié et pilote le formulaire parent dans l’app installée',
  },
];

export const PRODUCTION_PROBES = [
  {
    script: 'scripts/check-owner-accounts.mjs',
    because:
      'veille des comptes propriétaires : elle crée un compte JETABLE dans la base réelle (création → session → suppression, avec sonde de réconciliation) parce que le login ne se prouve qu’en le faisant, puis supprime — la base de l’école est donc bien écrite par cette veille, et c’est un choix nommé, pas un oubli',
  },
  {
    script: 'scripts/verify-anon-rls.mjs',
    because:
      'garde-fou anon : en `--remote` il sonde la base RÉELLE en anon pur (aucune clé service, le script refuse de tourner si elle est présente) et n’écrit rien ; sa version semée tourne dans la pile locale de `supabase-migrations.yml`',
  },
  {
    script: 'scripts/restore-db.mjs',
    because:
      'restaure une sauvegarde dans une cible désignée — la chaîne d’essai l’applique à une pile locale NEUVE, et `--empty-first` REFUSE la base partagée',
  },
  {
    script: 'scripts/verify-ephemeral-cleanup.mjs',
    because:
      'garde anti-résidus : il compte et purge les comptes éphémères de la base VISÉE par le job qui l’appelle — celle de la pile locale des deux E2E, et encore celle de l’école pour `desktop-e2e.yml` (dérogation nommée plus bas)',
  },
];

/**
 * ─── Les dérogations du dépôt ───────────────────────────────────────────────
 *
 * Une dérogation dit ce qu'elle couvre (`covers`, la liste EXACTE des refus) et
 * pourquoi. Elle est bornée dans les deux sens : un refus non déclaré dans
 * `covers` reste une violation, et un refus déclaré qui n'est plus observé rend
 * l'entrée obsolète — le contrôle échoue alors en demandant de retirer
 * l'entrée. C'est ce qui empêche une dérogation de survivre à sa cause.
 *
 * `desktop-e2e.yml` est la seule du dépôt, et elle est DIRE à chaque
 * exécution : le job hebdomadaire qui prouve l'application EMPAQUETÉE écrit
 * encore un compte éphémère et un employé temporaire dans la base de l'école.
 * Sa migration n'est pas mécanique : le binaire embarqué porte la politique CSP
 * (`electron/csp-policy.cjs`) qui n'autorise QUE l'origine du projet partagé —
 * lui donner sa pile suppose d'ouvrir cette origine-là au local, en plus de
 * faire tourner `supabase start` (Docker) sur un runner Windows. Tant que ce
 * travail n'est pas fait et VÉRIFIÉ, l'exception dit la brèche au lieu de la
 * cacher.
 */
export const EXCEPTIONS = [
  {
    file: '.github/workflows/desktop-e2e.yml',
    covers: [
      E2E_TARGET_RULES.HOSTED_TARGET,
      E2E_TARGET_RULES.NO_OWN_STACK,
      E2E_TARGET_RULES.NO_RECETTE_GATE,
      E2E_TARGET_RULES.SECRET_TARGET,
    ],
    because:
      'la preuve de l’application EMPAQUETÉE exige un binaire qui porte encore la CSP du projet partagé : lui donner sa pile suppose d’ouvrir `electron/csp-policy.cjs` à l’origine locale et de faire tourner `supabase start` (Docker) sur un runner Windows — un travail à faire, et à vérifier, pas à supposer',
  },
];

/**
 * Les hôtes Supabase hébergés nommés en dur, avec leur ligne.
 * @param {string} text déjà blanchi de ses commentaires
 * @returns {{ host: string, line: number, shared: boolean }[]}
 */
export function hostedSupabaseHosts(text) {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)\b/gi)) {
      out.push({ host: m[1], line: i + 1, shared: m[1] === SHARED_PROJECT_REF });
    }
  }
  return out;
}

/**
 * Les secrets Supabase lus par le workflow, avec leur ligne.
 * @param {string} text blanchi
 * @returns {{ name: string, line: number }[]}
 */
export function targetSecrets(text) {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/secrets\.([A-Z0-9_]+)/g)) {
      if (TARGET_SECRETS.includes(m[1])) out.push({ name: m[1], line: i + 1 });
    }
  }
  return out;
}

/**
 * Le script de `scripts/` qu'une commande lance, ou null. Deux formes, celles
 * que ce dépôt emploie : `node scripts/x.mjs`, et `npm run <entrée>` indexée par
 * package.json (un job qui appelle `npm run e2e` écrit tout autant).
 *
 * @param {string[]} tokens
 * @param {Record<string, string>} [scripts] les `scripts` de package.json
 * @returns {string | null} chemin relatif, ex. `scripts/e2e-business.mjs`
 */
export function scriptOf(tokens, scripts = {}) {
  const t = Array.isArray(tokens) ? tokens : tokenize(tokens);
  if (!t.length) return null;
  if (t[0] === 'node') {
    const found = t.slice(1).find((tok) => /^scripts\/[A-Za-z0-9._-]+\.mjs$/.test(tok));
    return found ?? null;
  }
  if (t[0] === 'npm' && (t[1] === 'run' || t[1] === 'exec' || t[1] === 'run-script')) {
    const name = t[2];
    const command = name ? scripts?.[name] : null;
    if (!command) return null;
    return scriptOf(tokenize(String(command)), scripts);
  }
  return null;
}

/**
 * Toutes les invocations de scripts d'un workflow, avec la ligne du `run:` et
 * le drapeau qui les accompagne. Le découpage est celui du module partagé :
 * `&&`, `||`, `;`, `|` et les fins de ligne.
 *
 * @param {{ file: string, text: string, scripts?: Record<string, string> }} input
 * @returns {{ script: string, args: string[], line: number, step: string|null, command: string }[]}
 */
export function scriptInvocations({ file, text, scripts = {} }) {
  const blocks = extractRunBlocks(maskYamlComments(text));
  const out = [];
  for (const block of blocks) {
    for (const segment of splitCommandSegments(block.command)) {
      const tokens = tokenize(segment);
      const script = scriptOf(tokens, scripts);
      if (!script) continue;
      out.push({
        file,
        script,
        args: tokens.filter((tok) => tok.startsWith('--')),
        line: block.line,
        step: block.step,
        command: segment.trim(),
      });
    }
  }
  return out;
}

/**
 * Le drapeau déclaré en lecture seule de cette invocation, s'il y en a un.
 * @param {{ script: string, args: string[] }} invocation
 * @param {typeof READ_ONLY_INVOCATIONS} [declared]
 * @returns {typeof READ_ONLY_INVOCATIONS[number] | null}
 */
export function readOnlyExcuse(invocation, declared = READ_ONLY_INVOCATIONS) {
  return (
    declared.find(
      (entry) => entry.script === invocation.script && invocation.args.includes(entry.flag),
    ) ?? null
  );
}

/**
 * Ce script ÉCRIT-il ? La question se lit sur sa source (`judgeWrites`), jamais
 * sur une liste tenue à la main : un script renommé, déplacé ou réécrit change
 * de réponse tout seul.
 *
 * @param {{ file: string, source: string }} input
 * @returns {boolean}
 */
export function scriptWrites({ file, source }) {
  const verdict = judgeWrites({ file, source, allowlist: E2E_WRITE_EXEMPTIONS });
  return verdict.creates + verdict.mutations > 0;
}

/**
 * Juge un workflow. `isDriver` répond pour un chemin de script : ce script
 * PILOTE-t-il l'application sous test ? (Voir `E2E_DRIVERS`.)
 *
 * @param {{
 *   file: string,
 *   text: string,
 *   scripts?: Record<string, string>,
 *   isDriver: (script: string) => boolean,
 *   isProbe?: (script: string) => boolean,
 *   declared?: typeof READ_ONLY_INVOCATIONS,
 * }} input
 * @returns {{
 *   file: string,
 *   judged: boolean,
 *   invocations: object[],
 *   writers: object[],
 *   readOnly: object[],
 *   probes: object[],
 *   findings: { file: string, line: number, step: string|null, rule: string, detail: string }[],
 *   rules: string[],
 * }}
 */
export function judgeWorkflow({
  file,
  text,
  scripts = {},
  isDriver,
  isProbe = () => false,
  declared = READ_ONLY_INVOCATIONS,
}) {
  const masked = maskYamlComments(text);
  const invocations = scriptInvocations({ file, text, scripts });
  const writers = [];
  const readOnly = [];
  const probes = [];
  for (const inv of invocations) {
    const excuse = readOnlyExcuse(inv, declared);
    if (excuse) {
      readOnly.push({ ...inv, excuse });
      continue;
    }
    if (isDriver(inv.script)) writers.push(inv);
    // Seules les MESURES déclarées sont nommées comme telles : la plupart des
    // scripts d'un job ne touchent pas la base réelle du tout, et les compter
    // comme « mesures » transformerait une ligne vraie en affirmation fausse.
    else if (isProbe(inv.script)) probes.push(inv);
  }

  // Un job qui ne pilote rien n'est pas un E2E : la règle ne le concerne pas, et
  // le juger quand même ferait de ce contrôle un censeur des veilles
  // (`prod-anon-rls`, `owner-accounts-watch` visent la base réelle À DESSEIN).
  // Ses scripts restent déclarés comme mesures : rien n'est silencieux.
  if (writers.length === 0) {
    return { file, judged: false, invocations, writers, readOnly, probes, findings: [], rules: [] };
  }

  const findings = [];
  const push = (line, rule, detail, step = null) => findings.push({ file, line, step, rule, detail });

  for (const { host, line, shared } of hostedSupabaseHosts(masked)) {
    push(
      line,
      E2E_TARGET_RULES.HOSTED_TARGET,
      shared
        ? `${host} est la base de l’école (${SHARED_PROJECT_URL}) — un E2E n’écrit pas chez le client`
        : `${host} est un projet hébergé — un E2E monte sa propre pile, il ne dépend d’aucune ressource externe`,
    );
  }

  for (const { name, line } of targetSecrets(masked)) {
    push(
      line,
      E2E_TARGET_RULES.SECRET_TARGET,
      `secrets.${name} désigne une base hébergée ; la pile d’un E2E est éphémère et ses clés sont rendues par la CLI`,
    );
  }

  for (const command of STACK_COMMANDS) {
    if (!masked.includes(command)) {
      push(
        writers[0].line,
        E2E_TARGET_RULES.NO_OWN_STACK,
        `\`${command}\` est absent : le job n’a pas de pile à lui, donc il écrit quelque part qui ne lui appartient pas`,
        writers[0].step,
      );
    }
  }

  const head = writers.reduce((min, w) => (min === null || w.line < min.line ? w : min), null);
  const gate = extractRunBlocks(masked)
    .filter((block) => block.command.includes(RECETTE_GATE))
    .map((block) => block.line);
  if (gate.length === 0) {
    push(
      head.line,
      E2E_TARGET_RULES.NO_RECETTE_GATE,
      `\`npm run ${RECETTE_GATE}\` est absent : rien ne refuse d’écrire sur une base qui porte déjà des données d’école`,
      head.step,
    );
  } else if (Math.min(...gate) > head.line) {
    push(
      Math.min(...gate),
      E2E_TARGET_RULES.NO_RECETTE_GATE,
      `\`${RECETTE_GATE}\` passe après la première écriture (ligne ${head.line}) — il ne garde plus rien`,
      head.step,
    );
  }

  for (const writer of writers) {
    const url = [...writer.args].reverse().find((arg) => /^--url(?:=|$)/.test(arg));
    if (!url) continue;
    const value = url.includes('=') ? url.slice(url.indexOf('=') + 1) : '';
    if (!value || !LOOPBACK.test(value)) {
      push(
        writer.line,
        E2E_TARGET_RULES.WRITER_NOT_LOOPBACK,
        `\`${writer.command}\` écrit hors loopback${value ? ` (${value})` : ''} — le build jugé se sert en local`,
        writer.step,
      );
    }
  }

  return {
    file,
    judged: true,
    invocations,
    writers,
    readOnly,
    probes,
    findings,
    rules: [...new Set(findings.map((f) => f.rule))].sort(),
  };
}

/**
 * Le classement des scripts, borné dans les DEUX sens.
 *
 * Un script qui ÉCRIT et que la CI appelle (le fait est lu par `judgeWrites`,
 * pas déclaré) doit être classé : soit il pilote l'application sous test, soit
 * il mesure la base réelle à dessein. Rien ne peut écrire depuis la CI sans
 * qu'une phrase ait dit POURQUOI — c'est ce qui empêche un nouveau job de
 * repointer la base de l'école en douce.
 *
 * @param {{
 *   invokedWriters: string[],
 *   drivers?: typeof E2E_DRIVERS,
 *   probes?: typeof PRODUCTION_PROBES,
 * }} input
 * @returns {string[]} problèmes
 */
export function auditClassification({ invokedWriters, drivers = E2E_DRIVERS, probes = PRODUCTION_PROBES }) {
  const problems = [];
  const invoked = new Set(invokedWriters);
  for (const entry of [...drivers, ...probes]) {
    if (!String(entry.because ?? '').trim()) {
      problems.push(`${entry.script} — classé sans raison : un classement muet ne dit rien de ce qu’il vaut.`);
    }
    if (!invoked.has(entry.script)) {
      problems.push(
        `${entry.script} — classé mais plus AUCUN workflow ne l’appelle : retirez l’entrée, elle ne surveille plus rien.`,
      );
    }
  }
  const declared = new Set([...drivers, ...probes].map((e) => e.script));
  for (const script of [...invoked].sort()) {
    if (!declared.has(script)) {
      problems.push(
        `${script} — ÉCRIT et appelé par la CI sans être classé : est-ce un E2E qui pilote l’application (il doit alors monter sa pile), ou une mesure qui vise la base réelle à dessein ? Déclarez-le dans scripts/lib/e2e-target.mjs.`,
      );
    }
  }
  // Une même brique ne peut pas être à la fois « pilote » et « mesure » : celui
  // qui lirait la liste s’arrêterait à la première qu’il croit vraie.
  for (const d of drivers) {
    if (probes.some((p) => p.script === d.script)) {
      problems.push(`${d.script} — classé à la fois comme E2E et comme mesure : une seule des deux est vraie.`);
    }
  }
  return problems;
}

/**
 * Vérifie les déclarations de lecture seule, dans les DEUX sens : un drapeau
 * qui n'existe pas dans la source du script excuse un mot que personne
 * n'emploie, et un drapeau que plus aucun workflow ne porte n'excuse plus rien.
 *
 * @param {{
 *   declared?: typeof READ_ONLY_INVOCATIONS,
 *   sources?: Record<string, string>,
 *   used?: Set<string> | string[],
 * }} input
 * @returns {string[]} problèmes
 */
export function auditReadOnlyDeclarations({ declared = READ_ONLY_INVOCATIONS, sources = {}, used = [] }) {
  const usedSet = used instanceof Set ? used : new Set(used);
  const problems = [];
  for (const entry of declared) {
    if (!String(entry.because ?? '').trim()) {
      problems.push(`${entry.script} ${entry.flag} — déclaration de lecture seule sans raison : une tolérance muette est un trou.`);
    }
    const source = sources[entry.script];
    if (source === undefined) {
      problems.push(`${entry.script} — déclaré en lecture seule (${entry.flag}) mais le script n’existe pas dans scripts/.`);
      continue;
    }
    if (!source.includes(entry.flag)) {
      problems.push(
        `${entry.script} — la déclaration de lecture seule (${entry.flag}) n’a aucune preuve dans la source : ce drapeau n’y existe pas.`,
      );
    }
    if (!usedSet.has(`${entry.script} ${entry.flag}`)) {
      problems.push(
        `${entry.script} ${entry.flag} — déclaré en lecture seule mais plus AUCUN workflow ne l’emploie : retirez la déclaration.`,
      );
    }
  }
  return problems;
}

/**
 * Confronte les dérogations aux refus réellement observés.
 *
 * @param {{
 *   exceptions?: typeof EXCEPTIONS,
 *   results: { file: string, judged: boolean, rules: string[] }[],
 * }} input
 * @returns {{ problems: string[], tolerated: { file: string, rules: string[], because: string, line: number }[] }}
 */
export function auditExceptions({ exceptions = EXCEPTIONS, results }) {
  const byFile = new Map(results.map((r) => [r.file, r]));
  const problems = [];
  const tolerated = [];
  for (const entry of exceptions) {
    const line = 1;
    if (!String(entry.because ?? '').trim()) {
      problems.push(`${entry.file} — dérogation sans raison : une exception muette est un trou.`);
    }
    const result = byFile.get(entry.file);
    if (!result) {
      problems.push(`${entry.file} — dérogation déclarée pour un workflow introuvable dans .github/workflows/.`);
      continue;
    }
    if (!result.judged || result.rules.length === 0) {
      problems.push(
        `${entry.file} — dérogation DEVENUE INUTILE : ce workflow ne vise plus la base de l’école. Retirez l’entrée, elle ne couvre rien.`,
      );
      continue;
    }
    const covered = new Set(entry.covers ?? []);
    const missed = result.rules.filter((rule) => !covered.has(rule));
    const extra = [...covered].filter((rule) => !result.rules.includes(rule));
    if (missed.length) {
      problems.push(
        `${entry.file} — la dérogation ne couvre pas ${missed.join(', ')} : une brèche NON déclarée reste une violation. Élargissez \`covers\` en le justifiant, ou corrigez le workflow.`,
      );
    }
    if (extra.length) {
      problems.push(
        `${entry.file} — la dérogation couvre ${extra.join(', ')} alors que le refus n’existe plus : rétrécissez \`covers\`.`,
      );
    }
    if (!missed.length && !extra.length) {
      tolerated.push({ file: entry.file, rules: result.rules, because: entry.because, line });
    }
  }
  return { problems, tolerated };
}

/**
 * Les violations, une fois les dérogations retirées.
 * @param {{ results: { file: string, findings: object[] }[], exceptions?: typeof EXCEPTIONS }} input
 * @returns {object[]} findings non dérogés
 */
export function violationsOf({ results, exceptions = EXCEPTIONS }) {
  const excused = new Set(exceptions.map((e) => e.file));
  return results.flatMap((r) => (excused.has(r.file) ? [] : r.findings));
}

/**
 * Le rapport imprimable. Pure : l'I/O appartient au point d'entrée.
 *
 * @param {{
 *   results: object[],
 *   scanned: { workflows: number, judged: number, invocations: number },
 *   exceptions?: typeof EXCEPTIONS,
 *   exceptionProblems?: string[],
 *   classificationProblems?: string[],
 *   tolerated?: { file: string, rules: string[], because: string }[],
 *   readOnlyProblems?: string[],
 * }} input
 * @returns {{ lines: { text: string, error: boolean }[], failed: boolean, vacuous: boolean }}
 */
export function formatE2eTargetReport({
  results,
  scanned,
  exceptions = EXCEPTIONS,
  exceptionProblems = [],
  classificationProblems = [],
  tolerated = [],
  readOnlyProblems = [],
}) {
  const lines = [];
  const violations = violationsOf({ results, exceptions });

  for (const v of violations) {
    lines.push({
      error: true,
      text: `❌ ${v.file}:${v.line}${v.step ? ` (étape « ${v.step} »)` : ''} — ${RULE_LABELS[v.rule]} : ${v.detail}`,
    });
  }
  for (const problem of [...exceptionProblems, ...classificationProblems, ...readOnlyProblems]) {
    lines.push({ error: true, text: `❌ ${problem}` });
  }

  // Les jobs qui visent la base réelle par conception sont NOMMÉS, pas passés
  // sous silence : un contrôle ne doit pas rendre invisible ce qu'il ne juge pas.
  const measureJobs = results.filter((r) => !r.judged && r.probes.length > 0).map((r) => r.file);
  if (measureJobs.length) {
    lines.push({
      error: false,
      text: `➖ ${measureJobs.length} job(s) visent la base réelle par conception (mesure déclarée, hors règle E2E) : ${measureJobs.join(', ')}.`,
    });
  }

  for (const entry of tolerated) {
    const labels = entry.rules.map((rule) => RULE_LABELS[rule] ?? rule).join(' · ');
    lines.push({
      error: false,
      text: `⏳ ${entry.file} — dérogation motivée : ${labels}\n   raison : ${entry.because}`,
    });
  }

  const vacuous = scanned.workflows === 0 || scanned.invocations === 0 || scanned.judged === 0;
  if (vacuous) {
    lines.push({
      error: true,
      text:
        `❌ aucun workflow E2E jugé (${scanned.workflows} workflow(s) lu(s), ${scanned.invocations} invocation(s) de script) — ` +
        'un contrôle qui ne juge rien ne prouve rien : vérifiez .github/workflows/ et le classement des scripts.',
    });
    return { lines, failed: true, vacuous: true };
  }

  const problems = violations.length + exceptionProblems.length + classificationProblems.length + readOnlyProblems.length;
  // Le verdict vert est TAIRE quand quelque chose est rouge : « ✅ aucun n’écrit
  // dans la base de l’école » à côté d'une violation est exactement le message
  // mélangé qui apprend à ne plus lire la sortie.
  if (problems === 0) {
    lines.push({
      error: false,
      text:
        `✅ ${scanned.workflows} workflow(s) lu(s), ${scanned.judged} E2E jugé(s) — aucun n’écrit dans la base de l’école` +
        (tolerated.length ? ` (${tolerated.length} dérogation(s) motivée(s) et nommée(s) ci-dessus).` : '.'),
    });
  }
  return { lines, failed: problems > 0, vacuous: false };
}
