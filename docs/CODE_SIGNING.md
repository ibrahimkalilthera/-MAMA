# Signature de code Windows — marche à suivre

Le câblage du build est prêt (voir `electron-builder.yml`) : dès que les variables
`CSC_LINK` + `CSC_KEY_PASSWORD` sont définies, electron-builder signe **tous** les
artefacts (exe win-unpacked, `elevate.exe`, installeur NSIS + son désinstalleur,
portable). Ce document explique comment obtenir le certificat et l'activer.

---

## 0. Ce que signer ENGAGE — à lire AVANT d'acheter

**Le nom d'éditeur n'est pas dans l'installeur qu'on publie : il est gravé dans
chaque poste qui l'installe.** L'installeur porte `resources/app-update.yml`
(son contrat), et ce fichier est recopié dans le `resources/` de la version
installée. C'est **ce** fichier-là qu'`electron-updater` relit à chaque
vérification (`ElectronAppAdapter.js` → `path.join(process.resourcesPath,
"app-update.yml")`), et sa règle est sèche (`NsisUpdater.js`) :

```
publisherName = (await this.configOnDisk.value).publisherName
if (publisherName == null) { return null }   // aucune vérification de signature
```

Sans `publisherName`, le poste juge les octets par le **`sha512` du flux** et
n'exige rien — c'est l'état de référence du parc depuis la 1.0.9. Avec, il exige
une chaîne **approuvée** (`Status -eq Valid`) *et* un sujet qui porte le nom
promis, sinon il lève `ERR_UPDATER_INVALID_SIGNATURE`.

**Ce qui est gravé est le CN du certificat, et rien d'autre.** Mesuré dans la
bibliothèque que le build exécute :
`windowsSignToolManager.js` → `return certInfo == null ? null : [certInfo.commonName]`
(quand `win.publisherName` n'est pas configuré). C'est donc une chaîne — le
**common name** — qui doit rester la même pendant toute la vie du parc :

| Ce qu'on livre | Ce que le parc fait |
|---|---|
| signé par `CN=X`, à des postes **sans** promesse | ils l'installent, et **gravent X** dans leur contrat |
| non signé, alors qu'ils promettent X | **refus** (`ERR_UPDATER_INVALID_SIGNATURE`) — le poste reste sur sa version |
| signé par `CN=Y` (renommage, autre fournisseur avec un autre CN) | **refus** chez ceux qui promettent X |
| signé par `CN=X` après renouvellement (même CA ou non) | rien à faire chez eux : le CN est comparé au sujet, pas l'émetteur |
| signé par un nom de **test** | gel immédiat — c'est la leçon mesurée des 1.0.6–1.0.8 |

Trois conséquences opérationnelles, et aucune ne se rattrape après coup :

1. **Le premier envoi signé est le moins cher** : les postes actuels ne
   vérifient rien, donc ils l'acceptent. C'est le seul moment où la bascule est
   gratuite ;
2. **`SIGNING_ENABLED` ne se repasse plus à `false`** une fois qu'une version
   signée est en service. Le publieur livre alors des octets non signés à des
   postes qui exigent un signataire — un gel, machine par machine ;
3. **Le CN se demande, il ne se subit pas** : c'est un champ qu'on saisit au
   moment de la   commande (vérifié dans la documentation DigiCert, §A.b). Il faut
   donc avoir décidé la chaîne exacte **avant** de payer, et la redemander à
   chaque renouvellement.

**La forme du contrat, mesurée sur le canal le 2026-09-22** (les deux époques,
ochet pour octet, empreintes conformes aux manifestes publiés) :

```yaml
# 1.0.9 → 1.0.18 · 104 octets · sha256 b9cefbcaa012c806…  — aucune promesse
owner: ibrahimkalilthera
repo: '-MAMA'
provider: github
updaterCacheDirName: mama-thera-finance-updater
```

```yaml
# 1.0.6, 1.0.7, 1.0.8 · 149 octets · sha256 b8c880ad9c06e5da…  — contrat de GEL
… même tête …
publisherName:
  - Mama Thera Finance (test)
```

Ce que ces deux fichiers disent, en une phrase : **le parc se met à jour par
empreinte aujourd'hui, et n'importe quelle version le fera par nom dès qu'une
version signée aura été installée.**

## A. Obtenir le certificat, dans l'ordre

### A.a Choisir la voie

| Voie | Coût | Ce qu'il faut savoir |
|---|---|---|
| **SignPath Foundation** (voie OSS, gratuite) | 0 | Certificats **EV**, donc confiance immédiate. Réservé aux projets open source avec build dans un système ouvert — le dossier du projet est décrit en **§1 bis**. |
| **OV acheté** (DigiCert, Sectigo, GlobalSign, SSL.com) | 200–400 USD/an | Validation d'organisation ; signature via le service du fournisseur (la clé vit dans un HSM, cf. §1.b). |
| **EV acheté** | 600–1 000 USD/an | Même contrainte de clé, réputation SmartScreen immédiate. Plus cher, sans bénéfice décisif ici. |
| **Azure Trusted Signing** | ~10 USD/mois | Racine DigiCert, intégration `win.azureSignOptions` — mais la validation d'identité est limitée à quelques pays (**une organisation au Mali n'y est pas recevable**, vérifié le 2026-09-13). |

Le produit s'appelle **« Code Signing »** — jamais un certificat TLS/SSL de site
web, qui ne signe pas un exécutable.

### A.b Ce qu'on demande à l'autorité (vérifié le 2026-09-22, doc DigiCert)

- **Le CN se saisit au moment de la commande** (« Enter the required certificate
  subject information ») : demander **exactement** la chaîne que le parc gravera,
  par exemple `CN=COMPLEXE SCOLAIRE MAMA THERA`. Ni abréviation, ni fantaisie :
  chaque poste comparera le sujet du certificat à cette chaîne-là.
- **Durée maximale : 459 jours** (depuis le 24 février 2026 ; les certificats de
  2 ou 3 ans ne sont plus émis). Autrement dit : **un renouvellement tous les
  ~15 mois**, et à chaque renouvellement il faut redemander **le même CN**. Un
  renouvellement qui change de CN gèle le parc ;
- **l'organisation doit être validée pour la signature de code** (type de
  validation `CS`, ou `EV CS`), un **contact vérifié** approuve la commande, et
  l'autorité **appelle un numéro de l'organisation** pour confirmer l'autorité de
  commander (l'appel arrive typiquement dans les 24 h). Prévoir les documents de
  l'organisation (immatriculation, adresse, contact joignable) **avant** de
  commander, et confirmer l'éligibilité d'une organisation malienne auprès du
  fournisseur : une validation qui échoue coûte des semaines, pas des minutes ;
- **la clé privée ne peut pas vivre dans un fichier** : HSM, service HSM ou jeton
  matériel certifié FIPS 140-2 niveau 2 (ou équivalent) depuis le 1er juin 2023.
  Pour un HSM, la clé est **générée sur le HSM avant** de soumettre la commande.

### A.c Comment la CI signe, selon le mode de provisionnement

| Provisionnement | Ce que la CI utilise |
|---|---|
| Jeton matériel fourni / personnel | Inutilisable sur un runner : il faut un **service** de signature (le jeton reste sur le bureau de quelqu'un) |
| **HSM** | La commande est signée par le service du fournisseur, ou par outil local avec le HSM accessible |
| **DigiCert KeyLocker** | `digicert/code-signing-software-trust-action` dans `.github/workflows/desktop-release.yml` |
| **SignPath** | `signpath/github-action-submit-signing-request` (avec `wait-for-completion: true`) |

Le point d'insertion est **unique** et déjà commenté dans le workflow (l'étape
« Restore code-signing certificate »). Ce qui compte pour ce dépôt :

1. l'artefact **non signé** est envoyé au service, l'artefact **signé** remplace
   les octets avant `npm run release:publish` — le publieur, lui, ne signe rien ;
2. les identifiants du service vont dans des **secrets** Actions, et
   **`SIGNING_ENABLED`** (une **variable**) reste le seul interrupteur humain ;
3. `npm run check:updater-trust` juge ensuite le contrat **embarqué dans le
   binaire signé** et la signature réelle de ses octets — avant toute écriture
   sur le canal. C'est lui qui refuse un nom promis que le certificat ne porte
   pas, une chaîne non approuvée, ou un nom de test.

⚠️ **Ne jamais remettre un `.pfx` dans ces secrets.** Depuis 2023 un certificat
acheté n'arrive plus sous cette forme : un `.pfx` disponible ici est un
certificat **auto-signé**, et c'est exactement par là que la 1.0.8 a été signée
et le parc gelé. Le fichier qui peut exister dans les secrets d'un dépôt
historique (`CSC_PFX_B64`) doit être **supprimé** le jour où un vrai certificat
est branché.

### A.d Essayer sans publier — le test qui ne coûte rien

Un certificat reçu se vérifie **avant** de livrer quoi que ce soit : build signé
(en local ou sur un runner), puis

```bash
npm run check:updater-trust        # lit le contrat embarqué + la signature réelle
```

Le vert qui compte est : `signature approuvée : CN=… — le parc pourra recevoir la
version suivante`. Tout autre verdict nomme ce qui manque (chaîne non approuvée,
nom promis absent du sujet, nom de test). **Ce build-là ne se publie pas** s'il
porte un certificat de test : c'est un essai de câblage, pas une version.

## B. Passer `SIGNING_ENABLED` — et ne plus jamais le repasser à `false`

`SIGNING_ENABLED` est une **variable** de dépôt (Settings → Secrets and variables
→ Actions → *Variables*), pas un secret. C'est elle qui rend la signature
utilisable : sans elle, un certificat présent dans les secrets est **restauré
mais pas utilisé**, et le workflow écrit « signature ÉTEINTE » puis publie non
signé. La raison de ce choix est mesurée : un certificat de **test** resté dans
les secrets a été pris par le runner, gravé dans le contrat de la 1.0.8, et a
gelé le parc. Sans décision explicite, un secret oublié ne peut plus signer ce
qu'on livre.

Une fois `true` et une version signée publiée, **la variable ne repasse plus à
`false`** : les postes qui l'ont installée promettent le CN, et des octets non
signés sont refusés chez eux (voir §0). Si la signature doit s'arrêter pour de
bon, le remède est **par poste** : `npm run repair:frozen-updater -- --apply`
(§3), puis un redémarrage de l'application.

Le même raisonnement vaut pour le **renouvellement** : un certificat qui expire
sans successeur portant le même CN laisse le parc figé sur la dernière version
signée. Garder une alerte sur la date d'expiration (≤ 459 jours) fait partie de
l'exploitation, pas de l'achat.

## C. La bascule, dans l'ordre

Chaque étape a sa commande, et aucune ne se saute : la première lit ce que le
parc promet **aujourd'hui**, la dernière prouve qu'un poste installé atteint
réellement la version signée.

```bash
# 1. Ce que le parc promet, lu là où c'est vrai (un poste, ou les octets publiés)
npm run check:signing-transition -- --station="%LOCALAPPDATA%\Programs\MamaTheraFinance"
npm run check:signing-transition -- --channel          # empreintes des contrats publiés, sans jeton

# 2. La répétition : « et si le certificat portait ce CN ? » (aucun octet à signer)
npm run check:signing-transition -- --publisher="COMPLEXE SCOLAIRE MAMA THERA" --station="…"
#    attendu : first-commitment, avec l'engagement affiché.
#    promise-changed  ⇒ un poste promet DÉJÀ un autre nom : ne pas publier ainsi.
#    unsigned-after-commitment ⇒ un poste exige un signataire : signer la version, ne pas la livrer non signée.

# 3. Le build signé, jugé sur ses octets (Windows)
npm run check:updater-trust

# 4. Après publication : les octets PUBLIÉS portent-ils ce contrat, et quelle signature ?
npm run check:updater-contract:live

# 5. Un poste installé atteint-il la nouvelle version, sans clic ? (canal réel)
npm run verify:updater:channel
```

Ce que le contrôle de bascule fait et ne fait pas, pour qu'on sache quoi lui
demander : il lit le contrat **qu'on s'apprête à livrer** (build local, ou CN
simulé), le confronte à ce que le parc promet (poste, installeur déjà téléchargé,
ou empreintes des manifestes publiés), et **refuse de conclure** (sortie 2)
quand le contrat change sans que la promesse du parc ait été lue — une empreinte
qui change ne dit pas ce qui a changé. Il ne mesure **pas** la signature des
octets : c'est `check:updater-trust`, sur Windows, sur le build réel.

Après la bascule, noter le CN gravé dans `DEVELOPMENT_HISTORY.md` : c'est
l'information qu'on cherchera dans deux ans, quand un renouvellement se
présentera.

---

## 1. Pourquoi SmartScreen persiste sans certificat de confiance

Sans signature, Windows affiche « Éditeur inconnu » / « Windows a protégé votre
PC » (SmartScreen). Un certificat **auto-signé** ne change rien : Windows ne
reconnaît pas la racine. Seul un certificat de **signature de code** délivré par
une autorité de certification (CA) dont la racine est préinstallée dans Windows
lève l'avertissement.

Même signé, un **nouvel éditeur** peut encore voir des avertissements pendant
quelques semaines : la réputation SmartScreen se construit avec les
téléchargements/installations réels.

### Un certificat de test est pire que pas de certificat (mesuré le 2026-09-13)

Le build n'embarque pas seulement une signature : il embarque un **contrat**, dans
`resources/app-update.yml` — `publisherName: [ "Mama Thera Finance (test)" ]` sur
l'installeur signé du 2026-09-13. Or `electron-updater` refuse toute mise à jour
dont la signature n'est pas `Valid` **et** dont le sujet ne porte pas ce nom
(`NsisUpdater.js` → `windowsExecutableCodeSignatureVerifier.js`, sinon
`ERR_UPDATER_INVALID_SIGNATURE`). Comme un certificat auto-signé n'est approuvé
que sur la machine qui l'a créé, ce contrat rend le parc **incapable de recevoir
la moindre mise à jour** — et comme le nom promis est gravé **dans les postes
déjà installés**, une version ultérieure signée par un vrai certificat serait
refusée elle aussi. Le remède est **local** et ne demande **ni réinstallation, ni droits administrateur** : retirer la promesse de `resources/app-update.yml` sur le poste concerné — voir **§3**, `npm run repair:frozen-updater -- --apply`.

D'où `npm run check:updater-trust`, appelé par le publieur avant toute écriture
sur le canal : il lit le contrat réellement embarqué, interroge Windows sur le
fichier réel, et **refuse** un signataire de test, une promesse vide, une chaîne
non approuvée ou un nom promis que le certificat ne porte pas. Un build **non
signé** n'est pas refusé par ce contrôle (il ne promet rien, donc le poste
n'exige rien — c'est le seul état qui se met à jour sans certificat), et depuis
le **2026-09-13** il se **publie** : refuser cet état avait renvoyé la publication
vers une machine locale, où un certificat de test a signé la 1.0.8 et gelé le
parc. Le coût reste entier et il est **dit** (« Windows affichera « éditeur
inconnu » à l'installation », et la preuve d'action du job écrit « installeur NON
signé ») : une décision explicite, jamais un état silencieux. Ce qui reste
**interdit**, avant toute écriture sur le canal : un certificat non approuvé.

## 1 bis. La voie gratuite : signature OSS (SignPath Foundation)

Un projet **open source** (dépôt public + licence OSI + build dans un système de
build ouvert) peut faire signer ses binaires **gratuitement** par la SignPath
Foundation, qui délivre des certificats **EV** — donc reconnus immédiatement, sans
la période de réputation d'un OV neuf.

État du dossier, mesuré le 2026-09-13 :

| Prérequis | État |
|---|---|
| dépôt public | ✅ `ibrahimkalilthera/-MAMA` (`private: false`, interrogé sans jeton) |
| licence OSI | ✅ `LICENSE` (MIT) + `"license": "MIT"` dans `package.json` — ajoutés pour cette démarche |
| build dans un système ouvert | ✅ GitHub Actions (`windows-latest`), le même runner qui construit aujourd'hui |
| artefacts publiés | ✅ installeur NSIS + portable + `latest.yml` |

Ce que ça change dans le pipeline : l'artefact **non signé** est téléversé à
SignPath au lieu d'être signé localement (`CSC_LINK`). Concrètement, l'étape de
signature actuelle reste **le seul point à remplacer**, et elle ne se déclenche
que si les secrets existent :

1. Créer un compte sur <https://signpath.org/> (formulaire « open source ») et
décrire le projet : dépôt public, licence MIT, workflow GitHub Actions, artefacts
Windows (installateur + portable).
2. Une fois accepté, l'organisation fournit :
   - `SIGNPATH_API_TOKEN` (jeton d'API) → secret Actions ;
   - l'identifiant d'organisation et le *slug* des *policies* (`release-signing`) ;
   - le connecteur GitHub à poser dans `.github/workflows/desktop-release.yml`, à
     la place de l'étape « Restore code-signing certificate », avec
     `signpath/github-action-submit-signing-request` et
     `wait-for-completion: true`, l'artefact signé remplaçant les octets non
     signés avant `npm run release:publish`.
3. Ce qui ne change **pas** : `npm run check:updater-trust` jugera le contrat
embarqué du binaire **signé** avant la première requête — le nom promis devra
correspondre au certificat SignPath, donc la publication reste refusée si
quelque chose ne concorde pas.

⚠️ Tant que ces secrets n'existent pas, la branche « aucun certificat » du
workflow construit un build **non signé** et le publie (décision du 2026-09-13,
voir ci-dessus) : les postes reçoivent les correctifs et continuent de se mettre à
jour, sans nom d'éditeur. La candidature reste la voie pour l'avertissement, pas
pour la livraison.

## 2 bis. Deux choses qu'il faut savoir AVANT d'acheter (vérifiées le 2026-09-13)

### openssl ne peut pas produire le certificat qu'il faut

`openssl` génère une paire de clés, une demande de signature (CSR) et des
certificats **auto-signés**. Un certificat auto-signé **n'est pas** un certificat
« de test inoffensif » : c'est exactement celui qui a gelé le parc (voir l'encadré
§1). Ce qui rend un certificat utile à Windows n'est pas sa fabrication, c'est
l'**autorité** qui l'émet : sa racine est déjà dans le magasin de confiance de
Windows, ce qu'aucun `openssl` local ne peut imiter. Le certificat s'**achète**
(validation d'identité) ou s'obtient par un programme dédié (§1 bis), il ne se
génère pas.

### Un certificat neuf ne se livre plus en `.pfx`

Depuis le **1er juin 2023**, les *Code Signing Baseline Requirements* du CA/B
Forum imposent que la clé privée soit **générée et conservée dans un module
matériel** (HSM, FIPS 140-2 niveau 2 ou équivalent). Un certificat OV/EV acheté
aujourd'hui arrive donc sous forme de **jeton matériel** ou de **clé hébergée
chez le fournisseur** — jamais d'un fichier `.pfx` importable dans un secret
GitHub. Conséquence directe pour ce dépôt :

- les deux secrets actuels (`CSC_PFX_B64`, `CSC_KEY_PASSWORD`) correspondent au
  chemin **logiciel**, c'est-à-dire à un certificat **auto-signé de test** —
  celui des 1.0.6/1.0.7/1.0.8. Ils ne pourront pas porter un certificat acheté ;
- la signature se fera **par le service du fournisseur** depuis le runner, via
  son action GitHub : DigiCert publie `digicert/code-signing-software-trust-action`
  (produit **Binary Signing**, successeur de Software Trust Manager et de
  KeyLocker) ; SignPath publie son connecteur pour la voie OSS gratuite ;
- l'insertion est **le même point unique** que celui déjà commenté dans
  `.github/workflows/desktop-release.yml` (l'étape de signature) : l'artefact
  construit est envoyé au service, l'artefact **signé** remplace les octets non
  signés, puis `npm run release:publish` publie — et `check:updater-trust` juge le
  contrat embarqué du binaire signé avant la première requête.

Ce que ça change pour la commande : au lieu d'un `.pfx` à déposer, il faut les
identifiants d'API du service de signature (DigiCert ou SignPath) en secrets, et
un *profil* de signature créé côté fournisseur.

## 2 ter. Ce qu'on trouve sur un poste et qui ne signe PAS

Tous ces fichiers ont l'air d'un certificat. Aucun ne peut servir à publier, et
chacun pour une raison mesurable. Le cas `ska.p7b` du 2026-09-13 est lu ici tel
qu'il est, pas tel qu'on l'espère :

```
$ openssl pkcs7 -inform DER -in ska.p7b -print_certs -noout
subject=C=ML, ST=Bamako, L=Lafiabougou, O=MaMA THERA FINANCE
issuer =C=ML, ST=Bamako, L=Lafiabougou, O=MaMA THERA FINANCE     ← émetteur = sujet
1 seul certificat · aucune extension (ni KeyUsage, ni ExtendedKeyUsage)
```

| Fichier | Ce qu'il contient | Pourquoi il ne signe pas |
|---|---|---|
| **`.p7b`** (PKCS#7) | des **certificats** seulement | **aucune clé privée** : il ne peut rien signer, par construction |
| **`.cer` / `.crt`** | un certificat | même raison |
| **auto-signé** (émetteur = sujet) | un certificat qu'aucune autorité ne cautionne | Windows ne peut pas l'approuver : avertissement conservé, **et parc gelé** (l'électron-updater exige `Valid` + le nom promis, cf. §1) |
| **`.pfx` / `.p12`** | certificat **+** clé privée | signe bien localement — mais un certificat **acheté** n'arrive plus sous cette forme depuis 2023 (§2 bis), donc celui-ci est un certificat auto-signé |

Un certificat **auto-signé** ne devient pas utilisable en le « distribuant » : il
faudrait installer sa racine dans le magasin de confiance de **chaque** poste,
manuellement, avec des droits administrateur — un vrai travail par machine, à
refaire pour tout poste neuf, et une clé que n'importe qui peut copier depuis le
dépôt. Ce n'est pas une voie de production, c'est une dette de sécurité.

Ce qu'un outil local peut produire d'**utile** : une **demande de signature
(CSR)**. Et encore : pour un certificat de signature de code acheté, la clé doit
naître dans le HSM du fournisseur (§2 bis), donc le CSR local ne sert pas non
plus. Il n'existe pas de raccourci local vers un certificat approuvé.

## 2. Choisir le certificat

| Option | Coût indicatif | Ce qu'il faut savoir |
|---|---|---|
| **OV** (Organization Validation) | 200–400 USD/an | Vérification de l'organisation (documents de l'école). **Ne se livre PAS en `.pfx`** depuis 2023 : la clé doit vivre dans un HSM (voir §2 bis) — la CI signe donc via le service du fournisseur, pas avec `CSC_LINK`. |
| **EV** (Extended Validation) | 600–1 000 USD/an | Même contrainte de clé (jeton/HSM), confiance immédiate. Plus cher, sans bénéfice décisif ici. |
| **Azure Trusted Signing** | ~10 USD/mois + par signature | Signature cloud Microsoft, racine DigiCert ; s'intègre via `win.azureSignOptions` (electron-builder 26.15.3 le porte). **Mais la validation d'identité du service est limitée à quelques pays** (États-Unis/Canada pour les organisations, et des utilisateurs européens s'y voient déjà refusés) : une organisation au Mali n'y est pas recevable. Vérifié le 2026-09-13, ne pas s'y engager sans essayer. |

Fournisseurs reconnus : **DigiCert, Sectigo, SSL.com, GlobalSign**. Le produit à
acheter s'appelle **Code Signing** (jamais un certificat TLS/SSL de site web).

## 3. Activer la signature en local

1. Téléchargez le certificat chez la CA (ou exportez-le) et convertissez-le en
   `.pfx` protégé par un mot de passe fort (ex. via le magasin de certificats :
   `Cert:\CurrentUser\My` → *Toutes les tâches → Exporter*).
2. Signez le build local :

   ```bash
   # PowerShell
   $env:CSC_LINK = "C:\chemin\vers\code-sign.pfx"
   $env:CSC_KEY_PASSWORD = "votre-mot-de-passe"
   npm run electron:dist
   ```

3. Vérifiez que la signature est valide :

   ```powershell
   Get-AuthenticodeSignature "C:\...\release\MamaTheraFinance-1.0.0-setup.exe" |
     Select-Object Status, SignerCertificate
   # Status = Valid et SignerCertificate = le nom de l'organisation
   ```

   (Le build est horodaté automatiquement — la signature reste valide après
   l'expiration du certificat.)

### La transition : comment dégeler un poste, SANS réinstaller

Un poste qui a installé la 1.0.6, la 1.0.7 ou la 1.0.8 porte
`publisherName: [ "Mama Thera Finance (test)" ]` dans son
`resources/app-update.yml`, et c'est **son propre code** qui refuse l'installeur
téléchargé. Trois lignes mesurées dans la bibliothèque que le poste exécute
disent tout ce qui compte ici :

| Ce que fait le poste | Où c'est écrit |
|---|---|
| il lit le contrat **sur son disque** | `ElectronAppAdapter.js:23` → `path.join(process.resourcesPath, "app-update.yml")` |
| **sans `publisherName`, il ne vérifie AUCUNE signature** | `NsisUpdater.js:86-90` → `if (publisherName == null) return null` |
| avec, il exige `Valid` **au CN promis** | `windowsExecutableCodeSignatureVerifier.js:44-88` |

Deux conséquences, et la seconde est la bonne nouvelle : **aucun changement de
canal ne peut atteindre ces postes** (le refus tombe chez eux, avant toute
exécution), mais **le fichier qui bloque est chez eux, et il est inscriptible** —
une installation par utilisateur vit sous `%LOCALAPPDATA%`, où personne n'a besoin
d'élever ses droits pour écrire. Retirer la promesse suffit alors à rendre le
poste normal : plus de promesse, plus de vérification de signature, et le
`sha512` du flux redevient le seul juge.

```powershell
# 1. Le constat, sans rien écrire (sort en 1 si un contrat est gelé) :
npm run repair:frozen-updater

# 2. L'acte : retire la promesse, sauvegarde l'original en `.bak`, puis RELIT le
#    fichier écrit pour prouver que la promesse n'y est plus.
npm run repair:frozen-updater -- --apply

# 3. Relancer l'application : elle ne lit ce fichier qu'au démarrage.
```

Sans `--dir`, le script cherche lui-même les installations de **cette**
application (`%LOCALAPPDATA%\Programs`, `%ProgramFiles%`, `%ProgramFiles(x86)%`) ;
les contrats d'autres applications sont comptés et **jamais touchés**. Pour un
parc, le même script se lance sur chaque poste (ou via une tâche de connexion),
et il est **idempotent** : un poste déjà libre n'est ni ré-écrit ni annoncé comme
réparé.

Il ne retire, en revanche, **que ce qu'aucun certificat ne peut honorer** — une
promesse vide, ou un signataire de test. Une promesse *satisfiable* est une
garantie : la retirer accepterait des octets non signés sur un poste qui n'était
pas cassé, donc elle est nommée et laissée en place, sauf `--force` explicite.

| Versions publiées | Contrat embarqué | Ce que ça implique |
|---|---|---|
| **1.0.1 → 1.0.5** (avant le certificat de test) | aucun `publisherName` | ces postes se mettent à jour **tout seuls** |
| **1.0.6, 1.0.7, 1.0.8** (certificat de test) | `Mama Thera Finance (test)` | **un passage de `repair:frozen-updater -- --apply` par machine**, puis un redémarrage de l'application — pas de réinstallation, aucune donnée touchée |
| **1.0.9 et suivantes** (non signées) | aucune promesse | libres par construction : rien à réparer |

Comment constater l'état d'une machine, en une commande (l'emplacement dépend de
l'installation — `Programs\<app>\resources\` en édition utilisateur,
`Program Files\<éditeur>\<app>\resources\` en édition machine) :

```powershell
Get-Content "$env:LOCALAPPDATA\Programs\MamaTheraFinance\resources\app-update.yml"
# pas de ligne publisherName:  → le poste se met à jour tout seul
# publisherName: …            → contrat de gel : npm run repair:frozen-updater -- --apply
```

⚠️ **Il existe une autre voie, et elle coûte plus cher.** On pourrait rendre le
certificat de test *approuvé* sur chaque poste (installer sa racine dans
« Autorités de certification racines de confiance », droits administrateur), puis
publier un build signé de ce même certificat : le poste verrait alors `Valid` au
nom promis et accepterait la mise à jour. Mais ce build graverait **à nouveau** la
promesse dans le contrat des postes, et il faudrait réinstaller cette racine sur
**chaque** machine neuve, indéfiniment — une dette de sécurité pour un certificat
dont la clé privée circule en clair. La voie du fichier est plus courte, réversible
(une sauvegarde `.bak`), et elle ne demande aucun droit particulier.

## 4. Activer la signature en CI (GitHub Actions)

1. Encodez le `.pfx` en base64 :

   ```bash
   base64 -w0 code-sign.pfx   # (Linux/macOS) ou certutil -encode sur Windows
   ```

2. Créez les secrets dans **Settings → Secrets and variables → Actions** :
   - `CSC_PFX_B64` : le contenu base64 du `.pfx`
   - `CSC_KEY_PASSWORD` : le mot de passe du certificat

   Et **une variable**, dans l'onglet *Variables* du même écran :
   `SIGNING_ENABLED` = `true`. C'est elle qui rend la signature **utilisable** —
   les secrets seuls ne décident plus de rien. La raison est mesurée : un
   certificat de **test** resté dans ces secrets a été pris par le runner, gravé
   dans le contrat du binaire (1.0.8) et a gelé le parc. Sans le choix explicite,
   un secret oublié ne peut plus signer ce qu'on livre.

3. Déclenchez **Actions → Desktop release (Windows) → Run workflow**. Le
   workflow `.github/workflows/desktop-release.yml` restaure le certificat,
   signe le build et publie le GitHub Release (setup.exe + portable +
   `latest.yml`) — le canal electron-updater devient actif. Si un certificat est
   présent dans les secrets mais que `SIGNING_ENABLED` vaut autre chose que
   `true`, le journal du job le dit en toutes lettres (`signature ÉTEINTE`) et la
   publication part **non signée** : la voie normale de livraison ne dépend plus
   d'un secret, et rien ne peut être signé par surprise.

   Sans secret `CSC_PFX_B64`, le workflow construit **sans** signature et
   **publie quand même** (décision du 2026-09-13). L'état publié est celui de la
   **1.0.9** — aucun `publisherName` promis, octets `NotSigned` — et c'est la
   **signature de référence** de ce dépôt : le poste juge alors les octets par le
   `sha512` du flux, donc il se met à jour. Ce qu'un certificat apporte en plus
   est le **nom de l'éditeur**, pas la livraison.

   ⚠️ **Cette liberté a une fin, et elle est datée par le premier envoi signé.**
   Tant qu'aucun poste ne promet de signataire, publier non signé est sans
   conséquence ; dès qu'une version signée est **installée** quelque part, ce
   poste-là exige son nom et refusera tout ce qui ne le porte pas (§0). C'est
   exactement ce que refuse `npm run check:signing-transition`
   (`unsigned-after-commitment`) — et le publieur, lui, ne peut pas le voir : sur
   la machine de build, un contrat sans promesse est parfaitement sain.

## 5. Sécurité

- **Ne committez jamais** le `.pfx` ni son mot de passe (`.gitignore` : les
  `.pfx`/`.p12` doivent rester hors du dépôt ; les secrets CI uniquement).
- Gardez une copie du certificat et du mot de passe dans un coffre sécurisé —
  un certificat de signature perdu ne peut pas être révoqué proprement.
- Pour l'OV logiciel, restreignez l'accès au fichier `.pfx` (dossier chiffré /
  gestionnaire de secrets).

## Vérification rapide du câblage (sans acheter)

Pour prouver que le pipeline signe bien (sans valeur SmartScreen), un certificat
auto-signé de test suffit — mais **uniquement sur un build qu'on ne publie
jamais** : voir l'avertissement ci-dessus, et l'entrée « Signature de code
Windows » de `DEVELOPMENT_HISTORY.md`. C'est exactement ce qui a produit
l'installeur 1.0.8 au contrat empoisonné. Le publieur refuse désormais ce cas
avant d'écrire quoi que ce soit sur le canal (`npm run check:updater-trust`),
mais la règle tient aussi pour un binaire distribué à la main.

## Mesurer le contrat sur les octets PUBLIÉS, pas seulement sur le build local

`check:updater-trust` juge le dossier de sortie : c'est la bonne question avant
de publier, et la mauvaise après — ce qu'un poste télécharge n'est pas
`release/win-unpacked`, c'est un installeur NSIS posé sur le canal, et entre les
deux il y a une compression et un téléversement. D'où
`npm run check:updater-contract:live`, qui refait la mesure sur les octets
servis : il lit la tête du canal **sans jeton** (comme un poste), vérifie que
l'installeur téléchargé répond au `sha512` et à la taille de `latest.yml`,
l'ouvre, en extrait la charge utile NSIS puis `resources/app-update.yml`, et
confronte ce fichier au **manifeste d'arborescence publié**
(`<produit>-<version>-unpacked.manifest.json`, qui scelle taille et `sha256` de
chaque fichier du build). Sans cette référence, une extraction ne prouve que
l'existence d'un fichier, pas que c'est celui du build — c'est pourquoi son
absence est un refus.

Le verdict de signature, lui, est le même : il interroge Windows sur les octets
et passe la promesse lue dans le contrat extrait à `updaterTrustVerdict`. Hors
Windows, il **refuse de conclure avant même de télécharger 129 Mo**, et sans
7-Zip il refuse aussi : l'extraction EST la mesure. Mesuré sur la 1.0.18
publiée : contrat extrait de **104 octets**, `sha256 b9cefbcaa012c806…`,
identique à celui que le manifeste publie, aucun signataire promis, octets
`NotSigned` — le parc garde donc son chemin de mise à jour, au prix de
l'avertissement « éditeur inconnu ».