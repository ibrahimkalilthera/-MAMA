// Suite for src/lib/auditDisplay.ts — la page du journal d'audit se lit en français.
//
// L'incident : la page était française partout sauf dans les deux colonnes du
// milieu, où s'affichaient `ADD_VENDOR_EXPENSE` et « Payment of 80000 FCFA
// recorded (Receipt: REC-690078) ». Le code est un identifiant, pas un libellé ;
// et la phrase anglaise est un FAIT STOCKÉ, qu'un journal d'audit ne réécrit pas
// (une trace qui se corrige en base n'est plus une trace) — donc on la traduit à
// la lecture.
//
// Ces tests verrouillent les deux moitiés : aucun code écrit par `src/` ne peut
// arriver à l'écran sans libellé, et aucun gabarit anglais ne peut revenir à
// l'écriture. La seconde moitié est un scan de source : c'est le seul moyen de
// refuser un gabarit qu'on ne voit qu'à l'écran, chez une école.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AUDIT_ACTION_KEYS, auditActionLabel, localizeAuditDetails } from '../src/lib/auditDisplay';
import { translations } from '../src/i18n/translations';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const collect = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

describe('auditDisplay — un code d’action s’affiche en mots', () => {
  const sources = collect(join(root, 'src'));

  it('chaque code écrit par src/ a un libellé dans les DEUX dictionnaires', () => {
    const codes = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/action:\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1]);
    }
    assert.ok(codes.size > 0, 'aucun code d’action détecté — le scan est cassé');
    const missing = [...codes].filter((code) => !AUDIT_ACTION_KEYS[code]);
    assert.deepEqual(
      missing,
      [],
      `codes sans libellé (ils s’afficheraient tels quels dans la colonne ACTIONS) : ${missing.join(', ')}`,
    );
    for (const code of codes) {
      const key = AUDIT_ACTION_KEYS[code] as keyof typeof translations.fr;
      for (const lang of ['fr', 'en'] as const) {
        const label = translations[lang][key];
        assert.ok(
          typeof label === 'string' && label.trim(),
          `${code} → ${String(key)} manque dans le dictionnaire ${lang}`,
        );
      }
    }
  });

  it('lit un code connu, et rend un inconnu tel quel au lieu de l’inventer', () => {
    assert.equal(auditActionLabel('ADD_VENDOR_EXPENSE', translations.fr), 'Dépense fournisseur ajoutée');
    assert.equal(auditActionLabel('RECORD_PAYMENT', translations.fr), 'Paiement enregistré');
    assert.equal(auditActionLabel('RECORD_PAYMENT', translations.en), 'Payment recorded');
    assert.equal(auditActionLabel('update_setting', translations.fr), 'Réglage modifié');
    // Les blocages de poste remontent des PHRASES comme action (desktopUpdateReport) :
    // les traduire demanderait de les comprendre, donc elles passent inchangées.
    const phrase = 'poste bloqué — mise à jour obligatoire (checksum)';
    assert.equal(auditActionLabel(phrase, translations.fr), phrase);
    assert.equal(auditActionLabel('', translations.fr), '');
    assert.equal(auditActionLabel(null, translations.fr), '');
  });
});

describe('auditDisplay — les entrées anglaises d’hier se lisent en français', () => {
  it('traduit le gabarit de paiement dans la forme que les écritures d’aujourd’hui produisent', () => {
    assert.equal(
      localizeAuditDetails('Payment of 80000 FCFA recorded (Receipt: REC-690078)', 'fr'),
      'Paiement de 80000 FCFA (reçu REC-690078)',
    );
  });

  it('traduit l’import Excel et la promotion de classe', () => {
    assert.equal(
      localizeAuditDetails('Imported 12 students record(s) via Excel (3 updated, 0 errors)', 'fr'),
      'Import Excel : 12 students, 3 mis à jour, 0 erreur(s)',
    );
    assert.equal(
      localizeAuditDetails('Processed batch promotions/re-enrollments for 24 student(s)', 'fr'),
      'Promotions/réinscriptions traitées pour 24 élève(s)',
    );
  });

  it('garde le marqueur de rejeu, et ne touche à rien d’autre', () => {
    assert.equal(
      localizeAuditDetails('Payment of 100 FCFA recorded (Receipt: REC-1) [replay]', 'fr'),
      'Paiement de 100 FCFA (reçu REC-1) [replay]',
    );
    // Une entrée qu'on ne sait pas traduire n'est pas devinée : elle est rendue telle quelle.
    const other = 'Dossier E2E 520842 — relance envoyée';
    assert.equal(localizeAuditDetails(other, 'fr'), other);
    assert.equal(localizeAuditDetails('', 'fr'), '');
    assert.equal(localizeAuditDetails(null, 'fr'), '');
    // En anglais, la phrase d'origine est déjà dans la bonne langue.
    assert.equal(localizeAuditDetails('Payment of 1 FCFA recorded (Receipt: R)', 'en'), 'Payment of 1 FCFA recorded (Receipt: R)');
  });
});

describe('auditDisplay — aucun gabarit anglais ne peut revenir à l’ÉCRITURE', () => {
  it('les phrases anglaises ne subsistent que comme motifs de LECTURE', () => {
    const writers = collect(join(root, 'src')).filter((file) => !file.endsWith(join('lib', 'auditDisplay.ts')));
    const offenders: string[] = [];
    for (const file of writers) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^\s*details:.*(Payment of|record\(s\) via Excel|batch promotions).*$/gm)) {
        offenders.push(`${file.replace(root, '').replace(/\\/g, '/')} : ${m[0].trim().slice(0, 70)}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `un détail écrit en anglais reviendrait dans le journal (il n’est traduit qu’à la lecture) :\n${offenders.join('\n')}`,
    );
  });
});
