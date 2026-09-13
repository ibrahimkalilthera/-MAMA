// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/owner-accounts.mjs — les comptes PROPRIÉTAIRES, et le verdict qui
// dit si l'un d'eux a disparu.
//
// Pourquoi ce module existe (incident mesuré le 2026-09-13) :
//   `ibrahimkalilthera@mamathera.org` — le compte dev, documenté dans ce dépôt
//   depuis le premier jour — **n'existait plus** en base. Personne ne l'avait
//   supprimé volontairement : un script jetable lisait `users[0]` d'une réponse
//   d'API en croyant lire son propre compte (réparé depuis, voir
//   scripts/lib/ephemeral-accounts.mjs). La panne a été découverte au moment où
//   son propriétaire a voulu se connecter — c'est-à-dire trop tard, et par la
//   seule personne qui ne pouvait rien y faire.
//
// Ce module porte donc LA liste des comptes qui doivent exister, avec leur rôle,
// et le verdict pur qui compare une base à cette liste. Il est pur (aucun
// réseau) pour que chaque règle soit éprouvable ; le contrôle qui l'exécute vit
// dans scripts/check-owner-accounts.mjs.
//
// `fantathera2002@mamathera.org` n'est pas dans OWNER_ROLES de
// scripts/audit-user-profiles.mjs (qui ne réaligne que les comptes dont la
// documentation nomme le rôle) : il est néanmoins un compte propriétaire en
// service, administrateur, et c'est l'un des quatre que la base portait. Le
// roster ci-dessous est la liste des comptes EN SERVICE, pas la copie d'une
// autre liste — les deux se recoupent sans se confondre.
// ─────────────────────────────────────────────────────────────────────────────

/** Rôles acceptés par la base (contrainte `user_profiles_role_check`). */
export const KNOWN_ROLES = ['admin', 'staff', 'dev', 'general_manager', 'econome'];

/**
 * Les comptes qui DOIVENT exister, avec le rôle attendu.
 *
 * `required: true` est une garantie : son absence est un échec rouge.
 * `required: false` est un compte historique documenté : s'il est là, il est
 * jugé comme les autres ; s'il est absent, c'est nommé (jamais tu) et sans
 * conséquence — un compte supprimé volontairement ne doit pas faire rougir la
 * surveillance à vie.
 *
 * `passwordEnv` nomme la variable d'environnement qui porte le mot de passe
 * pour le vrai login de CE compte. Aucun mot de passe n'est écrit ici, ni
 * ailleurs dans le dépôt : sans la variable, le login de ce compte est annoncé
 * comme NON MESURÉ (une absence nommée), jamais compté comme un vert.
 */
export const OWNER_ROSTER = [
  {
    email: 'ibrahimkalilthera@mamathera.org',
    role: 'dev',
    label: 'compte dev (propriétaire)',
    required: true,
    passwordEnv: 'OWNER_DEV_PASSWORD',
  },
  {
    email: 'fantathera2002@mamathera.org',
    role: 'admin',
    label: 'administratrice',
    required: true,
    passwordEnv: 'OWNER_ADMIN_PASSWORD',
  },
  {
    email: 'mamadoulaminethera@mamathera.org',
    role: 'general_manager',
    label: 'gestionnaire principal',
    required: true,
    passwordEnv: 'OWNER_GM_PASSWORD',
  },
  {
    email: 'aggeediarra@mamathera.org',
    role: 'staff',
    label: 'personnel',
    required: true,
    passwordEnv: 'OWNER_STAFF_PASSWORD',
  },
  {
    email: 'ibrahimkalilthera@yahoo.com',
    role: 'admin',
    label: 'compte historique (documenté, hors service)',
    required: false,
  },
];

/** L'email réduit à sa forme comparable (la casse n'est pas censée varier). */
const norm = (email) => String(email ?? '').trim().toLowerCase();

/**
 * Les fournisseurs d'identité déclarés par le compte.
 *
 * Mesuré le 2026-09-13 : `GET /auth/v1/admin/users` ne renvoie PAS `identities`
 * dans sa charge utile sur cette version de GoTrue — mais il renvoie
 * `app_metadata.provider`. Lire le seul champ absent aurait déclaré « pas de
 * login par mot de passe » sur les quatre comptes, y compris ceux dont le login
 * venait d'aboutir : une lecture fausse vaut moins que pas de lecture.
 */
const providersOf = (user) => {
  const meta = user?.app_metadata ?? {};
  const list = [];
  if (typeof meta.provider === 'string') list.push(meta.provider);
  if (Array.isArray(meta.providers)) list.push(...meta.providers);
  if (Array.isArray(user?.identities)) list.push(...user.identities.map((i) => i?.provider));
  return list.filter(Boolean).map((p) => String(p).toLowerCase());
};

/** `banned_until` dans le futur = compte suspendu (une date passée est oubliée). */
const isBanned = (user) => {
  const until = user?.banned_until;
  if (!until) return false;
  const at = Date.parse(until);
  return Number.isFinite(at) && at > Date.now();
};

/**
 * Le verdict : la base porte-t-elle tous les comptes propriétaires, dans l'état
 * qui permet de s'y connecter ?
 *
 * @param {{
 *   users?: Array<object>,      // réponse de /auth/v1/admin/users (`users`)
 *   profiles?: Array<object>,   // lignes de user_profiles (id, email, role)
 *   roster?: Array<object>,     // liste attendue (défaut : OWNER_ROSTER)
 * }} input
 * @returns {{
 *   ok: boolean,
 *   problems: string[],
 *   measured: number,           // comptes réellement jugés
 *   absent: string[],           // emails REQUIS introuvables — le rouge
 *   optionalAbsent: string[],   // comptes historiques absents (nommés, pas rouges)
 * }}
 */
export function ownerAccountsVerdict({ users = [], profiles = [], roster = OWNER_ROSTER } = {}) {
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error('ownerAccountsVerdict: roster vide — un contrôle sans liste ne juge rien');
  }
  const byEmail = new Map((Array.isArray(users) ? users : []).map((u) => [norm(u?.email), u]));
  const roleById = new Map((Array.isArray(profiles) ? profiles : []).map((p) => [p?.id, p]));
  const problems = [];
  const absent = [];
  const optionalAbsent = [];
  let measured = 0;

  for (const entry of roster) {
    const email = norm(entry?.email);
    const user = byEmail.get(email);

    if (!user) {
      if (entry.required) {
        absent.push(email);
        problems.push(
          `« ${email} » (${entry.label}) est ABSENT de la base — c'est l'incident du 2026-09-13 : ` +
            `le compte dev avait été supprimé par un script jetable, et personne ne l'a su avant lui`,
        );
      } else {
        optionalAbsent.push(email);
      }
      continue;
    }

    measured += 1;
    // Un compte présent mais inutilisable est un faux vert : on juge l'état,
    // pas seulement la présence.
    if (user.deleted_at) problems.push(`« ${email} » est supprimé en douceur (deleted_at=${user.deleted_at})`);
    if (!user.email_confirmed_at) problems.push(`« ${email} » n'est pas confirmé (email_confirmed_at vide)`);
    if (isBanned(user)) problems.push(`« ${email} » est suspendu jusqu'à ${user.banned_until}`);
    const providers = providersOf(user);
    if (providers.length === 0) {
      // Refus de conclure plutôt que faux vert : la réponse ne dit plus par quel
      // moyen ce compte se connecte, donc ce contrôle ne peut plus le prouver.
      problems.push(
        `« ${email} » : la réponse de l’API ne déclare aucun fournisseur d’identité — ` +
          `le login par mot de passe ne peut pas être prouvé (forme de réponse changée ?)`,
      );
    } else if (!providers.includes('email')) {
      problems.push(
        `« ${email} » ne se connecte pas par mot de passe (fournisseurs : ${providers.join(', ')}) — ` +
          `le roster attend un login email + mot de passe`,
      );
    }

    const profile = roleById.get(user.id);
    if (!profile) {
      problems.push(`« ${email} » n'a pas de ligne user_profiles (le trigger aurait dû la créer)`);
    } else if (profile.role !== entry.role) {
      problems.push(
        `« ${email} » porte le rôle « ${profile.role} » au lieu de « ${entry.role} » — ` +
          `les pouvoirs du compte ne sont plus ceux que la documentation déclare`,
      );
    }
  }

  return { ok: problems.length === 0, problems, measured, absent, optionalAbsent };
}

/**
 * Le verdict d'un vrai login (`POST /auth/v1/token?grant_type=password` avec la
 * clé anon — le chemin exact de l'application).
 *
 * @param {{ ok?: boolean, status?: number, body?: object, label?: string }} probe
 * @returns {{ ok: boolean, problem: string|null, tokenIssued: boolean }}
 */
export function loginProbeVerdict({ ok = false, status = 0, body = {}, label = 'login' } = {}) {
  const tokenIssued = !!(body?.access_token && body?.user?.id);
  if (ok && tokenIssued) return { ok: true, problem: null, tokenIssued: true };
  const detail =
    body?.error_description || body?.msg || body?.error || (body?._nonJson ? 'réponse non-JSON' : `HTTP ${status}`);
  return {
    ok: false,
    problem: `${label} refusé par l'authentification (${detail}) — une base joignable mais un login cassé serait invisible`,
    tokenIssued: false,
  };
}
