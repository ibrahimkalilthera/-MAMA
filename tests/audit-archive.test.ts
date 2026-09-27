// Suite for src/lib/auditArchive.ts — « la semaine précédente n'a pas encore été
// archivée en PDF ».
//
// Ce que ces cas verrouillent, et pourquoi chacun est là :
//   • « la semaine précédente » est la semaine ISO d'avant, terminée — pas les
//     sept derniers jours, et pas la semaine en cours ;
//   • une archive est PROUVÉE par une entrée du journal dont la cible est la clé
//     de la semaine — ni par une autre action, ni par une autre semaine, ni par
//     un texte libre où l'on devinerait une clé ;
//   • il n'y a rien à signaler quand la semaine est vide (rien à classer) ou
//     quand son archive est déjà écrite ;
//   • la date d'ancrage du rappel est un JOUR civil — le format que le panneau
//     découpe pour ouvrir le calendrier.
//
// Et le dernier cas est un scan de source : le composant qui archive doit écrire
// le MÊME code d'action que celui que ce module cherche, sinon le rappel ne
// s'éteindrait jamais sans qu'aucun test ne s'en aperçoive.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AUDIT_ARCHIVE_ACTION,
  AUDIT_ARCHIVE_TARGET,
  archiveReminderDate,
  archivedWeekKeys,
  isWeekArchived,
  previousAuditWeek,
  unarchivedPreviousWeek,
} from '../src/lib/auditArchive';
import { auditWeekOf } from '../src/lib/auditWeek';
import type { AuditLogEntry } from '../src/lib/auditLogger';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Le jour d'ancrage : toutes les semaines de cette suite en découlent. */
const ANCHOR = new Date(2026, 8, 27, 15, 30);

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: overrides.id ?? 'e',
    action: 'RECORD_PAYMENT',
    createdAt: new Date(2026, 8, 21, 10, 0).toISOString(),
    ...overrides,
  };
}

/** Une entrée d'archive pour la clé donnée. */
function archiveEntry(weekKey: string, id = `archive-${weekKey}`): AuditLogEntry {
  return entry({
    id,
    action: AUDIT_ARCHIVE_ACTION,
    targetType: AUDIT_ARCHIVE_TARGET,
    targetId: weekKey,
    createdAt: new Date(2026, 8, 28, 9, 0).toISOString(),
  });
}

const previous = previousAuditWeek(ANCHOR);
/** Une entrée ordinaire PENDANT la semaine précédente (quelque chose à classer). */
const workInPreviousWeek = entry({
  id: 'worked',
  createdAt: new Date(previous.start.getTime() + 36 * 60 * 60 * 1000).toISOString(),
});

describe('auditArchive — quelle semaine, et qu’est-ce qui prouve une archive', () => {
  it('« la semaine précédente » est la semaine ISO d’avant, terminée', () => {
    assert.equal(previous.start.getDay(), 1, 'elle commence un lundi');
    assert.equal(previous.end.getDay(), 0, 'elle finit un dimanche');
    assert.ok(previous.end.getTime() < ANCHOR.getTime(), 'et elle est terminée');
    const current = auditWeekOf(ANCHOR);
    assert.equal(
      current.start.getTime() - previous.start.getTime(),
      7 * 24 * 60 * 60 * 1000,
      'exactement une semaine avant la semaine en cours',
    );
    assert.notEqual(previous.key, current.key, 'ce n’est donc pas la semaine en cours');
  });

  it('la clé ISO change d’année civile au passage du nouvel an', () => {
    // Le lundi 5 janv. 2026 appartient à la semaine 2 de 2026 ; la semaine d'avant
    // commence le 29 déc. 2025 et porte la clé 2026-S1 (elle contient le jeudi
    // 1er janv. 2026). Dériver l'année du jour regardé donnerait « 2025-S1 ».
    assert.equal(previousAuditWeek(new Date(2026, 0, 5)).key, '2026-S1');
  });

  it('une archive se prouve par sa cible, jamais par une autre action', () => {
    const entries: AuditLogEntry[] = [
      archiveEntry('2026-S39'),
      entry({ id: 'other', targetType: AUDIT_ARCHIVE_TARGET, targetId: '2026-S39' }),
      entry({ id: 'empty', action: AUDIT_ARCHIVE_ACTION, targetType: AUDIT_ARCHIVE_TARGET, targetId: '' }),
      entry({ id: 'free', action: AUDIT_ARCHIVE_ACTION, details: '2026-S39 archivée' }),
    ];
    assert.deepEqual([...archivedWeekKeys(entries)], ['2026-S39'], 'seule la cible d’une vraie archive compte');
    assert.equal(isWeekArchived(entries, '2026-S39'), true);
    assert.equal(isWeekArchived(entries, '2026-S40'), false, 'une autre semaine n’est pas archivée par celle-ci');
    assert.equal(isWeekArchived(null, '2026-S39'), false, 'un journal illisible ne vaut pas une archive');
  });

  it('la semaine précédente est signalée quand elle a du travail et aucune archive', () => {
    const week = unarchivedPreviousWeek(ANCHOR, [workInPreviousWeek]);
    assert.equal(week?.key, previous.key);
  });

  it('son archive, même posée APRÈS la fin de la semaine, éteint le rappel', () => {
    // L'archive du lundi (28 sept.) vit hors de la fenêtre de la semaine — c'est
    // le cas courant, et le chercher dans la seule fenêtre le raterait.
    const entries = [workInPreviousWeek, archiveEntry(previous.key)];
    assert.equal(archivedWeekKeys(entries).has(previous.key), true);
    assert.equal(unarchivedPreviousWeek(ANCHOR, entries), null);
  });

  it('une semaine vide ne se signale pas — il n’y a rien à classer', () => {
    const currentOnly = [entry({ id: 'today', createdAt: new Date(2026, 8, 27, 9, 0).toISOString() })];
    assert.equal(unarchivedPreviousWeek(ANCHOR, currentOnly), null);
    assert.equal(unarchivedPreviousWeek(ANCHOR, []), null);
  });

  it('l’archive d’une AUTRE semaine ne dispense pas d’archiver la précédente', () => {
    const entries = [workInPreviousWeek, archiveEntry('2026-S1')];
    assert.equal(unarchivedPreviousWeek(ANCHOR, entries)?.key, previous.key);
  });

  it('la date du rappel est un JOUR civil, pas un instant', () => {
    const date = archiveReminderDate(previous);
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, 'le panneau découpe cette chaîne pour ouvrir le calendrier');
    const [y, m, d] = date.split('-').map(Number);
    assert.deepEqual(
      [y, m, d],
      [previous.end.getFullYear(), previous.end.getMonth() + 1, previous.end.getDate()],
      'le dimanche de la semaine, en heure locale',
    );
  });

  it('le code d’action est un format de fil, et l’écriture emploie celui qui est relu', () => {
    // Le format est lu par d'AUTRES postes : le changer renommerait une trace
    // déjà écrite, donc sa valeur est verrouillée ici.
    assert.equal(AUDIT_ARCHIVE_ACTION, 'EXPORT_AUDIT_JOURNAL');
    const source = readFileSync(join(root, 'src/lib/auditArchive.ts'), 'utf8');
    assert.match(source, /action:\s*AUDIT_ARCHIVE_ACTION/, 'l’écriture emploie le code relu, pas une copie');
    assert.match(source, /targetId:\s*week\.key/, 'la cible est la clé ISO de la semaine, pas une date');
  });
});
