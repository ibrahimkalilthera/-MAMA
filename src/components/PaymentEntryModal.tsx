/**
 * PaymentEntryModal — Payment entry form — extracted verbatim from AppModals. Cashier picks
 * the student (live outstanding balance) + amount + date and submits;
 * pure presentational, narrow props + overlayRef.
 *
 * Le SÉLECTEUR DE CLASSE réduit la liste avant la liste déroulante : dans un
 * établissement de plusieurs centaines d'élèves, choisir un nom dans une liste
 * plate demandait de la parcourir en entier. Une RECHERCHE par nom ou matricule
 * s'y combine (intersection) : on peut taper « Awa » ou un matricule dans une
 * classe déjà filtrée. Ces deux filtres sont LOCAUX (état du formulaire) : ils
 * ne changent pas la classe d'un élève ni aucun autre écran, ils ne font que
 * restreindre ce que la liste propose.
 *
 * Chaque ligne de la liste déroulante PORTE le matricule (« Awa — MATRICULE :
 * MT-2026-42 ») : une recherche réussie se vérifie des yeux, au lieu d'un nom
 * seul qui laisse le caissier deviner si c'est bien l'élève du reçu.
 *
 * Le MOTIF (voir src/lib/paymentMotifs.ts) est un choix SIMPLE, placé juste
 * AU-DESSUS des mois : « Frais de scolarité » (le geste ordinaire, proposé
 * d'avance) ou « Inscription ». C'est ce mot que la ligne « Motif » du reçu
 * officiel imprime — il est donc choisi ici, une fois, et gardé en base.
 *
 * L'INSCRIPTION change la RÈGLE DES MOIS et rien d'autre : c'est un droit
 * d'entrée, il ne couvre aucun mois de scolarité, donc les pastilles cessent
 * d'être obligatoires (elles restent proposées — une famille peut régler les
 * deux le même matin). Exiger un mois pour une inscription rendrait le guichet
 * infranchissable le jour de la rentrée.
 *
 * Les MOIS PAYÉS (voir src/lib/paymentMonths.ts) sont des PASTILLES, une par
 * mois de l'année scolaire, et pas une liste déroulante multiple : douze mois
 * tiennent à l'écran, et un clic dit exactement ce qu'il coche. Le mois de la
 * date est coché d'avance, donc un encaissement ordinaire reste UN geste ; la
 * ligne sous les pastilles montre le texte EXACT que le reçu imprimera, pour
 * qu'une plage ou une liste se vérifie avant l'impression, pas après.
 *
 * Un mois DÉJÀ réglé pour l'élève choisi (voir `paidMonthFacts`, calculé par
 * `paymentMonthHistory` dans le domaine) est ROUGE, barré et NON COCHABLE : un
 * mois ne se vend pas deux fois, et le mois de la date cesse d'être proposé
 * d'avance quand c'est justement lui qui est déjà payé. La modale ne recalcule
 * rien — elle affiche la liste du domaine — mais elle écrit la PREUVE : sous la
 * grille, chaque mois réglé porte le reçu qui le couvre (numéro, date, montant),
 * pour que le caissier vérifie le papier de la famille au lieu de subir un refus
 * anonyme.
 *
 * L'état du choix vit dans le DOMAINE (`usePayments`), pas ici : c'est lui qui
 * enregistre le paiement et remet le mois par défaut sur la date. Cette modale
 * n'en est que l'affichage.
 */
import { Fragment, useMemo, useRef, useState } from 'react';
import { CreditCard, Search, Trash2, X } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Payment, Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';
import { studentMatricule } from '../lib/studentIdentifiers';
import { formatPaidMonthLine, formatPaidMonths, paidReceiptEvidence, paymentMonthLabel } from '../lib/paymentMonths';
import type { PaymentMonthFact } from '../lib/paymentMonths';
import { PAYMENT_MOTIFS, isPaymentMotif, paymentMotifLabel, paymentMotifNeedsMonths } from '../lib/paymentMotifs';
import type { PaymentMotif } from '../lib/paymentMotifs';
import { ALL_CLASSES, filterStudents, matchesClass, matchesSearch } from '../lib/paymentStudentFilter';

export interface PaymentEntryModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  students: Student[];
  paymentStudentId: string;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  paymentAmount: string;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  paymentDate: string;
  setPaymentDate: Dispatch<SetStateAction<string>>;
  /**
   * Le motif du paiement (`scolarite` / `inscription`, voir
   * src/lib/paymentMotifs.ts) — ce que la ligne « Motif » du reçu imprimera.
   * L'état vit dans le domaine (`usePayments`), pas dans la modale.
   */
  paymentMotif: PaymentMotif;
  setPaymentMotif: Dispatch<SetStateAction<PaymentMotif>>;
  /** Les mois proposés — ceux de l'année scolaire de la date — en `YYYY-MM`. */
  paymentMonthOptions: string[];
  /** Les mois cochés : le mois de la date tant que le caissier n'a rien touché. */
  paymentMonths: string[];
  /**
   * Les mois de l'année proposée que les reçus de l'élève DÉCLARENT déjà couvrir,
   * chacun avec le reçu qui le couvre (numéro, date, montant). Ces mois
   * apparaissent en rouge, barrés et non cochables — un mois ne se vend pas deux
   * fois — et leur PREUVE est écrite sous la grille, pour que le caissier vérifie
   * le papier de la famille au lieu de subir un refus anonyme. La liste vient du
   * domaine (`paymentMonthHistory`) : la modale ne la recalcule pas.
   */
  paidMonthFacts: PaymentMonthFact[];
  /**
   * Combien de reçus de l'élève ne déclarent AUCUN mois. Leur couverture est
   * INCONNUE : l'écran le dit, pour qu'un mois absent de la liste rouge ne se
   * lise pas « ce mois n'a jamais été payé ».
   */
  undeclaredPaymentCount: number;
  /**
   * Le rôle peut-il RETIRER un reçu (« Payment deleters delete payments »,
   * `src/lib/paymentRights.ts`) ? Sans ce droit, un mois déclaré deux fois se
   * voit sans se nettoyer : la liste reste informative, sans bouton.
   */
  canDeletePayment: boolean;
  /**
   * Retire un reçu — le chemin de la fiche élève (`deletePayment`) : le montant
   * sort du registre et du solde, l'acte est journalisé avec son instantané, et
   * il reste restaurable depuis le journal d'audit. Rend `false` si la base a
   * refusé (le toast a dit pourquoi).
   */
  onDeletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
  /** Coche/décoche un mois. L'état vit dans le domaine, jamais dans la modale. */
  togglePaymentMonth: (month: string) => void;
  formatCurrency: (amount: number) => string;
  /** Les classes proposées au filtre (paires id/libellé, comme les classes actives). */
  availableClasses: { id: string; nameEn: string; nameFr: string }[];
  /** Rend le libellé d'une classe stockée sur l'élève (`1A` → « 1ère Année A »). */
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  lang: 'en' | 'fr';
  handlePaymentSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function PaymentEntryModal(props: PaymentEntryModalProps) {
  const { t, currentTheme, students, paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount, paymentDate, setPaymentDate, paymentMotif, setPaymentMotif, paymentMonthOptions, paymentMonths, paidMonthFacts, undeclaredPaymentCount, canDeletePayment, onDeletePayment, togglePaymentMonth, formatCurrency, availableClasses, getGradeDisplay, lang, handlePaymentSubmit, overlayRef, onClose } = props;

  // Les mots de la ligne « Mois » — le même module que le reçu, donc les mêmes
  // mots : ce qui se lit ici est ce qui s'imprime.
  const monthWords = {
    label: (ym: string) => paymentMonthLabel(ym, t),
    count: (n: number) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  };

  // Le texte EXACT de la ligne « Mois » du reçu.
  const monthsReceiptLine = formatPaidMonths(paymentMonths, monthWords);

  // Les mois déjà réglés, et leur PREUVE : une ligne par mois, avec le reçu qui
  // le couvre — « Octobre — déjà payé : reçu REC-123 du 05/10/2026, 25 000 FCFA ».
  // Le caissier vérifie ainsi qu'il parle du même reçu que la famille, et non d'un
  // refus anonyme. La phrase est montée par le module pur, la même qui sert au
  // message de refus.
  const paidPaymentMonths = paidMonthFacts.map((f) => f.month);

  // Ce que la grille a de PLUS à dire : les mois déjà réglés, et les reçus muets
  // dont la couverture est inconnue. Les deux s'effacent quand il n'y a rien à
  // dire — sans mois réglé ni reçu muet, l'écran est celui d'avant.
  const undeclaredNote = undeclaredPaymentCount > 0
    ? t.monthsUndeclaredNote.replace('{count}', String(undeclaredPaymentCount))
    : '';

  // ── Le reçu EN TROP ──────────────────────────────────────────────────────
  // Un mois déclaré par DEUX reçus est un doublon déjà enregistré : l'écran les
  // nomme tous les deux et laisse retirer celui qui est en trop. Il ne CHOISIT pas
  // lequel — c'est la seule chose que l'application ne peut pas savoir (saisie
  // faite deux fois, ou deux versements réellement reçus) : le caissier, lui, a
  // la famille en face et les papiers sous les yeux.
  const [pendingDeleteReceiptId, setPendingDeleteReceiptId] = useState<string | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  // Ferme la course d'un double clic : le second appel verrait « zéro ligne
  // supprimée » et crierait à tort « droits insuffisants » (même garde que le
  // carnet de la fiche élève).
  const deletingReceiptRef = useRef<string | null>(null);

  // La ligne `payments` d'un reçu, retrouvée dans l'élève choisi : `deletePayment`
  // a besoin du reçu ENTIER (montant, date, motif et année partent dans la file
  // hors ligne et dans l'instantané du journal) — un objet reconstruit depuis
  // l'affichage perdrait ce qui rend le geste annulable. Quand la ligne manque
  // (élève reçu sans ses reçus), le geste n'est PAS offert : mieux vaut pas de
  // bouton qu'un bouton qui ne peut rien retirer.
  const paymentRowOf = (receiptId: string | undefined): Payment | undefined => {
    if (!receiptId) return undefined;
    return students.find((s) => s.id === paymentStudentId)?.payments.find((p) => p.id === receiptId);
  };

  const deleteReceipt = async (receipt: Payment) => {
    const receiptId = receipt.id;
    if (!receiptId || deletingReceiptRef.current) return;
    deletingReceiptRef.current = receiptId;
    setDeletingReceiptId(receiptId);
    const ok = await onDeletePayment(paymentStudentId, receipt);
    deletingReceiptRef.current = null;
    setDeletingReceiptId(null);
    // Succès : la ligne a quitté le registre de l'élève — la liste des mois se
    // recalcule sur les reçus QUI RESTENT (un mois que ce reçu déclarait seul
    // redevient cochable ; un mois qu'un autre déclare encore reste fermé).
    // Échec : la confirmation reste ouverte, le toast a déjà dit pourquoi.
    if (ok) setPendingDeleteReceiptId(null);
  };

  // Tous les mois de l'année proposée sont réglés : le bouton reste fermé, mais
  // il dit POURQUOI — « cochez au moins un mois » serait faux, il n'en reste
  // aucun à cocher.
  const allMonthsPaid =
    paymentMonthOptions.length > 0 && paidPaymentMonths.length >= paymentMonthOptions.length;

  // Au moins un mois est exigé dès lors que la liste est proposée (elle ne l'est
  // que si l'année scolaire de la date se lit) — SAUF pour l'inscription, qui
  // est un droit d'entrée et ne couvre aucun mois : le bouton reste alors
  // fermé. La règle vit dans `paymentMotifNeedsMonths`, avec le motif, pour
  // que l'écran et le domaine n'en aient qu'une.
  const missingMonth =
    paymentMotifNeedsMonths(paymentMotif) &&
    paymentMonthOptions.length > 0 &&
    paymentMonths.length === 0;

  // Ce que la ligne sous les pastilles dit : l'exigence (avec sa vraie raison),
  // ou le texte exact du reçu. Sous une INSCRIPTION sans mois coché les deux sont
  // vides — la ligne disparaît alors au lieu de laisser un trou (un droit
  // d'entrée n'a rien à déclarer sur les mois).
  const monthsFeedback = missingMonth
    ? (allMonthsPaid ? t.paidMonthsAllCovered : t.paidMonthsRequired)
    : monthsReceiptLine;

  // Le filtre repart de « toutes les classes » à chaque montage du formulaire.
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASSES);

  // La recherche repart vide à chaque montage, comme le filtre de classe.
  const [search, setSearch] = useState('');

  // Les classes réellement présentes dans la liste des élèves, dans l'ordre des
  // classes actives (celles qu'un élève peut porter), plus toute classe stockée
  // qui n'y figure plus — sinon un élève d'une classe retirée deviendrait
  // introuvable par le filtre.
  const classOptions = useMemo(() => {
    const present = new Set(students.map((s) => (s.grade ?? '').trim().toLowerCase()).filter(Boolean));
    const known = availableClasses
      .filter((c) => present.has(c.id.trim().toLowerCase()))
      .map((c) => ({ id: c.id, label: lang === 'en' ? c.nameEn : c.nameFr }));
    const knownIds = new Set(known.map((k) => k.id.trim().toLowerCase()));
    const extra = [...present]
      .filter((id) => !knownIds.has(id))
      .sort((a, b) => a.localeCompare(b, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }))
      .map((id) => ({ id, label: getGradeDisplay(id, lang) }));
    return [...known, ...extra];
  }, [students, availableClasses, getGradeDisplay, lang]);

  // La classe ET la recherche se combinent (ET logique) : la liste proposée est
  // leur intersection.
  const visibleStudents = useMemo(
    () => filterStudents(students, classFilter, search),
    [students, classFilter, search],
  );

  // Après un changement de filtre (classe ou recherche), efface la sélection si
  // l'élève choisi n'est plus proposé : aucun paiement ne doit être envoyé à un
  // élève absent de la liste affichée.
  const keepSelectionOnlyIfVisible = (nextClass: string, nextSearch: string) => {
    const selected = students.find((s) => s.id === paymentStudentId);
    if (selected && !(matchesClass(selected.grade, nextClass) && matchesSearch(selected, nextSearch))) {
      setPaymentStudentId('');
    }
  };

  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-payment-entry"
      ariaLabel={t.paymentEntry}
      maxWidth="max-w-md"
      icon={<CreditCard size={24} className="text-blue-400" />}
      title={t.paymentEntry}
    >

              {/* La fenêtre est le SEUL corps de modale sans défilement, et elle
                  est la plus longue (recherche, filtre de classe, élève, deux
                  champs, les douze pastilles de mois, l'indice, la ligne du reçu,
                  le bouton). Le panneau de `ModalShell` est `overflow-hidden` :
                  ce qui dépasse la hauteur de l'écran n'est pas coupé « un peu »,
                  il devient INATTEIGNABLE — mesuré sur un écran de portable, le
                  bouton de validation tombait sous le bord bas, sans barre de
                  défilement pour l'atteindre, donc AUCUN paiement ne pouvait être
                  enregistré. Les formulaires voisins (élève, personnel) portent
                  déjà leur propre hauteur maximale et leur défilement ; ce
                  formulaire-ci les reprend, mêmes classes. */}
              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-2">
                  <label htmlFor="payment-student-search" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.searchNameOrId}</label>
                  <div className="relative">
                    <Search size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    <input
                      id="payment-student-search"
                      data-slot="payment-student-search"
                      type="text"
                      value={search}
                      onChange={(e) => {
                        const nextSearch = e.target.value;
                        setSearch(nextSearch);
                        keepSelectionOnlyIfVisible(classFilter, nextSearch);
                      }}
                      placeholder={t.searchStudents}
                      className={`w-full pl-11 pr-11 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        title={t.clearSearch}
                        aria-label={t.clearSearch}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full ${currentTheme.muted} ${currentTheme.hoverSurface} transition-all`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="payment-class-filter" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.filterByClass}</label>
                  <select
                    id="payment-class-filter"
                    data-slot="payment-class-filter"
                    value={classFilter}
                    onChange={(e) => {
                      const nextClass = e.target.value;
                      setClassFilter(nextClass);
                      keepSelectionOnlyIfVisible(nextClass, search);
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  >
                    <option value={ALL_CLASSES} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.allClasses}</option>
                    {classOptions.map((c) => (
                      <option key={c.id} value={c.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="payment-student" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.selectStudent}</label>
                  <select
                    id="payment-student"
                    required
                    value={paymentStudentId}
                    onChange={(e) => setPaymentStudentId(e.target.value)}
                    className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  >
                    <option value="" className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.selectStudent}...</option>
                    {visibleStudents.map(s => {
                      const matricule = studentMatricule(s.studentId);
                      const balance = s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid;
                      return (
                        <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name}{matricule ? ` — ${t.studentId}: ${matricule}` : ''} ({formatCurrency(balance)} {t.balance})</option>
                      );
                    })}
                  </select>
                  {visibleStudents.length === 0 && (
                    <p className={`text-2xs font-semibold ${currentTheme.muted}`}>
                      {students.length === 0
                        ? t.noStudentsInSystem
                        : search.trim()
                          ? t.noStudentsFound.replace('{query}', search.trim())
                          : t.noStudentsInClass}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                        placeholder="10 000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentDate}</label>
                    <input 
                      required
                      type="date" 
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                    />
                  </div>
                </div>

                {/* Le MOTIF — AU-DESSUS des mois, dans l'ordre où le reçu les
                    porte : la famille lit « Motif » avant de vérifier les mois
                    que ce paiement couvre. Les deux choix sont la liste FERMÉE
                    de `src/lib/paymentMotifs.ts`, et leurs libellés sont les
                    MOTS DU REÇU : ce qui se choisit ici s'imprime là. */}
                <div className="space-y-2" data-slot="payment-motif">
                  <label htmlFor="payment-motif-select" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentMotif}</label>
                  <select
                    id="payment-motif-select"
                    value={paymentMotif}
                    onChange={(e) => {
                      const next = e.target.value;
                      // La valeur vient d'une liste fermée, mais elle traverse
                      // le DOM en chaîne : on ne pose dans l'état que ce qui est
                      // un motif connu.
                      if (isPaymentMotif(next)) setPaymentMotif(next);
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  >
                    {PAYMENT_MOTIFS.map((motif) => (
                      <option key={motif} value={motif} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{paymentMotifLabel(motif, t)}</option>
                    ))}
                  </select>
                  <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{t.paymentMotifHint}</p>
                </div>

                {paymentMonthOptions.length > 0 && (
                  <div className="space-y-3" data-slot="payment-months">
                    <span className={`block text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paidMonths}</span>
                    <div role="group" aria-label={t.paidMonths} className="flex flex-wrap gap-2">
                      {paymentMonthOptions.map((month) => {
                        const checked = paymentMonths.includes(month);
                        // Déjà réglé POUR CET ÉLÈVE : la pastille ne se coche plus.
                        // Le clic ne fait rien, et l'envoi du mois refuserait de
                        // toute façon (le domaine nomme le mois) : l'écran et le
                        // domaine écartent la même liste.
                        const alreadyPaid = paidPaymentMonths.includes(month);
                        return (
                          <button
                            key={month}
                            type="button"
                            data-month={month}
                            data-paid={alreadyPaid ? 'true' : undefined}
                            aria-pressed={checked}
                            disabled={alreadyPaid}
                            onClick={() => togglePaymentMonth(month)}
                            className={`px-4 py-2 rounded-xl border text-xs font-black transition-all ${
                              alreadyPaid
                                ? `${currentTheme.surfaceInset} ${currentTheme.border} text-rose-600 dark:text-rose-300 line-through opacity-60 cursor-not-allowed`
                                : checked
                                  ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentBorder} ${currentTheme.accentShadow}`
                                  : `${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.inkStrong} ${currentTheme.rowHover}`
                            }`}
                          >
                            {paymentMonthLabel(month, t)}
                          </button>
                        );
                      })}
                    </div>
                    <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{t.paidMonthsHint}</p>
                    {paidMonthFacts.map((fact) => (
                      <Fragment key={fact.month}>
                        <p className="text-2xs font-black text-rose-600 dark:text-rose-300">
                          {formatPaidMonthLine(fact, t, lang)}
                        </p>
                        {/* Un mois déclaré par PLUSIEURS reçus : chacun se nomme —
                            numéro, date, montant — et se retire s'il est en trop. */}
                        {fact.receipts.length > 1 && fact.receipts.map((receipt) => {
                          const row = paymentRowOf(receipt.id);
                          const awaiting = pendingDeleteReceiptId !== null && pendingDeleteReceiptId === receipt.id;
                          return (
                            <div
                              key={receipt.id ?? `${receipt.date}:${receipt.amount}`}
                              data-receipt={receipt.id}
                              className="flex flex-wrap items-center gap-2 pl-3"
                            >
                              <span className="text-2xs font-semibold text-rose-600 dark:text-rose-300">
                                {paidReceiptEvidence(receipt, t, lang)}
                              </span>
                              {canDeletePayment && row && (awaiting ? (
                                <>
                                  <span className="text-2xs font-bold text-rose-600 dark:text-rose-300">
                                    {t.deletePaymentConfirm
                                      .replace('{amount}', formatCurrency(row.amount))
                                      .replace('{receipt}', row.receiptNumber || 'N/A')}
                                  </span>
                                  <button
                                    type="button"
                                    data-slot="payment-receipt-remove"
                                    disabled={deletingReceiptId === receipt.id}
                                    onClick={() => { void deleteReceipt(row); }}
                                    className={`px-2 py-1 bg-rose-600 ${currentTheme.hoverAlertSolid} disabled:opacity-50 text-white rounded text-2xs font-bold transition-all`}
                                  >
                                    {t.deletePayment}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteReceiptId(null)}
                                    className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 dark:hover:text-slate-200 rounded text-2xs font-bold transition-all`}
                                  >
                                    {t.cancel}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  data-receipt-remove={receipt.id}
                                  onClick={() => setPendingDeleteReceiptId(receipt.id ?? null)}
                                  className={`px-2 py-1 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 ${currentTheme.hoverAlert} rounded text-2xs font-bold transition-all flex items-center gap-1`}
                                  title={t.deletePayment}
                                >
                                  <Trash2 size={12} /> {t.deletePayment}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </Fragment>
                    ))}
                    {undeclaredNote !== '' && (
                      <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{undeclaredNote}</p>
                    )}
                    {monthsFeedback !== '' && (
                      <p className={`text-xs font-black ${missingMonth ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {monthsFeedback}
                      </p>
                    )}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={missingMonth}
                  className={`w-full ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} py-5 rounded-2xl font-black text-sm transition-all shadow-xl ${currentTheme.accentShadow} active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}
