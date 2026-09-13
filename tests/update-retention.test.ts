// Suite de la promesse « une mise à jour ne touche pas les données du poste ».
//
// Ce dépôt a payé trois fois une garantie écrite dans sa prose et tenue par rien.
// Celle-ci est la plus coûteuse des trois, parce qu'elle est silencieuse : si le
// dossier de données change de nom — `appId`, `productName` renommés — chaque
// poste repart avec un profil VIDE. L'application s'ouvre, la connexion se refait
// (les données sont sur le serveur), et **la file d'attente hors ligne disparaît**
// : les paiements saisis sans réseau, c'est-à-dire la seule donnée qui n'existe
// nulle part ailleurs. Aucune erreur n'est levée, aucun test ne rougit, personne
// ne s'en aperçoit avant qu'une école ne réclame un reçu introuvable.
//
// Les cas ci-dessous ne mesurent pas une intention : ils lisent les fichiers qui
// décident, et ils refusent une retouche qui orphelinerait le parc.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('l’identité du dossier de données ne bouge pas', () => {
  // `appId` et `productName` nomment `%APPDATA%\<productName>` : les changer
  // donne un profil neuf à chaque poste. Ils sont donc des CONSTANTES du parc, pas
  // des réglages de packaging.
  const builder = read('electron-builder.yml');

  it('garde l’appId qui nomme le profil installé', () => {
    assert.match(builder, /^appId: com\.mamathera\.finance$/m, 'changer appId change le dossier de données du parc');
  });

  it('garde le productName qui nomme le dossier `userData`', () => {
    assert.match(builder, /^productName: MamaTheraFinance$/m, 'le dossier %APPDATA%\\MamaTheraFinance est celui de tous les postes');
  });
});

describe('rien de ce qui est installé n’efface les données du poste', () => {
  it('désinstaller ne supprime pas les données applicatives', () => {
    assert.match(
      read('electron-builder.yml'),
      /deleteAppDataOnUninstall:\s*false/,
      'une désinstallation suivie d’une réinstallation emporterait la file hors ligne d’une école',
    );
  });
});

describe('la file hors ligne garde sa clé de stockage', () => {
  it('la clé qui porte les écritures en attente est stable et nommée une fois', () => {
    const source = read('src/lib/offlineQueue.ts');
    assert.match(
      source,
      /const STORAGE_KEY = 'mama_thera_offline_queue'/,
      'renommer la clé = les écritures en attente des postes deviennent invisibles au déploiement',
    );
  });

  it('la file est persistée dans le stockage du profil, pas en mémoire', () => {
    const source = read('src/lib/offlineQueue.ts');
    // Le repli mémoire existe pour les tests Node ; il ne doit pas devenir le
    // chemin d'un navigateur, sinon la file mourrait au premier rechargement.
    assert.match(source, /typeof localStorage === 'undefined'/);
    assert.match(source, /localStorage\.setItem\(key, value\)/);
  });
});

describe('la promesse est écrite là où un humain la cherche', () => {
  it('docs/BACKUP.md dit ce qui survit à une mise à jour, et ce qui ne survit pas', () => {
    const docs = read('docs/BACKUP.md');
    assert.match(docs, /## Une mise à jour de l'application ne touche pas les données/);
    assert.match(docs, /file d'attente hors ligne/i);
    // La session, elle, ne survit pas — et le dire évite qu'on croie à une perte.
    assert.match(docs, /sessionStorage/);
  });
});
