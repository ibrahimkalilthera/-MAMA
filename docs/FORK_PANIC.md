# Fork-panic msys — runbook unique

Ce document est **le** point d'entrée pour la panique de fork msys : symptômes,
quel mécanisme couvre quoi, décision en une commande, récupération manuelle.
Il consolide les entrées éparpillées de `DEVELOPMENT_HISTORY.md` (listées en §7),
qui restent la trace datée des mesures — le runbook, lui, décrit l'état **actuel**.

---

## 0. Les trois commandes, d'abord

```bash
node -e "console.log('ok')"          # la panique est-elle ACTIVE là, maintenant ?
npm run orphans:doctor               # état machine : orphelins, gardes, hooks (lecture seule)
npm run orphans:report               # fréquence : purges et panics journalisées
```

Si la sonde affiche `ok`, la panique n'est **pas** active : reprendre le travail.
Si elle échoue (exit 254/66, `fork: Resource temporarily unavailable`,
`uv_spawn: EUNKNOWN`), aller en §5 (récupération manuelle).

## 1. Symptômes

Git Bash (msys) entre périodiquement dans un état où **toute** commande externe
échoue :

| Symptôme | Ce qu'on voit |
|---|---|
| Fork impossible | `fork: Resource temporarily unavailable` — exit **254** sur une ligne multi-commandes, exit **66** même pour `node -e "console.log('ok')"` |
| Spawn node impossible | `uv_spawn: EUNKNOWN`, `Cannot allocate memory` |
| Hook git qui avorte | `git commit`/`git push` échouent en pleine chaîne qualité, code de sortie de panique |
| PowerShell qui ne démarre plus | un sweep qui ne rapporte rien (et non « rien à purger ») |
| bash lui-même | des messages `child_copy: cygheap read copy failed` / `dofork: child -1` en tête des commandes |

Ce que la panique **ne fait jamais** : toucher l'arbre de travail. `git status
--porcelain` doit être identique à avant — vérification obligatoire en §5.

## 2. Ce qu'on sait de la cause (mesuré, et corrigé)

La théorie historique — « un `node.exe` orphelin survit à un timeout dur et garde
la table de fork » — a été **corrigée par la mesure** (2026-09-11) :

- un enfant node **non détaché** meurt avec son parent : **9 descendants sur 9**
  disparus en 500 ms après un `taskkill /PID <racine> /F` (sans `/T`), et
  identiquement après `Stop-Process -Force` — comportement Windows documenté de
  Node (`detached: true` est la seule façon de survivre), que libuv obtient par
  un job object ;
- les restes **réellement** atteignables sont donc (a) les enfants **détachés**
  (sonde réelle : 1 survivant sur 4, purgé depuis) et (b) les **wrappers dont le
  parent non-node est mort** — le `sh.exe` d'un hook git tué par la panique
  laisse le node qu'il avait lancé porter la chaîne entière ;
- à côté des node.exe, la pression vient aussi des **chrome/electron restants**
  (mesuré : **32** processes sur ce poste, 2026-09-11) — la chaîne qualité les
  purge avant sa première étape, et le docteur les compte.

Conclusion assumée : la cause racine n'est pas identifiée ; ce qui est identifié,
c'est **où la pression se voit** et **ce qui la retire**. Le journal
(`npm run orphans:report`) est le décompte officiel : au dernier relevé, **aucune
panique sur 24 h**.

## 3. Quel mécanisme couvre quoi

| Mécanisme | Fichier | Couvre | Ne couvre pas |
|---|---|---|---|
| Retry sur signature | `scripts/git-retry.mjs` (`runCommandWithRetry`) | une panique **pendant** la commande lancée (git, chaîne qualité), bornée, un échec réel n'est jamais retenté | une panique qui frappe bash **avant** node (le `sh` du hook) |
| Shim natif `git.cmd` | `scripts/git-shim.cmd`, `scripts/install-git-shim.mjs` | la frontière git → hook : `commit`/`push`/`pull`/`rebase` rejoués **sans fork msys** (cmd.exe → node → CreateProcess) | **inactif** tant que son dossier n'est pas en tête du PATH *machine* (droits admin) ; Git Bash et les outils qui spawn `git.exe` sans shell l'ignorent → `npm run git:retry -- …` |
| Hooks câblés sur le moteur | `.husky/pre-commit`, `.husky/pre-push` → `scripts/hook-quality-chain.mjs` | une panique **au milieu de la chaîne** (commit **et** push), avec purge entre les tentatives | un hook désactivé (`--no-verify`, `HUSKY=0`, `core.hooksPath` détourné, ou lanceur husky manquant) — `npm run orphans:doctor` le dit |
| Sweep sélectif | `--sweep`, `sweep: true` du hook | les orphelins **reconnus** de la chaîne qualité (parent disparu ou périmé) — jamais un node.exe légitime | un orphelin que le filtre ne reconnaît pas → `--sweep-all` |
| Sweep élargi | `--sweep-all` | **tout** `node.exe` orphelin au sens strict (**parent disparu**) | jamais un processus à parent vivant (un dev server de 10 min n'est pas touché) |
| Purge par lignée (fin de chaîne) + garde détaché | `scripts/lib/orphan-node.mjs`, `scripts/lib/orphan-guard.mjs` | ce que **cette** exécution a créé, sur **tous** les chemins de sortie (fin, échec, `SIGINT`/`SIGTERM`, kill externe via le garde) | ce qui est né dans la dernière fenêtre de relevé du garde (≤ 10 s) |
| Retry du spawn PowerShell | `scripts/lib/orphan-chrome.mjs` | un spawn powershell manqué qui aurait rendu un sweep **silencieusement inutile** | — |
| Journal, rapport, docteur | `scripts/lib/orphan-node.mjs`, `scripts/sweep-report.mjs`, `scripts/panic-doctor.mjs` | mesurer : fréquence des panics, purges (zéros compris), état machine | ne répare **rien** (lecture seule, garanti par test) |
| Résolution explicite des outils de la chaîne | `scripts/lib/chain-links.mjs` | les maillons de `lint:chain`, `test` et `build` : programme **absolu** (l'entrée `bin` du paquet installé, lue et non devinée) pour le node épinglé — aucun shell, aucun npm, donc aucun ordre de `PATH` à tenir | les **entrées** npm lancées avec un shell (`npm run lint`, `npm test`) et les shells interactifs : là c'est le `PATH` qui décide, et c'est `node_modules/.bin` qui porte le pin (`scripts/lib/bin-shims.mjs`) |
| Chaîne spawn-only + watchdog | `scripts/quality-chain.mjs` | un run lent ne bloque ni ne sature la table de fork (kill d'arbre par étape, aucun shell) | n'aide pas si la chaîne est tuée de l'extérieur → garde détaché |

## 4. Décision

| Situation | Commande |
|---|---|
| Tout va bien, je veux l'état | `npm run orphans:doctor` |
| Je veux la fréquence historique | `npm run orphans:report -- --last 20` |
| Un commit/push vient d'échouer sur `fork:` | relancer (`npm run git:retry -- --sweep -- push origin main`) — le retry a déjà tenté |
| Je soupçonne des orphelins maintenant | `npm run git:retry -- --sweep-all -- status` (élargi) |
| Mes hooks tournent-ils vraiment ? | `npm run orphans:doctor` (ligne `hooks :`) |
| Un garde-fou manque (lanceur husky, entrées du pin) | `npm run orphans:doctor -- --fix` — il nomme les remèdes, les applique un par un en demandant confirmation, et ne touche à rien d'autre |
| La panique est active | §5 |
| Comprendre *pourquoi* elle revient | `npm run orphans:report` + `npm run orphans:doctor`, puis §2 |

## 4 bis. Ce que le docteur peut réparer, et ce qu'il ne réparera jamais

`npm run orphans:doctor` imprime toujours le plan des remèdes **mécaniques** qu'il a
constatés (et `--json` les expose en données). `--fix` les applique — un par un, en
demandant confirmation (`--yes` pour un script) : **restaurer les lanceurs husky**
(`husky` les réécrit dans `.husky/_`, idempotent), **rétablir `core.hooksPath`**,
**réécrire les entrées du pin** dans `node_modules/.bin` (`npm run setup:node`).
Ces trois-là sont locaux, idempotents et réversibles ; un hook **suivi** manquant
n'est pas dans la liste, parce que ce fichier est du code relu — son absence est un
changement à faire exprès.

**Le sweep n'est pas un remède.** Tuer ne se défait pas, et un docteur qui soigne en
diagnostiquant cache l'état qu'on venait voir : c'est pourquoi `--fix` est un second
passage, *après* l'impression du diagnostic, et pourquoi les verdicts d'orphelins
continuent de nommer leur propre commande (§4) au lieu de l'exécuter.

## 5. Récupération manuelle

1. **Sonder** : `node -e "console.log('ok')"`. `ok` → la panique est passée,
   reprendre le travail. Échec → continuer.
2. **Regarder avant de tuer** : `npm run orphans:doctor` — orphelins (pid, âge,
   parent disparu), gardes actifs et ce qu'ils surveillent, hooks.
3. **Purger** : `npm run git:retry -- --sweep-all -- status` (tout `node.exe` à
   parent disparu). Pour le reste (chrome/electron, processus non-node), le
   Gestionnaire des tâches — le docteur nomme les candidats.
   **Ne jamais** `Stop-Process -Name node -Force` à l'aveugle : un serveur de dev
   ou la chaîne d'un autre agent n'est pas un orphelin.
4. **Vérifier l'arbre de travail** : `git status --porcelain` doit être
   **identique** à avant la panique. La panique ne touche jamais le contenu :
   rien n'est perdu.
5. **Reprendre** exactement où le tour s'est arrêté.
6. Si la sonde reste rouge après les purges : **redémarrer la machine**. Un
   redémarrage de Freebuff **ne libère pas** les ressources tenues par l'OS.

## 6. Limites connues (à ne pas re-découvrir)

- La **cause racine** n'est pas connue : le runbook décrit la pression et les
  remèdes, pas l'origine. Ne pas rouvrir la thèse « l'orphelin node laissé par un
  timeout » sans une mesure (§2).
- Le **shim `git.cmd`** est installé mais **inerte** tant que son dossier n'est
  pas en tête du PATH machine : `git --version` répond la même chose dans les
  deux cas, donc l'installeur pose la question de *contenu* et la question
  d'*environnement* séparément, et sort en **1** quand le shim n'est pas atteint.
- La purge ne tue **que** ce qu'une exécution a créé, identifié par **pid +
  horodatage de création** : un pid recyclé porte un autre horodatage, donc un
  `node.exe` étranger ne peut pas y passer — c'est la garantie, pas une promesse.
- Une purge qui **n'a pas pu s'exécuter** (powershell tué par la panique
  elle-même) est comptée `failed`, jamais présentée comme « rien à tuer ».

## 7. Entrées d'historique consolidées

Les sept entrées principales, dans l'ordre chronologique :

1. **2026-09-01** — « msys fork-panic recovery procedure » : la procédure
   manuelle d'origine (sonde, kill des orphelins, intégrité de l'arbre de
   travail, reprise).
2. **2026-09-04** — « Runner qualité async + watchdog » : spawn-only, timeout par
   étape, kill de l'arbre entier — la panique ne peut plus être déclenchée ni
   entretenue par la chaîne elle-même.
3. **2026-09-10** — « retry systématique automatisé du spawn PowerShell » : un
   spawn manqué ne no-op plus silencieusement un sweep.
4. **2026-09-10** — « retry automatisé des commandes git » (`git-retry.mjs`,
   `npm run git:retry`) : retry signature-based, borné, watchdog, échec réel
   jamais masqué.
5. **2026-09-10** — la famille `--sweep` : purge sélective, puis **avant la
   première tentative**, puis `--sweep-all` (élargi, orphelin strict).
6. **2026-09-10** — hooks `pre-commit` puis `pre-push` branchés sur le moteur de
   retry, et shim natif `git.cmd` pour la frontière git → hook.
7. **2026-09-10** — purge des orphelins en fin de chaîne + **garde détaché** pour
   le kill externe.

Et les entrées 2026-09-11 qui en découlent : purge **par lignée** (et le modèle
du fork-panic corrigé), compteur/journal des purges `--sweep` et des panics,
docteur d'état machine (orphelins, gardes, hooks) et son verdict.
