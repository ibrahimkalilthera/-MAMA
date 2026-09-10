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

## 2. Choisir le certificat

| Option | Coût indicatif | Ce qu'il faut savoir |
|---|---|---|
| **OV** (Organization Validation) | 200–400 USD/an | Vérification de l'organisation (documents de l'école). Certificat logiciel exportable en `.pfx` — l'option pragmatique pour cette app. |
| **EV** (Extended Validation) | 600–1 000 USD/an | Exige généralement une clé sur jeton matériel/HSM (moins pratique pour un build CI sans matériel dédié). Meilleure confiance immédiate. |
| **Azure Trusted Signing** | ~10 USD/mois + par signature | Signature cloud Microsoft, racine DigiCert ; nécessite un abonnement Azure + identité d'éditeur vérifiée. S'intègre via `win.signtoolOptions.azureSignOptions` (workflow CI à adapter). |

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
auto-signé de test suffit — voir l'entrée « Signature de code Windows » de
`DEVELOPMENT_HISTORY.md` (build isolé, vérification du signataire, nettoyage).