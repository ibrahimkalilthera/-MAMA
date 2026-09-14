// Suite de src/lib/academicYears.ts + la règle qui a produit l'incident du
// 2026-09-13 : un élève enregistré, présent en base, et INVISIBLE.
//
// Deux valeurs par défaut vivaient chacune de son côté, en dur : l'app ouvrait le
// tableau de bord sur `2026-2027` et le formulaire d'élève écrivait `2024-2025`.
// Rien n'était cassé côté serveur — ce qu'on enregistrait n'était jamais l'année
// qu'on regardait.
//
// La première réparation a fait venir l'année de `academic_years.is_current`.
// C'était nécessaire et insuffisant : `is_current` est un réglage manuel, et il
// était DÉJÀ périmé dans la base (il disait 2025-2026 pendant que l'app affichait
// 2026-2027). Une année qui dépend d'un geste annuel revient toujours avec un an
// de retard. Les cas ci-dessous verrouillent la règle qui remplace ça : l'année de
// travail est celle du CALENDRIER, elle avance seule au 1er septembre, et aucune
// déclaration périmée ne peut la retenir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  FALLBACK_ACADEMIC_YEARS,
  YEAR_STORAGE_KEY,
  currentYearName,
  pickWorkingYear,
  readStoredYear,
  schoolYearName,
  storeYear,
  yearNames,
} from '../src/lib/academicYears';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Un stockage minimal, comme `localStorage` — sans DOM. */
const fakeStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    has: (k: string) => map.has(k),
    value: (k: string) => map.get(k),
  };
};

describe('l’année scolaire est celle du CALENDRIER', () => {
  it('bascule au 1er septembre, et pas au 1er janvier', () => {
    assert.equal(schoolYearName('2026-09-01'), '2026-2027');
    assert.equal(schoolYearName('2026-12-31'), '2026-2027');
    assert.equal(schoolYearName('2027-08-31'), '2026-2027');
    assert.equal(schoolYearName('2027-09-01'), '2027-2028');
    assert.equal(schoolYearName(new Date(2028, 0, 15)), '2027-2028', 'mi-janvier appartient à l’année commencée en septembre');
  });

  it('ne devine rien à partir d’une date illisible', () => {
    assert.equal(schoolYearName('pas une date'), '');
    assert.equal(schoolYearName(new Date('invalid')), '');
  });
});

describe('les années viennent de la base, pas d’une liste en dur', () => {
  const rows = [
    { year_name: '2024-2025', is_current: false },
    { year_name: '2025-2026', is_current: true },
    { year_name: '2026-2027', is_current: false },
  ];
  const today = '2026-09-14';

  it('trie et dédoublonne les libellés', () => {
    assert.deepEqual(yearNames([{ year_name: '2026-2027' }, { year_name: '2024-2025' }, { year_name: '2026-2027' }]), [
      '2024-2025',
      '2026-2027',
    ]);
  });

  it('lit l’année marquée `is_current`, et la plus récente quand aucune ne l’est', () => {
    assert.equal(currentYearName(rows), '2025-2026');
    assert.equal(currentYearName(rows.map((r) => ({ ...r, is_current: false }))), '2026-2027');
    assert.equal(currentYearName([]), null);
  });

  it('travaille dans l’année du calendrier, PAS dans la déclaration périmée', () => {
    // Le cas mesuré en production : la base déclarait 2025-2026 (`is_current`)
    // pendant que l'app affichait 2026-2027 — deux années vides, un élève dans
    // une troisième. La déclaration en retard n'est plus écoutée du tout.
    assert.equal(pickWorkingYear({ rows, today }), '2026-2027');
  });

  it('suit une déclaration EN AVANCE : une école peut préparer la rentrée', () => {
    const prepared = [
      { year_name: '2026-2027', is_current: false },
      { year_name: '2027-2028', is_current: true },
    ];
    assert.equal(pickWorkingYear({ rows: prepared, today }), '2027-2028');
  });

  it('travaille dans l’année du calendrier même quand la base ne la connaît pas encore', () => {
    // 1er septembre : personne n'a créé la ligne, et retomber sur l'année
    // précédente serait exactement la panne d'origine. C'est l'entretien qui
    // ajoute la ligne, pas l'année de travail qui attend.
    assert.equal(pickWorkingYear({ rows, today: '2027-09-01' }), '2027-2028');
  });
});

describe('le choix de l’utilisateur est respecté, mais pas au-delà de son année', () => {
  const rows = [
    { year_name: '2024-2025', is_current: false },
    { year_name: '2025-2026', is_current: false },
    { year_name: '2026-2027', is_current: false },
    { year_name: '2027-2028', is_current: false },
  ];

  it('respecte un choix fait pendant l’année scolaire en cours', () => {
    const stored = { year: '2024-2025', at: '2026-09-20T08:00:00.000Z' };
    assert.equal(pickWorkingYear({ rows, stored, today: '2026-09-25' }), '2024-2025', 'consulter une archive reste possible');
  });

  it('ABANDONNE un choix fait une année scolaire plus tôt — l’app avance seule', () => {
    const stored = { year: '2026-2027', at: '2026-10-02T08:00:00.000Z' };
    assert.equal(
      pickWorkingYear({ rows, stored, today: '2027-09-05' }),
      '2027-2028',
      'sans cet abandon, chaque poste resterait des années sur l’année où son utilisateur a cliqué pour la dernière fois',
    );
  });

  it('un choix sans date ne peut pas retenir le poste sur une année passée', () => {
    assert.equal(pickWorkingYear({ rows, stored: { year: '2026-2027', at: '' }, today: '2027-09-05' }), '2027-2028');
  });

  it('IGNORE un choix qui n’existe plus en base : une année fantôme afficherait un zéro définitif', () => {
    const stored = { year: '2019-2020', at: '2026-09-20T08:00:00.000Z' };
    assert.equal(pickWorkingYear({ rows, stored, today: '2026-09-25' }), '2026-2027');
  });

  it('tient hors ligne : le choix récent, sinon le calendrier', () => {
    const stored = { year: '2025-2026', at: '2026-09-20T08:00:00.000Z' };
    assert.equal(pickWorkingYear({ rows: [], stored, today: '2026-09-25' }), '2025-2026');
    assert.equal(pickWorkingYear({ rows: [], stored: null, today: '2026-09-25' }), '2026-2027');
  });

  it('se rabat sur la plus récente quand l’horloge est cassée', () => {
    assert.equal(pickWorkingYear({ rows, today: 'pas une date' }), '2027-2028');
    assert.equal(pickWorkingYear({ rows: [], today: 'pas une date' }), FALLBACK_ACADEMIC_YEARS[FALLBACK_ACADEMIC_YEARS.length - 1]);
  });
});

describe('le choix est stocké avec son moment', () => {
  it('écrit puis relit l’année choisie ET sa date', () => {
    const storage = fakeStorage();
    storeYear('2024-2025', storage, new Date('2026-09-20T08:00:00.000Z'));
    const stored = readStoredYear(storage);
    assert.equal(stored?.year, '2024-2025');
    assert.equal(stored?.at, '2026-09-20T08:00:00.000Z', 'sans la date, impossible de savoir à quelle année ce choix appartenait');
    assert.match(storage.value(YEAR_STORAGE_KEY) ?? '', /^\{"year"/, 'la forme stockée porte le moment');
  });

  it('lit encore l’ancienne forme (chaîne nue), sans lui faire confiance', () => {
    const storage = fakeStorage({ [YEAR_STORAGE_KEY]: '2026-2027' });
    assert.deepEqual(readStoredYear(storage), { year: '2026-2027', at: '' });
  });

  it('ne casse rien quand le stockage est indisponible (mode privé, quota) ou illisible', () => {
    const throwing = {
      getItem: () => {
        throw new Error('refusé');
      },
      setItem: () => {
        throw new Error('refusé');
      },
    };
    assert.equal(readStoredYear(throwing), null);
    assert.doesNotThrow(() => storeYear('2024-2025', throwing));
    assert.equal(readStoredYear(undefined), null);
    assert.doesNotThrow(() => storeYear('2024-2025', undefined));
    assert.equal(readStoredYear(fakeStorage({ [YEAR_STORAGE_KEY]: '{cassé' })), null);
  });
});

describe('les littéraux et les chemins qui ont produit l’incident ne peuvent plus revenir', () => {
  it('le formulaire d’élève n’écrit plus d’année en dur', () => {
    const source = read('src/app/useStudents.ts');
    assert.doesNotMatch(source, /'2024-2025'/, 'une année littérale dans le formulaire réécrit hors de l’année regardée');
    assert.match(source, /academicYear: studentForm\.academicYear \|\| selectedYear/, 'l’année ÉCRITE est celle qui est AFFICHÉE');
  });

  it('le fournisseur d’année n’a plus d’année par défaut inventée, et date son choix', () => {
    const source = read('src/app/YearProvider.tsx');
    assert.doesNotMatch(source, /useState<string>\('\d{4}-\d{4}'\)/, 'un défaut en dur ramène l’app sur une année vide à chaque rechargement');
    assert.match(source, /readStoredYear/, 'l’année de travail doit survivre au rechargement');
    assert.match(source, /storeYear/, 'et le choix doit être daté');
  });

  it('la liste des années n’est plus une constante d’App.tsx', () => {
    assert.doesNotMatch(read('src/App.tsx'), /useState<string\[\]>\(\['\d{4}-\d{4}'/);
    assert.match(read('src/App.tsx'), /useAcademicYears\(/, 'la liste vient du hook qui lit la base');
    assert.match(read('src/App.tsx'), /isAdmin/, 'la maintenance de la déclaration est réservée aux rôles que la policy autorise');
  });

  it('l’année de travail est calculée sur l’horloge, pas recopiée', () => {
    const source = read('src/app/useAcademicYears.ts');
    assert.match(source, /pickWorkingYear\(\{[^}]*today/, 'sans `today`, l’année ne bascule pas au 1er septembre');
    assert.doesNotMatch(source, /'\d{4}-\d{4}'/, 'aucune année littérale dans le chemin qui fixe l’année de travail');
  });

  it('la déclaration partagée est entretenue, et seulement elle', () => {
    const source = read('src/lib/dataOps/academicYears.ts');
    assert.match(source, /export async function keepAcademicYearCurrent/, 'l’année de la rentrée doit pouvoir se créer toute seule');
    assert.match(source, /insert\(\{ year_name: year, is_current: true \}\)/, 'la ligne manquante est créée');
  });
});
