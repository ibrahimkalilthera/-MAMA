// Suite for src/lib/settingsAnchor.ts — « le rappel mène à la carte ».
//
// Ce que ces cas verrouillent, et pourquoi chacun est là :
//   • la LECTURE est pure (une chaîne → un booléen) et n'accepte QUE le
//     fragment du journal : `#audit-archive-2`, `#Audit-Archive` ou un autre
//     onglet ne doivent pas y mener — une ancre qui matche trop large défile
//     vers la mauvaise carte ;
//   • la demande POSE le fragment, et la consommation l'EFFACE : sans cet
//     effacement, revenir aux Réglages rejouerait le halo à chaque visite ;
//   • une autre ancre est laissée INTACTE — consommer celle du journal ne doit
//     pas nettoyer une adresse qui appartient à quelqu'un d'autre.
//
// Le module touche au DOM dans ses deux gestes : c'est la raison d'être de
// happy-dom ici (les cas purement purs seraient, eux, restés sans DOM).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_ARCHIVE_ANCHOR,
  consumeAuditArchiveAnchor,
  isAuditArchiveAnchor,
  requestAuditArchiveAnchor,
} from '../src/lib/settingsAnchor';
import { installDomGlobals } from './harness';

describe('settingsAnchor — la lecture est pure', () => {
  it('reconnaît le fragment du journal, avec ou sans dièse, et rien d’autre', () => {
    for (const accepted of [AUDIT_ARCHIVE_ANCHOR, `#${AUDIT_ARCHIVE_ANCHOR}`, `  #${AUDIT_ARCHIVE_ANCHOR}  `]) {
      assert.equal(isAuditArchiveAnchor(accepted), true, `${JSON.stringify(accepted)} désigne l’ancre`);
    }
    for (const rejected of ['', '   ', '#audit', '#Audit-Archive', '#audit-archive-2', '#students', null, undefined]) {
      assert.equal(
        isAuditArchiveAnchor(rejected as string | null | undefined),
        false,
        `${JSON.stringify(rejected)} ne la désigne pas`,
      );
    }
  });
});

describe('settingsAnchor — poser puis consommer', () => {
  const win = installDomGlobals();

  it('la demande pose le fragment, la consommation l’efface — une seule fois', () => {
    win.location.hash = '';
    requestAuditArchiveAnchor();
    assert.equal(isAuditArchiveAnchor(win.location.hash), true, 'le fragment est posé');

    assert.equal(consumeAuditArchiveAnchor(), true, 'elle est consommée');
    assert.equal(isAuditArchiveAnchor(win.location.hash), false, 'le fragment est effacé');
    assert.equal(consumeAuditArchiveAnchor(), false, 'un second montage ne la rejoue pas');
  });

  it('sans ancre demandée, rien n’est consommé ni effacé', () => {
    win.location.hash = '#students';
    assert.equal(consumeAuditArchiveAnchor(), false, 'aucune ancre du journal');
    assert.equal(win.location.hash, '#students', 'un fragment étranger est laissé intact');
    win.location.hash = '';
  });
});
