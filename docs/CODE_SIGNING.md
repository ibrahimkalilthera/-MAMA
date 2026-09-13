# Signature de code Windows — marche à suivre

Le câblage du build est prêt (voir `electron-builder.yml`) : dès que les variables
`CSC_LINK` + `CSC_KEY_PASSWORD` sont définies, electron-builder signe **tous** les
artefacts (exe win-unpacked, `elevate.exe`, installeur NSIS + son désinstalleur,
portable). Ce document explique comment obtenir le certificat et l'activer.

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
refusée elle aussi : ces postes doivent **réinstaller une fois à la main**.

D'où `npm run check:updater-trust`, appelé par le publieur avant toute écriture
sur le canal : il lit le contrat réellement embarqué, interroge Windows sur le
fichier réel, et **refuse** un signataire de test, une promesse vide, une chaîne
non approuvée ou un nom promis que le certificat ne porte pas. Un build **non
signé** n'est pas refusé par ce contrôle (il ne promet rien, donc le poste
n'exige rien) — mais ce dépôt ne le **publie** pas pour autant : sans certificat,
le workflow de publication reste en inaction déclarée et rougit en le disant.
Une app que Windows ne peut pas identifier ne se pose pas dans le parc ; le
contrôle nomme ce coût au lieu de le taire pour que la décision reste explicite.

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

⚠️ Tant que ces secrets n'existent pas, **rien ne change** : la branche « aucun
certificat » du workflow construit, refuse de publier et le déclare en INACTION.
Il n'y a pas de troisième état silencieux — c'est délibéré, un certificat absent
doit se lire comme une publication qui n'a pas eu lieu.

## 2. Choisir le certificat

| Option | Coût indicatif | Ce qu'il faut savoir |
|---|---|---|
| **OV** (Organization Validation) | 200–400 USD/an | Vérification de l'organisation (documents de l'école). Certificat logiciel exportable en `.pfx` — l'option pragmatique pour cette app. |
| **EV** (Extended Validation) | 600–1 000 USD/an | Exige généralement une clé sur jeton matériel/HSM (moins pratique pour un build CI sans matériel dédié). Meilleure confiance immédiate. |
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

### La transition : quels postes, et pourquoi UNE seule fois

Un poste qui a installé une version signée du certificat de test (le contrat
`publisherName: [ "Mama Thera Finance (test)" ]` est gravé dans son
`resources/app-update.yml`) est **définitivement fermé aux mises à jour
automatiques** : son application applique sa propre vérification, et il faudrait
qu'un futur installeur soit signé de ce même nom **avec une chaîne approuvée** —
ce qu'aucune machine ne peut accorder à un certificat auto-signé.

Ce n'est donc pas « à chaque réinstallation » : c'est **une fois par poste
concerné**, et seulement ceux-là.

| Versions publiées | Contrat embarqué | Ce que ça implique |
|---|---|---|
| **1.0.1 → 1.0.5** (avant le certificat de test) | aucun `publisherName` | ces postes se mettent à jour **tout seuls** dès qu'un build signé (ou non signé) est publié |
| **1.0.6, 1.0.7, 1.0.8** (certificat de test) | `Mama Thera Finance (test)` | **un passage à la main par machine**, une seule fois, pour la première version signée approuvée |

Comment le vérifier sur une machine :

```powershell
Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\MamaTheraFinance\MamaTheraFinance.exe" |
  Select-Object Status, @{n='Signer';e={$_.SignerCertificate.Subject}}
# Status = Valid → la machine se mettra à jour toute seule
# Status = UnknownError/NotSigned → machine à repasser une fois à la main
```

L'installation manuelle remplace **tout** le dossier de l'application, contrat
compris : après elle, la machine revient dans le cas « se met à jour toute seule »,
quel que soit le certificat utilisé ensuite (un poste sans signataire promis
n'en exige aucun). Rien n'est à faire sur les autres postes, et plus rien à faire
sur celui-là.

## 4. Activer la signature en CI (GitHub Actions)

1. Encodez le `.pfx` en base64 :

   ```bash
   base64 -w0 code-sign.pfx   # (Linux/macOS) ou certutil -encode sur Windows
   ```

2. Créez les secrets dans **Settings → Secrets and variables → Actions** :
   - `CSC_PFX_B64` : le contenu base64 du `.pfx`
   - `CSC_KEY_PASSWORD` : le mot de passe du certificat

3. Déclenchez **Actions → Desktop release (Windows) → Run workflow**. Le
   workflow `.github/workflows/desktop-release.yml` restaure le certificat,
   signe le build et publie le GitHub Release (setup.exe + portable +
   `latest.yml`) — le canal electron-updater devient actif.

   Sans secret `CSC_PFX_B64`, le workflow avertit, construit **sans** signature
   et ne publie pas.

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