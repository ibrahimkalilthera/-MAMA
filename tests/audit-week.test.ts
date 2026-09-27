// Suite for src/lib/auditWeek.ts — la fenêtre du journal hebdomadaire.
//
// Ce que ces cas protègent, et pourquoi ils valent la peine :
//   • la SEMAINE elle-même (lundi → dimanche, heure locale) — c'est elle qui
//     décide ce qu'un PDF intitulé « semaine 39 » contient ;
//   • le NUMÉRO ISO aux deux bords de l'année, parce que c'est là que « l'année
//     de la semaine » n'est pas « l'année du jour » (29 déc. 2025 → semaine 1 de
//     2026 ; 3 janv. 2027 → semaine 53 de 2026) — un numéro dérivé de l'année
//     civile ferait mentir l'étiquette du document ;
//   • le REFUS de deviner : une entrée sans date lisible n'est pas rangée dans
//     une semaine.
//
// Suite de logique pure : pas de DOM, pas d'horloge — chaque date est passée en
// paramètre, donc chaque cas rend le même verdict tous les jours.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { auditWeekFilename, auditWeekOf, entriesInWeek, recentAuditWeeks } from '../src/lib/auditWeek';
import type { AuditLogEntry } from '../src/lib/auditLogger';

/** Une entrée minimale du journal, datée — c'est tout ce que le module lit. */
function entry(id: string, createdAt: string): AuditLogEntry {
  return { id, action: 'ADD_STUDENT', createdAt };
}

describe('auditWeekOf — la semaine ISO, du lundi au dimanche', () => {
  it('rend la fenêtre entière d’une date du milieu de semaine', () => {
    // Samedi 26 septembre 2026 : semaine 39, du lundi 21 au dimanche 27.
    const week = auditWeekOf(new Date(2026, 8, 26, 14, 30, 0));
    assert.equal(week.key, '2026-S39');
    assert.equal(week.isoYear, 2026);
    assert.equal(week.isoWeek, 39);
    assert.equal(week.start.getFullYear(), 2026);
    assert.equal(week.start.getMonth(), 8);
    assert.equal(week.start.getDate(), 21);
    assert.equal(week.start.getHours(), 0);
    assert.equal(week.start.getMinutes(), 0);
    assert.equal(week.end.getDate(), 27);
    assert.equal(week.end.getHours(), 23);
    assert.equal(week.end.getMinutes(), 59);
    assert.equal(week.end.getSeconds(), 59);
    assert.equal(week.end.getMilliseconds(), 999);
    // Les bornes ISO sont celles de la fenêtre, pas celles du jour passé.
    assert.equal(week.startIso, week.start.toISOString());
    assert.equal(week.endIso, week.end.toISOString());
  });

  it('le LUNDI appartient à sa semaine, le DIMANCHE aussi (bornes incluses)', () => {
    const monday = auditWeekOf(new Date(2026, 8, 21, 0, 0, 0));
    const sunday = auditWeekOf(new Date(2026, 8, 27, 23, 59, 59));
    // Deux instants opposés de la même semaine rendent la MÊME fenêtre : c'est
    // la propriété qui rend le découpage utilisable comme archive.
    assert.equal(monday.key, sunday.key);
    assert.equal(monday.startIso, sunday.startIso);
    assert.equal(monday.endIso, sunday.endIso);
  });

  it('l’année de la semaine n’est pas toujours l’année du jour (bord de l’année)', () => {
    // Lundi 29 décembre 2025 : lundi de la semaine 1 de 2026.
    const newYearEve = auditWeekOf(new Date(2025, 11, 29, 9, 0, 0));
    assert.deepEqual([newYearEve.isoYear, newYearEve.isoWeek], [2026, 1]);
    assert.equal(newYearEve.key, '2026-S1');
    // Dimanche 3 janvier 2027 : il appartient à la semaine 53 de 2026.
    const firstSunday = auditWeekOf(new Date(2027, 0, 3, 9, 0, 0));
    assert.deepEqual([firstSunday.isoYear, firstSunday.isoWeek], [2026, 53]);
    assert.equal(firstSunday.key, '2026-S53');
  });
});

describe('recentAuditWeeks — les semaines offertes à l’archivage', () => {
  it('rend la semaine en cours en PREMIER, puis les précédentes', () => {
    const weeks = recentAuditWeeks(new Date(2026, 8, 26, 12, 0, 0), 3);
    assert.deepEqual(weeks.map((w) => w.key), ['2026-S39', '2026-S38', '2026-S37']);
    // Chaque fenêtre est la précédente moins sept jours, à la seconde près.
    assert.equal(weeks[1]!.end.getTime(), weeks[0]!.start.getTime() - 1);
  });

  it('traverse le bord de l’année sans trou ni doublon', () => {
    const weeks = recentAuditWeeks(new Date(2026, 0, 5, 12, 0, 0), 4);
    // 2025 n'a que 52 semaines ISO : la précédente de 2026-S1 est 2025-S52.
    assert.deepEqual(weeks.map((w) => w.key), ['2026-S2', '2026-S1', '2025-S52', '2025-S51']);
    assert.equal(new Set(weeks.map((w) => w.key)).size, weeks.length);
  });

  it('demander zéro semaine en offre quand même une — un menu vide serait un écran mort', () => {
    const weeks = recentAuditWeeks(new Date(2026, 8, 26, 12, 0, 0), 0);
    assert.equal(weeks.length, 1);
  });
});

describe('entriesInWeek — ce qui tombe DANS la semaine', () => {
  const week = auditWeekOf(new Date(2026, 8, 26, 12, 0, 0)); // 21 → 27 sept. 2026

  it('garde les entrées de la fenêtre et écarte les autres', () => {
    const kept = entriesInWeek(
      [
        entry('lundi-minuit', '2026-09-21T00:00:00.000'),
        entry('dimanche-soir', '2026-09-27T23:59:59.999'),
        entry('juste-avant', '2026-09-20T23:59:59.999'),
        entry('juste-apres', '2026-09-28T00:00:00.000'),
      ],
      week,
    );
    // Les deux bornes de la semaine sont DEDANS, les deux voisines DEHORS.
    assert.deepEqual([...kept.map((e) => e.id)].sort(), ['dimanche-soir', 'lundi-minuit']);
  });

  it('rend les entrées de la plus récente à la plus ancienne', () => {
    const kept = entriesInWeek(
      [entry('plus-ancienne', '2026-09-21T08:00:00.000'), entry('plus-recente', '2026-09-26T18:00:00.000')],
      week,
    );
    assert.deepEqual(kept.map((e) => e.id), ['plus-recente', 'plus-ancienne']);
  });

  it('ne devine pas : une date illisible n’est rangée dans aucune semaine', () => {
    const kept = entriesInWeek([entry('sans-date', 'pas une date'), entry('bonne', '2026-09-24T10:00:00.000')], week);
    assert.deepEqual(kept.map((e) => e.id), ['bonne']);
  });

  it('une liste absente rend une liste vide, jamais une erreur', () => {
    assert.deepEqual(entriesInWeek(null, week), []);
    assert.deepEqual(entriesInWeek(undefined, week), []);
  });
});

describe('auditWeekFilename — un nom par semaine, pas par téléchargement', () => {
  it('porte la clé ISO de la semaine', () => {
    const week = auditWeekOf(new Date(2026, 8, 23, 12, 0, 0));
    assert.equal(auditWeekFilename(week), 'Journal_Audit_MAMA_THERA_2026-S39.pdf');
  });

  it('deux jours de la MÊME semaine donnent le MÊME nom', () => {
    const monday = auditWeekFilename(auditWeekOf(new Date(2026, 8, 21, 0, 0, 0)));
    const sunday = auditWeekFilename(auditWeekOf(new Date(2026, 8, 27, 23, 0, 0)));
    assert.equal(monday, sunday);
  });
});
