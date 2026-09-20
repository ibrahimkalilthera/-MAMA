/**
 * ─── Lire le journal d'audit : le CODE devient un MOT, l'anglais se traduit ──
 *
 * Deux défauts, un seul sujet — ce que la page montre ne correspondait pas à ce
 * qu'elle est : française partout sauf dans les deux colonnes du milieu, où
 * s'affichaient `ADD_VENDOR_EXPENSE` et « Payment of 80000 FCFA recorded
 * (Receipt: REC-690078) ».
 *
 * **1. Le code de l'action est un identifiant, pas un libellé.** La colonne
 * ACTIONS affichait `log.action` tel quel. Les libellés vivent dans les
 * dictionnaires i18n (fr/en) comme tout le reste de l'interface, et la table
 * ci-dessous est le seul endroit qui relie un code à sa clé — un test refuse un
 * code écrit par `src/` sans libellé, donc un nouvel événement ne peut pas
 * arriver à l'écran sous forme de code.
 *
 * **2. Les entrées déjà écrites restent lisibles sans être réécrites.** Trois
 * gabarits écrivaient de l'anglais dans `details` (voir `localizeAuditDetails`).
 * La réparation n'est PAS une réécriture en base : un journal d'audit qui se
 * réécrit n'est plus une trace, et c'est exactement ce qu'on lui demande d'être.
 * On traduit donc à la LECTURE, pour les gabarits connus exactement, et tout le
 * reste passe inchangé — une entrée qu'on ne sait pas traduire n'est pas devinée.
 */
import type { TranslationDict } from '../i18n/translations';

/**
 * Le code d'action → la clé i18n de son libellé.
 *
 * Les codes sont ceux que `logAuditEvent` reçoit dans `src/` (mesuré par le
 * test, pas recopiés à la main) ; `UPDATE_SETTING` est écrit en minuscules par
 * l'écran de réglages, donc les deux graphies sont présentes et pointent sur le
 * même libellé.
 */
export const AUDIT_ACTION_KEYS: Record<string, string> = {
  ADD_EXPENSE: 'auditActionAddExpense',
  ADD_PARENT: 'auditActionAddParent',
  ADD_STAFF: 'auditActionAddStaff',
  ADD_STUDENT: 'auditActionAddStudent',
  ADD_VENDOR_EXPENSE: 'auditActionAddVendorExpense',
  BATCH_IMPORT: 'auditActionBatchImport',
  DELETE_EXPENSE: 'auditActionDeleteExpense',
  DELETE_PARENT: 'auditActionDeleteParent',
  DELETE_STAFF: 'auditActionDeleteStaff',
  DELETE_STUDENT: 'auditActionDeleteStudent',
  DELETE_VENDOR_EXPENSE: 'auditActionDeleteVendorExpense',
  PROMOTE_CLASS_BATCH: 'auditActionPromoteClassBatch',
  RECORD_PAYMENT: 'auditActionRecordPayment',
  RECORD_SALARY_PAYMENT: 'auditActionRecordSalaryPayment',
  UPDATE_EXPENSE: 'auditActionUpdateExpense',
  UPDATE_PARENT: 'auditActionUpdateParent',
  UPDATE_SETTING: 'auditActionUpdateSetting',
  update_setting: 'auditActionUpdateSetting',
  UPDATE_STAFF: 'auditActionUpdateStaff',
  UPDATE_STUDENT: 'auditActionUpdateStudent',
  UPDATE_VENDOR_EXPENSE: 'auditActionUpdateVendorExpense',
};

/** Le marqueur de rejeu hors-ligne, ajouté à la fin de `details` (voir offlineReplay). */
const REPLAY_TAG = '[replay]';

/**
 * Le libellé d'une action, ou le code lui-même quand il n'en a pas.
 *
 * Le repli n'invente rien : une valeur inconnue s'affiche telle qu'elle est
 * écrite. C'est ce qui laisse passer les phrases que le poste remonte
 * (`desktopUpdateReport` écrit des phrases françaises entières comme action) —
 * les traduire demanderait de les comprendre.
 */
export function auditActionLabel(action: string | null | undefined, t: TranslationDict): string {
  const code = String(action ?? '').trim();
  const key = AUDIT_ACTION_KEYS[code];
  const label = key ? t[key as keyof TranslationDict] : undefined;
  return typeof label === 'string' && label.trim() ? label : code;
}

/** Les gabarits anglais écrits par les versions précédentes, et leur lecture. */
const LEGACY_DETAILS: { pattern: RegExp; render: (m: RegExpExecArray) => string }[] = [
  {
    // dataOps/payments.ts et offlineReplay.ts.
    pattern: /^Payment of ([\d\s.,]+) FCFA recorded \(Receipt: (.+)\)$/,
    render: (m) => `Paiement de ${m[1]} FCFA (reçu ${m[2]})`,
  },
  {
    // lib/batchImport.ts.
    pattern: /^Imported (\d+) ([a-z_]+) record\(s\) via Excel \((\d+) updated, (\d+) errors\)$/,
    render: (m) => `Import Excel : ${m[1]} ${m[2]}, ${m[3]} mis à jour, ${m[4]} erreur(s)`,
  },
  {
    // dataOps/students.ts.
    pattern: /^Processed batch promotions\/re-enrollments for (\d+) student\(s\)$/,
    render: (m) => `Promotions/réinscriptions traitées pour ${m[1]} élève(s)`,
  },
];

/**
 * Le détail d'une entrée, tel qu'il doit se lire maintenant.
 *
 * En anglais, la phrase d'origine est déjà dans la bonne langue : elle est
 * rendue inchangée. En français, chaque gabarit connu est réécrit **dans la
 * forme exacte que les écritures d'aujourd'hui produisent** — une entrée d'hier
 * et une entrée d'aujourd'hui se lisent donc pareil, ce qui évite deux styles
 * pour un même fait. Tout ce qui ne correspond à aucun gabarit est rendu tel
 * quel.
 *
 * @param details la valeur stockée (peut porter le marqueur de rejeu)
 * @param lang la langue de l'interface
 */
export function localizeAuditDetails(details: string | null | undefined, lang: string): string {
  const text = String(details ?? '');
  if (!text || lang === 'en') return text;
  const tagged = text.endsWith(REPLAY_TAG);
  const body = (tagged ? text.slice(0, -REPLAY_TAG.length) : text).trim();
  for (const entry of LEGACY_DETAILS) {
    const matched = entry.pattern.exec(body);
    if (matched) return tagged ? `${entry.render(matched)} ${REPLAY_TAG}` : entry.render(matched);
  }
  return text;
}
