/**
 * Le RELEVÉ DE COMPTE FAMILIAL (`useParents.handleExportParentLedgerPdf`) — le
 * document que la famille garde. Le propriétaire a demandé le 2026-10-06 que le
 * MATRICULE de l'élève y figure « pour que les familles puissent s'y référer ».
 *
 * jsPDF ne tourne pas sous happy-dom : l'export est donc exécuté POUR DE VRAI
 * (le hook est monté, la fonction appelée) contre un faux jsPDF qui n'imprime
 * pas — il ENREGISTRE chaque texte dessiné avec sa position. C'est ce qui permet
 * d'affirmer non seulement le contenu, mais la COLONNE où il tombe : un
 * matricule imprimé au mauvais x serait illisible, et un test qui ne vérifie que
 * le contenu ne le verrait pas.
 *
 * Les deux colonnes qui comptent ici :
 *   • le tableau des ENFANTS portait déjà le matricule (x = 18) ;
 *   • le tableau des REÇUS le porte désormais (x = 112), et garde ses colonnes
 *     d'origine quand AUCUN reçu n'a de matricule — un document existant ne se
 *     décale pas pour une colonne vide.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Parent, Student } from '../src/app/types';
import { installDomGlobals, renderHook } from './harness';
import { mockModule } from './module-mock';

// ── faux jsPDF : il n'imprime pas, il enregistre ────────────────────────────
interface TextCall { str: string; x: number; y: number }
const texts: TextCall[] = [];
const downloads: { filename: string; bytes: Uint8Array | ArrayBuffer }[] = [];

class FakeJsPDF {
  addPage(): void {}
  setFillColor(): void {}
  setDrawColor(): void {}
  setTextColor(): void {}
  setFont(): void {}
  setFontSize(): void {}
  rect(): void {}
  roundedRect(): void {}
  line(): void {}
  text(str: string, x: number, y: number): void { texts.push({ str, x, y }); }
  output(): ArrayBuffer { return new ArrayBuffer(8); }
}

mockModule('jspdf', { jsPDF: FakeJsPDF });
// Le cachet n'est pas ce qu'on mesure ici, et son chargement réseau rendrait le
// cas dépendant du réseau du poste.
mockModule('../src/lib/pdfStamp', { drawSchoolStamp: async () => {} });
// Le téléchargement non plus : on retient le NOM du fichier, pas les octets.
mockModule('../src/lib/browserDownload', {
  downloadBytes: (bytes: Uint8Array | ArrayBuffer, filename: string) => { downloads.push({ filename, bytes }); },
});

const { useParents } = await import('../src/app/useParents');
import type { UseParentsArgs } from '../src/app/useParents';

const t = translations.fr as TranslationDict;
installDomGlobals();

type ParentsApi = ReturnType<typeof useParents>;

const parent: Parent = {
  id: 'p1',
  fullName: 'Djeneba Traoré',
  phones: ['0700000000'],
  address: 'Bamako',
  occupation: 'Commerçante',
  relationship: 'Mother',
};

const child = (id: string, name: string, studentId: string | undefined, receiptNumber: string): Student => ({
  id, name, studentId, parentId: 'p1',
  parentName: 'Djeneba Traoré', parentEmail: '', parentPhone: '',
  totalDue: 100000, amountPaid: 25000, dueDate: '2026-12-31',
  payments: [{ id: `${id}-p`, date: '2026-10-04', amount: 25000, academicYear: '2026-2027', receiptNumber }],
  notes: '',
});

function baseArgs(students: Student[]): UseParentsArgs {
  return {
    t,
    lang: 'fr',
    formatCurrency: (amount: number) => `${amount} FCFA`,
    students,
    setStudents: () => {},
    addParent: async () => null,
    updateParent: async () => true,
    deleteParent: async () => true,
    updateStudent: async () => true,
    setWelcomeMessage: () => {},
    setConfirmAction: () => {},
  };
}

async function exportLedger(students: Student[]) {
  texts.length = 0;
  downloads.length = 0;
  const ref: { current: ParentsApi | null } = { current: null };
  const { unmount } = renderHook(useParents, baseArgs(students), ref);
  try {
    await act(async () => { await ref.current?.handleExportParentLedgerPdf(parent); });
    assert.equal(downloads.length, 1, 'le relevé est téléchargé une seule fois');
    return downloads[0].filename;
  } finally {
    await act(async () => unmount());
  }
}

const at = (str: string, x: number) => texts.some((c) => c.str === str && c.x === x);

describe('relevé de compte familial — le matricule de l’élève', () => {
  it('imprime le matricule en colonne du tableau des reçus, libellé compris', async () => {
    const filename = await exportLedger([child('s1', 'Awa Traoré', 'MT-2026-042', 'REC-001')]);

    assert.ok(filename.startsWith('Releve_Parent_'), `nom de fichier inattendu : ${filename}`);
    assert.ok(filename.endsWith('.pdf'));

    // Le libellé de la colonne, pris au dictionnaire (« MATRICULE » en français).
    assert.ok(at(t.studentId, 112), `en-tête matricule absent du tableau des reçus (x=112)`);
    // La valeur, dans cette colonne, pour la ligne du reçu.
    assert.ok(at('MT-2026-042', 112), 'le matricule n’est pas imprimé sur la ligne du reçu');
    // Le tableau des enfants garde le sien.
    assert.ok(at('MT-2026-042', 18), 'le tableau des enfants a perdu son matricule');
    // Les autres colonnes se sont décalées pour lui faire place.
    assert.ok(at('REC-001', 18), 'le n° de reçu a quitté sa colonne');
    assert.ok(at('2026-2027', 142), 'l’année a quitté sa colonne');
    assert.ok(texts.some((c) => c.str.includes('FCFA') && c.x === 168), 'le montant a quitté sa colonne');
  });

  it('garde les colonnes d’origine quand aucun reçu ne porte de matricule', async () => {
    await exportLedger([child('s2', 'Coumba', undefined, 'REC-002')]);

    assert.equal(texts.some((c) => c.x === 112), false, 'aucune colonne matricule sans matricule');
    assert.ok(at('Coumba', 75), 'le nom reprend la colonne d’origine (x=75)');
    assert.ok(at('2026-2027', 125), 'l’année garde la sienne (x=125)');
    assert.ok(texts.some((c) => c.str.includes('FCFA') && c.x === 165), 'le montant garde la sienne (x=165)');
    // Aucun matricule nul ne doit être imprimé comme s'il en existait un.
    assert.equal(texts.some((c) => c.str === 'MT-2026-042'), false);
  });
});
