# Protéger `main` — ce qui est refusé, ce qui est mesuré

## L'état, mesuré le 2026-11-08

```
GET repos/ibrahimkalilthera/-MAMA/branches/main/protection   → 200
required_pull_request_reviews.required_approving_review_count = 0   (une PR suffit)
required_status_checks.strict                                   = true
required_status_checks.contexts = ["Lint + tests + audit"]
enforce_admins   = true
allow_force_pushes = false
allow_deletions    = false
```

La règle a été posée par l'API avec le **jeton propriétaire** — celui que le
dépôt utilise pour pousser (`.git/github-credentials`, `admin: true` sur ce
dépôt). Le `404` lu auparavant n'était pas un refus de permission : la réponse du
point d'accès est « Branch not protected », c'est-à-dire *aucune règle posée*.
Le compte `gh` de la machine, lui, est en lecture seule
(`viewerPermission: READ`) : ce sont deux comptes distincts.

Ce que la règle refuse maintenant, **pour tous les comptes**, propriétaire
compris :

- un `git push origin main` direct (il faut une branche et une PR) ;
- une fusion dont le check requis n'est pas vert, ni à jour avec `main`
  (`strict: true`) ;
- une réécriture d'historique (`force-push`) et la suppression de la branche.

## La release passe par une PR, elle aussi

`enforce_admins: true` a fait tomber la dernière exception : les commits
`chore(release):`, produits et poussés par le propriétaire, étaient le seul
chemin qui contournait encore les portes. Ils ont désormais le leur.

```bash
npm run release:pr -- --version 1.0.44 --summary "ce que ce numéro embarque"
npm run release:pr -- --dry-run          # décide tout, n'écrit rien
```

Ce que la commande fait :

1. vérifie que `main` local **est** `origin/main` (sinon la PR embarquerait des
   commits qui ne sont pas sur `main`), et que les deux fichiers de version sont
   propres ;
2. refuse un numéro qui n'est pas strictement supérieur à `package.json`, un tag
   `vX.Y.Z` déjà présent sur `origin`, une branche `release/vX.Y.Z` déjà
   existante ;
3. crée `release/vX.Y.Z`, n'y réécrit **que** la ligne de version de
   `package.json` et les deux lignes de `package-lock.json` (CRLF et indentation
   conservés : une release dont le diff fait 10 000 lignes ne se relit pas) ;
4. commite `chore(release): X.Y.Z — …`, pousse la branche, ouvre la PR.

Puis : le check requis passe, la PR est fusionnée — c'est le geste humain qui
reste, et c'est celui qui publie — et **`Desktop release (Windows)` fait le
reste** : `check:release:needed` voit un numéro inédit, construit, signe si
`SIGNING_ENABLED`, téléverse en brouillon, vérifie les octets, promeut, relit le
canal. Aucune autre étape n'existe.

Le jeton utilisé pour ouvrir la PR vient de `GH_TOKEN` / `GITHUB_TOKEN`, sinon du
credential helper de git — le même compte que le push, donc les mêmes droits. Il
n'est jamais imprimé.

## Les gardes restent — ce sont des ceintures, plus des barrières

La règle GitHub est la barrière ; les trois gardes ci-dessous restent parce
qu'une règle peut être retirée, et qu'un retrait silencieux est exactement ce que
ce dépôt refuse.

1. **`.husky/pre-push` → `scripts/check-push-target.mjs`** — refuse le push vers
   `main` *avant qu'il parte*, en nommant le chemin de remplacement. Plus
   d'exception par message : `chore(release):` n'est plus un laissez-passer
   (c'était le dernier). Seul `ALLOW_MAIN_PUSH=1` est une décision annoncée —
   que GitHub refusera de toute façon. Zéro référence lue sur l'entrée standard
   → exit 2, jamais un vert sur du vide.
2. **`.github/workflows/main-direct-push-guard.yml`** — sur chaque push vers
   `main`, demande à l'API les PR associées au commit. Aucune PR → run rouge avec
   le SHA et le message. Réponse illisible → exit 2. La règle est dans
   `scripts/lib/direct-push.mjs`, testée sans réseau, et **n'exempte plus rien**.
3. **`deploy.yml`** — ne déploie que si le workflow de qualité s'est terminé en
   `success` sur `main`, et déploie exactement le commit validé (`head_sha`).

`.husky/post-commit` (la sauvegarde automatique) **saute le push sur `main`** et
le dit : la branche est protégée, le push serait refusé, et payer la chaîne
qualité du `pre-push` pour un refus certain n'apprend rien. Un commit local sur
`main` reste local — il faut le déplacer sur une branche.

## Vérifier que la règle tient

```bash
gh api repos/ibrahimkalilthera/-MAMA/branches/main/protection --jq \
  '{pr: .required_pull_request_reviews.required_approving_review_count,
    strict: .required_status_checks.strict,
    checks: .required_status_checks.contexts,
    admins: .enforce_admins.enabled}'
```

Doit rendre `pr: 0`, `strict: true`, `checks: ["Lint + tests + audit"]`,
`admins: true`.

### Comment la règle se pose — mesuré le 2026-11-08

`PATCH …/protection` avec `{"enforce_admins": true}` rend **404** sur ce dépôt,
alors que `GET` rend **200** : la mise à jour partielle n'existe pas ici. C'est
`PUT …/protection` avec la règle **entière** qui passe (200), et la relecture qui
suit le confirme (`admins: true`). Une commande `PATCH` qui « ne fait rien » sans
le dire est exactement le genre de faux geste que ce document existe pour
éviter : la règle se pose en entier, et se relit.

Clés envoyées : `required_status_checks` (`strict`, un contexte),
`enforce_admins`, `required_pull_request_reviews` (0 approbation, pas de
revue de propriétaire de code), `restrictions: null` (obligatoire),
`allow_force_pushes`, `allow_deletions`, `required_conversation_resolution`.

### Pourquoi un seul check requis, et pas quatre

`Lint + tests + audit` est le **seul** job qui tourne à chaque pull request,
sans filtre de chemins. Les autres gardes du dépôt (migrations, RLS publique,
registre des paiements, dépenses fournisseur, parc) sont filtrés par chemins ou
ne se déclenchent que sur `main` : les exiger bloquerait pour toujours une PR
qui ne touche pas `supabase/**`, parce qu'un check attendu qui ne rapporte
jamais laisse la fusion en attente. `deploy.yml`, lui, attend le verdict de ces
gardes avant de publier — c'est là que leur poids compte.

## Ce qu'un administrateur peut encore faire

`enforce_admins: true` s'applique aux administrateurs du dépôt, pas au droit de
**modifier la règle** : le propriétaire peut toujours l'assouplir, la retirer, ou
fusionner une PR qu'il trouve gênante. Aucun réglage GitHub ne l'en empêche —
c'est le modèle. Ce que le dépôt peut faire, et fait : le garde de CI rougit le
jour où un commit arrive sur `main` sans PR, avec son SHA. Une règle retirée
laisse une trace mesurable au lieu d'un silence.
