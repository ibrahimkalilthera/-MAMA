// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/rls-coverage.mjs — TOUTES les tables de `public` portent-elles RLS ?
//
// ─── Le fait mesuré, le 2026-10-11 ──────────────────────────────────────────
// `20261005000001_dedupe_students.sql` fabrique
// `public.students_dupe_backup_20261005` (`create table … as select … where
// false`) et y copie les fiches condamnées — la réversibilité du dédoublonnage,
// et une bonne idée. Puis elle laisse la suppression en COMMENTAIRE (« drop
// table … une fois le nettoyage confirmé »). Un `create table as` n'active pas
// RLS, et les privilèges par défaut de Supabase ouvrent `select` au rôle `anon`,
// celui dont la clé est inlinée dans le bundle du site. Résultat mesuré depuis
// l'extérieur, avec cette clé PUBLIQUE : la table a rendu ses 14 lignes, dont
// `name`, `parent_phone`, `medical_notes` — des données personnelles de mineurs.
//
// ─── Pourquoi les gardes existantes ne pouvaient pas le voir ────────────────
// `scripts/verify-anon-rls.mjs` (CI + veille quotidienne `prod-anon-rls`) sonde
// les tables qu'une LISTE DÉCLARE, liste extraite des migrations par
// `scripts/lib/schema-expected.mjs`. C'est solide et ça reste : mais un
// mécanisme qui vérifie ce qu'on lui nomme est muet sur ce qu'on ne lui a pas
// nommé. La classe entière — « une table existe dans public sans RLS » — ne se
// ferme qu'en ÉNUMÉRANT le catalogue, sans liste à maintenir.
//
// ─── Ce que ce module refuse, et ce qu'il se contente de dire ───────────────
// Refusé : une table (ou une partition de table) de `public` dont
// `relrowsecurity` est faux. C'est le trou mesuré, et il n'y a pas de cas
// légitime : l'application parle à PostgREST avec `anon`/`authenticated`, donc
// une table sans RLS est lisible par la clé publique du site.
//
// Dit, jamais refusé (mais jamais tu non plus) :
//   • `sealed` — RLS activée et AUCUNE politique : la table est inaccessible au
//     client, ce qui est sûr mais doit se savoir. Mesuré aujourd'hui :
//     `student_matricule_counters`, atteinte seulement par une fonction
//     `security definer`. Une table scellée qu'on croit ouverte est un défaut,
//     pas une brèche — la refuser ferait rougir un état sain ;
//   • `unjudged` — les relations où RLS ne s'applique pas : vues, vues
//     matérialisées, tables étrangères. Une vue SANS `security_invoker` lit ses
//     tables avec les droits de son propriétaire, qui contourne RLS : refuser
//     ces relations demanderait une liste d'exceptions par construction, et
//     l'état mesuré n'en porte aucune (0 vue, 0 table étrangère). Elles sont
//     donc NOMMÉES avec leur raison, pour qu'un jour où il en apparaît une, le
//     rapport le dise au lieu de l'avaler.
//
// ─── L'état d'aujourd'hui, et donc la preuve de vie du contrôle ─────────────
// Après la suppression de l'artefact : 15 tables dans `public`, les 15 avec RLS,
// 0 vue. Ce contrôle naît donc VERT. Sa preuve de vie n'est pas la couleur du
// jour — c'est `tests/public-rls.test.ts`, qui l'exerce ROUGE sur un catalogue
// reconstitué, et qui l'exerce aussi à vide (zéro relation lue n'est pas un
// vert, c'est « je n'ai pas pu regarder »).
//
// ─── Ce que ce module ne juge pas ──────────────────────────────────────────
// Les POLITIQUES. `relrowsecurity` vrai ne dit pas que la politique laisse
// passer les bonnes lignes — c'est le métier de `verify-anon-rls.mjs`, qui
// éprouve le refus sur des tables nommées et des lignes réelles. Ici on ne juge
// que la présence du verrou. Le dire fait partie du contrat : un contrôle qui
// laisse croire qu'il a tout vérifié est le faux vert que ce dépôt pourchasse.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'énumération du catalogue : ce que `public` contient, et sous quel régime.
 *
 * `pg_class` et non `information_schema.tables` : les vues matérialisées et les
 * tables étrangères n'ont pas de ligne dans `information_schema.tables` (une
 * matview n'y est pas une table, une foreign table non plus), donc une
 * énumération bâtie là-dessus les aurait ignorées — le silence exact que ce
 * contrôle existe pour supprimer. `pg_class` porte aussi l'état RLS, ce qui évite
 * de relier deux catalogues dont les jointures se trompent.
 *
 * Le comptage des politiques se fait sur `pg_policies`, donc pour le schéma
 * `public` : une table scellée (0 politique) se distingue d'une table gardée, et
 * c'est une information qu'un `relrowsecurity` seul ne donne pas.
 *
 * Le tri par nom rend deux exécutions du même état comparables — la même raison
 * que partout ailleurs dans ce dépôt.
 */
export const PUBLIC_RELATIONS_SQL = `
  select c.relname as name,
         c.relkind as kind,
         c.relrowsecurity as rls,
         c.relforcerowsecurity as force_rls,
         pg_get_userbyid(c.relowner) as owner,
         (select count(*)::int
            from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) as policies,
         coalesce((select e.extname
                     from pg_depend d
                     join pg_extension e on e.oid = d.refobjid
                    where d.objid = c.oid and d.deptype = 'e'
                    limit 1), '') as extension
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
   order by c.relname
`;

/** Les `relkind` jugés : tables ordinaires et tables partitionnées. */
export const JUDGED_KINDS = ['r', 'p'];

/**
 * Les `relkind` NON jugés, chacun avec sa raison — jamais une omission muette.
 *
 * Les partitions d'une table partitionnée (`relkind` `r`, `relispartition` vrai)
 * restent JUGÉES : une partition est une table, elle a son propre
 * `relrowsecurity`, et une partition qu'on interroge directement est gouvernée
 * par le sien.
 */
export const UNJUDGED_REASONS = {
  v: 'RLS ne s’applique pas à une vue : ce sont ses tables de base qui portent le verrou. Une vue SANS `security_invoker` lit avec les droits de son propriétaire, qui contourne RLS — à examiner à la main si elle apparaît.',
  m: 'RLS ne s’applique pas à une vue matérialisée : elle recopie ses lignes dans son propre stockage, donc la protection de sa source ne la couvre plus.',
  f: 'RLS n’est pas applicable par cette base à une table étrangère : ses lignes vivent sur un autre serveur.',
};

/** Le libellé d'un `relkind`, pour qu'un rapport se lise sans décodeur. */
export const KIND_LABELS = {
  r: 'table',
  p: 'table partitionnée',
  v: 'vue',
  m: 'vue matérialisée',
  f: 'table étrangère',
};

/**
 * Le jugement : quelles relations sont ouvertes, scellées, non jugées — et si
 * les exemptions tiennent debout.
 *
 * Les exemptions sont bornées DANS LES DEUX SENS, comme les autres de ce dépôt
 * (`scripts/lib/e2e-writes.mjs`) : une exemption sans raison est un trou, et une
 * exemption qui ne correspond plus au réel — table absente, ou table qui porte
 * désormais RLS — doit être abaissée, sinon elle autoriserait un retour en
 * arrière silencieux. Il n'y en a AUCUNE aujourd'hui : le refus ne connaît pas
 * de cas légitime, et le premier qui en réclamera une devra s'écrire ici.
 *
 * @param {{
 *   relations?: { name?: string, kind?: string, rls?: unknown, policies?: unknown, owner?: unknown }[],
 *   exemptions?: { name?: string, reason?: string }[],
 * }} [input]
 * @returns {{
 *   scanned: number, judged: number, totalPolicies: number, vacuous: boolean, ok: boolean,
 *   guarded: { name: string, policies: number }[],
 *   unguarded: { name: string, kind: string, label: string, owner: string, policies: number }[],
 *   sealed: { name: string, label: string, policies: number }[],
 *   unjudged: { name: string, kind: string, label: string, reason: string }[],
 *   exempted: { name: string, reason: string }[],
 *   problems: string[],
 * }}
 */
export function judgePublicRls({ relations = [], exemptions = [] } = {}) {
  const problems = [];
  const exempted = [];
  /** @type {Map<string, { rls: boolean, kind: string }>} */
  const known = new Map();
  for (const relation of relations) {
    const name = String(relation?.name ?? '');
    if (!name) continue;
    const kind = String(relation?.kind ?? 'r');
    // La table est-elle GARDÉE ? `pg` rend un booléen pour `relrowsecurity`, mais
    // une ligne recopiée depuis un JSON peut porter « true » : le contrôle lit
    // les deux formes plutôt que de laisser une chaîne passer pour un faux.
    const rls = relation?.rls === true || relation?.rls === 'true';
    known.set(name, { rls, kind });
  }

  for (const exemption of exemptions) {
    const name = String(exemption?.name ?? '').trim();
    const reason = String(exemption?.reason ?? '').trim();
    if (!name) {
      problems.push('une exemption sans nom ne peut pas être vérifiée');
      continue;
    }
    if (!reason) {
      problems.push(`« ${name} » est exemptée sans raison — une exemption muette est un trou.`);
      continue;
    }
    const found = known.get(name);
    if (!found) {
      problems.push(`« ${name} » est exemptée mais n’existe pas dans public — une exemption périmée autorise un retour en arrière silencieux.`);
      continue;
    }
    if (found.rls) {
      problems.push(`« ${name} » est exemptée alors qu’elle porte RLS — une exemption qui ne correspond plus au réel doit être abaissée.`);
      continue;
    }
    exempted.push({ name, reason });
  }
  const exemptNames = new Set(exempted.map((entry) => entry.name));

  const guarded = [];
  const unguarded = [];
  const sealed = [];
  const unjudged = [];
  let totalPolicies = 0;
  let scanned = 0;
  let judged = 0;

  for (const relation of relations) {
    const name = String(relation?.name ?? '');
    if (!name) continue;
    scanned += 1;
    const kind = String(relation?.kind ?? 'r');
    const label = KIND_LABELS[kind] ?? `relation « ${kind} »`;
    if (!JUDGED_KINDS.includes(kind)) {
      unjudged.push({ name, kind, label, reason: UNJUDGED_REASONS[kind] ?? 'relation non jugée par ce contrôle' });
      continue;
    }
    // Une table exemptée reste une table JUGÉE : elle a été regardée, et c'est
    // une décision qui l'a laissée ouverte. La compter avec les autres évite le
    // rapport trompeur « 15 tables jugées » sur une base qui en porte seize.
    judged += 1;
    const policies = Number(relation?.policies ?? 0);
    totalPolicies += Number.isFinite(policies) ? policies : 0;
    const rls = relation?.rls === true || relation?.rls === 'true';
    if (!rls) {
      if (exemptNames.has(name)) continue; // exemptée en connaissance de cause, et rapportée comme telle
      unguarded.push({
        name,
        kind,
        label,
        owner: String(relation?.owner ?? ''),
        policies: Number.isFinite(policies) ? policies : 0,
      });
      continue;
    }
    if (policies === 0) sealed.push({ name, label, policies: 0 });
    else guarded.push({ name, policies });
  }

  // Le tri par nom, ici et non seulement dans la requête : deux appels sur le
  // même état doivent rendre le même rapport, quel que soit l'ordre des lignes
  // que l'appelant a fournies — sinon deux exécutions ne se comparent pas.
  const byName = (a, b) => a.name.localeCompare(b.name);
  guarded.sort(byName);
  unguarded.sort(byName);
  sealed.sort(byName);
  unjudged.sort(byName);

  return {
    scanned,
    judged,
    totalPolicies,
    // Une énumération VIDE n'est pas un état sain : c'est un regard qui n'a rien
    // atteint (mauvaise base, catalogue illisible, requête cassée). Le contrôle
    // s'en sert pour sortir en 2 — « je n'ai pas pu regarder » — jamais en 0.
    vacuous: relations.length === 0,
    // `ok` ne peut pas être vrai sur un regard vide : c'est le faux vert que ce
    // module existe pour supprimer — « aucune table ouverte » et « je n'ai rien
    // lu » ne s'écrivent pas de la même façon dans un journal.
    ok: relations.length > 0 && unguarded.length === 0 && problems.length === 0,
    guarded,
    unguarded,
    sealed,
    unjudged,
    exempted,
    problems,
  };
}
