# Protéger `main` — ce qui est refusé, ce qui est mesuré

## L'état, mesuré le 2026-11-08

```
GET repos/ibrahimkalilthera/-MAMA/branches/main/protection   → 200
required_pull_request_reviews.required_approving_review_count = 0   (une PR suffit)
required_status_checks.strict                                   = true
required_status_checks.contexts = ["Lint + tests + audit"]
enforce_admins   = false
allow_force_pushes = false
allow_deletions    = false
```

La règle a été posée par l'API avec le **jeton propriétaire** — celui que le
dépôt utilise déjà pour pousser (`.git/github-credentials`, `admin: true` sur ce
dépôt). Le `404` qui avait été lu auparavant n'était pas un refus de
permission : la réponse du point d'accès est « Branch not protected », c'est-à-
dire *aucune règle posée*. Le compte `gh` de la machine, lui, est en lecture
seule (`viewerPermission: READ`) : c'est ce jeton-là qui ne peut ni poser la
règle, ni fusionner, ni relancer un job. Ce sont deux comptes distincts.

Ce que la règle refuse maintenant, pour tout compte non administrateur :

- un `git push origin main` direct (il faut une branche et une PR) ;
- une fusion dont le check requis n'est pas vert, ni à jour avec `main`
  (`strict: true`) ;
- une réécriture d'historique (`force-push`) et la suppression de la branche.

## Ce que la règle ne refuse PAS — et qui reste couvert

`enforce_admins: false`. Un administrateur — le propriétaire, c'est-à-dire le
compte qui pousse réellement dans ce dépôt — peut encore pousser directement sur
`main`. C'est un choix assumé : les commits `chore(release):` sont produits et
poussés par cette même personne, et les bloquer casserait le canal de release
sans qu'un autre compte puisse fusionner à sa place (0 approbation requise, mais
GitHub interdit d'approuver sa propre PR).

Trois gardes couvrent donc ce chemin d'administrateur, du plus tôt au plus tard :

1. **`.husky/pre-push` → `scripts/check-push-target.mjs`** — refuse le push
   *avant qu'il parte*. Exception nommée : un commit de tête
   `chore(release):`, ou `ALLOW_MAIN_PUSH=1` (décision annoncée, pas un oubli).
   Zéro référence lue sur l'entrée standard → exit 2, jamais un vert sur du vide.
   Ne survit pas à `git push --no-verify` ni à `HUSKY=0`.
2. **`.github/workflows/main-direct-push-guard.yml`** — sur chaque push vers
   `main`, demande à l'API les PR associées au commit. Aucune PR et pas un
   `chore(release):` → run rouge avec le SHA. Réponse illisible → exit 2.
   La règle est dans `scripts/lib/direct-push.mjs`, testée sans réseau.
3. **`deploy.yml`** — ne déploie que si le workflow de qualité s'est terminé en
   `success` sur `main`, et déploie exactement le commit validé (`head_sha`).

## Vérifier que la règle tient

```bash
gh api repos/ibrahimkalilthera/-MAMA/branches/main/protection --jq \
  '{pr: .required_pull_request_reviews.required_approving_review_count,
    strict: .required_status_checks.strict,
    checks: .required_status_checks.contexts,
    admins: .enforce_admins.enabled}'
```

Doit rendre `pr: 0`, `strict: true`, le contexte ci-dessus, `admins: false`.

### Pourquoi un seul check requis, et pas quatre

`Lint + tests + audit` est le **seul** job qui tourne à chaque pull request,
sans filtre de chemins. Les autres gardes du dépôt (migrations, RLS publique,
registre des paiements, dépenses fournisseur, parc) sont filtrés par chemins ou
ne se déclenchent que sur `main` : les exiger bloquerait pour toujours une PR
qui ne touche pas `supabase/**`, parce qu'un check attendu qui ne rapporte
jamais laisse la fusion en attente. `deploy.yml`, lui, attend le verdict de ces
gardes avant de publier — c'est là que leur poids compte.

## Passer à `enforce_admins: true` (plus tard, pas maintenant)

Le jour où les releases passent elles aussi par une PR, la règle peut être
durcie sans casser personne :

```bash
gh api -X PATCH repos/ibrahimkalilthera/-MAMA/branches/main/protection \
  -F enforce_admins=true
```

Ce jour-là, le `pre-push` et le garde de CI deviennent des ceintures de plus
plutôt que la seule barrière — et l'exception `chore(release):` du garde de CI
devient sans objet.
