# Protéger `main` — ce qui est refusé, ce qui est mesuré

## Le fait, mesuré le 2026-11-08

```
gh api repos/ibrahimkalilthera/-MAMA/branches/main/protection      → 404
gh api -X PUT …/branches/main/protection --input prot.json          → 404
```

Les deux appels sont refusés **avant** toute question de contenu : le jeton
utilisé (compte d'automatisation) n'a pas le droit d'administration sur le
dépôt, ou l'offre GitHub ne l'ouvre pas. Ce n'est pas un réglage à corriger dans
le code : seul un propriétaire du dépôt peut l'activer.

Conséquence concrète : un `git push origin main` contourne **toutes** les portes
de ce dépôt — `lint`, `npm test`, les contrôles RLS, la cohérence de release —
sans qu'aucune ne soit exécutée avant l'arrivée du commit.

## Ce qui a été mis en place à la place

`.github/workflows/main-direct-push-guard.yml` s'exécute sur **chaque push vers
`main`**. Il demande à l'API GitHub les pull requests associées au commit :

- au moins une PR → vert, avec le SHA et le numéro ;
- aucune PR, et un message qui ne commence pas par `chore(release):` → **rouge**,
  avec le SHA et la marche à suivre ;
- réponse illisible (API indisponible, jeton absent) → **exit 2**, pas un vert
  fabriqué.

La règle est dans `scripts/lib/direct-push.mjs` (testée sans réseau dans
`tests/direct-push.test.ts`).

Ce garde **ne bloque pas** le push : il le rend visible après coup. C'est la
différence entre une règle écrite et une règle mesurée, mais ce n'est pas la
protection elle-même.

## Ce que le propriétaire doit faire (5 minutes, une fois)

1. Settings → Branches → **Add branch protection rule** pour `main`.
2. Cocher **Require a pull request before merging** (0 approbation suffit pour
   une équipe d'une personne).
3. Cocher **Require status checks to pass before merging** et sélectionner les
   jobs qui portent déjà les portes : `quality` (Quality guards), `lighthouse`
   (perf-guard), `provenance` (ce garde), et le job de déploiement Vercel.
4. Cocher **Require conversation resolution** et décocher **Allow force pushes**
   / **Allow deletions**.
5. Vérifier : `gh api repos/ibrahimkalilthera/-MAMA/branches/main/protection`
   doit rendre `200` avec `required_pull_request_reviews` non nul.

Si l'offre GitHub refuse la règle (dépôt privé sans plan payant), la seule
protection restante est ce garde — et la discipline de ne pas pousser sur `main`.
