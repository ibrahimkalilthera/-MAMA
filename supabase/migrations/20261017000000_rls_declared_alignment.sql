-- Migration: aligner la base sur ce que le dépôt DÉCLARE — trois tables, cinq
--            politiques héritées retirées et deux politiques déclarées posées.
--            Aucun droit ne change : c'est un RENOMMAGE et une DÉDUPLICATION,
--            mesurés avant et après, commande par commande.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
-- `npm run check:rls-policies` nommait NEUF écarts entre les politiques que les
-- migrations déclarent et celles que `pg_policies` porte. Quatre étaient des
-- MANQUES, cinq des politiques qu'AUCUNE migration ne déclare ni ne retire :
--
--   academic_years   « Allow authenticated read access on academic_years »
--                    (SELECT) et « Allow admin write access on academic_years »
--                    (ALL) — déclarées par 20260820000000, ABSENTES en base ;
--   academic_years   « Authenticated read academic_years » (SELECT,
--                    `authenticated`, `true`) et « Admin manage academic_years »
--                    (ALL, `authenticated`, `USING is_admin()` /
--                    `WITH CHECK is_admin()`) — EN BASE, déclarées par rien ;
--   user_profiles    « Users can read own profile or admin reads all » (SELECT,
--                    `(id = auth.uid()) OR is_admin()`) et « Admin can update
--                    profiles » (UPDATE, `authenticated`, `is_admin()`) —
--                    EN BASE, déclarées par rien ;
--   todos            « Authenticated users can manage todos » (ALL,
--                    `authenticated`, `USING true` / `WITH CHECK true`) —
--                    EN BASE, déclarée par rien ;
--   custom_grades    « Authenticated read custom grades » (SELECT) et
--                    « Authenticated insert custom grades » (INSERT) —
--                    déclarées par 20260828000002/3.
--
-- ─── CE QUE CETTE MIGRATION NE RÉPARE PAS, ET POURQUOI ─────────────────────
-- Les deux « manques » de `custom_grades` ne sont PAS des droits à écrire : la
-- table est RETIRÉE par `20260828000004_custom_classes.sql` (bloc `DO $$ … $$`
-- conditionnel : ses lignes sont migrées vers `custom_classes`, puis
-- `DROP TABLE public.custom_grades`). Le dépôt ne peut donc pas vouloir ces deux
-- politiques — elles étaient le fait d'avant le retrait de la table, et le
-- contrôle qui les réclamait ne regardait pas les `DROP TABLE` de son propre
-- corpus. C'est LUI qui a été corrigé (`scripts/lib/rls-policies.mjs` : une table
-- retirée par une migration ne réclame plus les politiques qu'elle déclarait
-- avant), ses cas sont dans `tests/rls-policies.test.ts` et les deux noms sont
-- figés dans `tests/rls-declared-alignment.test.ts`. Recréer la table pour y
-- poser deux politiques que le dépôt a lui-même retirées aurait été le contraire
-- d'une réparation.
--
-- ─── CE QUI EST MESURÉ AVANT D'ÉCRIRE ──────────────────────────────────────
-- Une politique PERMISSIVE ne dit pas qui passe : c'est l'UNION de toutes celles
-- de la table. La carte des ÉCRITURES a donc été mesurée sur la base réelle,
-- rôle par rôle, dans des transactions ANNULÉES (`SET LOCAL ROLE authenticated`
-- + les deux claims JWT, ce que PostgREST pose) — AVANT cette migration, puis
-- APRÈS son application : les deux cartes sont IDENTIQUES (voir
-- `DEVELOPMENT_HISTORY.md` pour le relevé). Les cinq retraits sont des
-- DÉDUPLICATIONS :
--
--   academic_years   « Authenticated read academic_years »   ≡ « Allow
--                      authenticated read access on academic_years »
--                      (`authenticated`, SELECT, `USING true`) : même règle,
--                      même commande, mêmes rôles — un renommage, pas un droit ;
--                    « Admin manage academic_years »         ≡ « Allow admin
--                      write access on academic_years »
--                      (`authenticated`, ALL, `USING is_admin()` /
--                      `WITH CHECK is_admin()`) : idem. L'écran qui entretient
--                      l'année courante (`src/lib/dataOps/academicYears.ts`) ne
--                      l'essaie déjà que pour `admin` / `dev` : inchangé.
--   user_profiles    « Users can read own profile or admin reads all »
--                    ≡ « Users can view own profile » (`USING (auth.uid() = id)
--                    OR is_admin()`), DÉCLARÉE et portée par la base depuis
--                    20260809000000 : le retrait ne ferme rien, l'homologue
--                    déclaré est de la MÊME règle et d'une audience PLUS LARGE
--                    (`public`, la condition gardant le seuil).
--                    « Admin can update profiles » ≡ « Admins can update
--                    profiles » (`USING is_admin()`) : idem — et sur un UPDATE
--                    sans `WITH CHECK`, la condition de lecture s'applique aussi
--                    à la ligne écrite, exactement comme le double `is_admin()`
--                    de la version héritée.
--   todos            « Authenticated users can manage todos » (`ALL`,
--                    `authenticated`, `true`) est couverte commande par
--                    commande par les QUATRE politiques déclarées de
--                    20260809000000 — « Authenticated read / insert / update /
--                    delete todos » (`auth.role() = 'authenticated'`) : `SELECT`,
--                    `INSERT`, `UPDATE` et `DELETE` y ont chacun leur règle, donc
--                    le `ALL … true` n'ajoutait rien à un compte connecté.
--
-- ⚠️ Ce qui RESTE ouvert sur ces tables est un CHOIX, et il est nommé : `todos`
-- reste lisible et écrit par tout compte connecté (le carnet de tâches est
-- partagé par le secrétariat), et `user_profiles` reste lisible par son
-- propriétaire ou par un administrateur. Rien n'est resserré ici : les deux
-- politiques posées ci-dessous sont copiées MOT POUR MOT de
-- 20260820000000_academic_year_promotions.sql, ce que la suite vérifie champ par
-- champ (commande, rôles, `USING`, `WITH CHECK`).
--
-- ─── REJOUABILITÉ ───────────────────────────────────────────────────────────
-- Les deux noms que cette migration POSE sont retirés avant d'être posés, comme
-- les hérités : un fichier appliqué deux fois ne s'interrompt pas sur un
-- « policy already exists », et un rejeu laisse l'état décrit ci-dessus.

-- ─── 1. academic_years : les deux noms hérités → les deux noms DÉCLARÉS ─────
DROP POLICY IF EXISTS "Authenticated read academic_years" ON public.academic_years;
DROP POLICY IF EXISTS "Admin manage academic_years" ON public.academic_years;

DROP POLICY IF EXISTS "Allow authenticated read access on academic_years" ON public.academic_years;
CREATE POLICY "Allow authenticated read access on academic_years"
    ON public.academic_years FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin write access on academic_years" ON public.academic_years;
CREATE POLICY "Allow admin write access on academic_years"
    ON public.academic_years FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ─── 2. user_profiles : deux doublons hérités des politiques déclarées ──────
-- Restent : « Users can view own profile » (SELECT), « Admins can insert /
-- update / delete profiles » (`is_admin()`) — les quatre que 20260809000000
-- déclare, et que la base porte déjà.
DROP POLICY IF EXISTS "Users can read own profile or admin reads all" ON public.user_profiles;
DROP POLICY IF EXISTS "Admin can update profiles" ON public.user_profiles;

-- ─── 3. todos : le `ALL … true` hérité, couvert par les quatre déclarées ────
-- Restent : « Authenticated read / insert / update / delete todos ».
DROP POLICY IF EXISTS "Authenticated users can manage todos" ON public.todos;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
