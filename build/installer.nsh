# ─────────────────────────────────────────────────────────────────────────────
# build/installer.nsh — inclus dans le script NSIS de l'installeur Windows.
#
# Le fichier est chargé par `electron-builder` (`nsis.include`, electron-builder.yml
# le nomme pour qu'un lecteur n'ait pas à connaître la convention). Il ne concerne
# que le poste Windows, et il ne touche qu'à deux choses : ce que l'installeur lit
# pour connaître ses paramètres (§1), et le verdict porté sur un désinstalleur qui a
# planté en sortant (§2).
#
# ─── §1 — LA CAUSE, et elle est supprimée ici ────────────────────────────────
# Le désinstalleur des versions déjà installées sortait en `0xC0000374`
# (STATUS_HEAP_CORRUPTION) APRÈS avoir vidé le dossier d'installation, ce qui
# arrêtait net toute mise à jour de poste (mesuré le 2026-10-12 sur le canal réel,
# `npm run verify:updater:channel`, poste v1.0.28 → tête v1.0.29 ; c'est aussi le
# défaut NSIS connu d'`electron-builder`,
# github.com/electron-userland/electron-builder/issues/8664, close sans plan).
#
# La cause est NOMMÉE, et ce n'est pas le runtime NSIS : c'est le greffon que
# `app-builder-lib` emploie pour lire les paramètres. Il appelle
# `StdUtils.TestParameter` SEPT fois — une par drapeau (`isUpdated`, `isForceRun`,
# `isKeepShortcuts`, `isNoDesktopShortcut`, `isDeleteAppData`, `isForAllUsers`,
# `isForCurrentUser`) —, et le désinstalleur, lui, ne fait quasiment que ça : il lit
# `--delete-app-data` / `--updated`, puis retire les fichiers et les clés. Mesuré le
# 2026-10-15, makensis 3.0.4.1 livré par `electron-builder`, sur un script minimal
# qui ne fait RIEN d'autre :
#   • six appels à `StdUtils.TestParameter` → sortie `0xC0000374` (à chaque fois) ;
#   • les mêmes six appels remplacés par une lecture en script NSIS → sortie `0` ;
#   • un installeur NSIS minimal sans greffon → sortie `0` (le runtime va bien).
# Un seul appel est déjà un corrupteur de tas sur cette version : c'est le greffon,
# pas nos paramètres.
#
# Le remède n'est donc PAS d'accepter le plantage du désinstalleur NEUF : c'est de
# faire en sorte qu'il ne plante plus. Les sept `!define` que `app-builder-lib`
# engendre (`!define isUpdated \`"" isUpdated ""\`` …) sont REDIRIGÉS ici vers un
# test écrit en script NSIS, qui ne charge aucun greffon. La redirection marche
# parce que ce fichier est inclus APRÈS ces `!define` — c'est le cas :
# `NsisTarget.computeCommonInstallerScriptHeader()` écrit StdUtils, les drapeaux,
# puis `nsis.include`, et ce même en-tête sert à l'installeur ET au désinstalleur.
# Le gabarit `_isUpdated` engendré reste défini mais n'est plus jamais inséré : un
# `!macro` n'est compilé que là où on l'insère, donc `StdUtils.TestParameter` ne
# rentre plus dans le binaire (mesuré : un script qui inclut ce fichier compile
# encore quand `StdUtils.nsh` n'est même pas là).
#
# ─── Pourquoi SEPT corps, et pourquoi aucun `Call` ───────────────────────────
# Deux contraintes de NSIS décident de la FORME de §1, et les deux ont été mesurées :
#  • `Call` est INTERDIT dans une section de désinstallateur — makensis : « Call must
#    be used with function names starting with "un." in the uninstall section. » Or
#    `electron-builder` lit ces drapeaux LÀ : `assistedInstaller.nsh` insère
#    `PAGE_INSTALL_MODE` (donc `${If} ${isForAllUsers}`) dans les pages du
#    désinstalleur, et `uninstaller.nsh` lit `--delete-app-data`. `${GetOptions}` et
#    `${GetParameters}` sont donc ÉCARTÉS : ce sont des macros qui appellent
#    (`Call GetOptions_`) et la compilation du désinstalleur s'arrête là (mesuré :
#    « Error in macro _mamaForAllUsers … assistedInstaller.nsh on line 75 »). Un
#    greffon, lui, n'est pas un `Call` — c'est pour cela que le gabarit d'origine
#    pouvait tenir à cet endroit, et c'est aussi ce qu'il faut reproduire autrement.
#    Une fonction et son idiome `Exch` (qui éviteraient toute répétition) sont
#    écartés pour la même raison.
#  • NSIS refuse de définir une macro à l'intérieur d'une macro (« can't define a
#    macro inside a macro! », mesuré) et il PERD un argument vide : un corps commun
#    ne peut donc pas être écrit une fois puis inséré sept fois. D'où sept corps,
#    un par drapeau, avec une étiquette propre à chacun (deux insertions dans la même
#    section porteraient sinon deux fois le même nom — ce que makensis refuse, donc
#    bruyamment).
# Un état GLOBAL a été essayé d'abord, et rejeté sur mesure : une sonde tenant son
# verdict dans une `Var /GLOBAL` répondait « vrai » aux sept drapeaux, même absents
# (`/S` seul), là où la même sonde tenant son verdict dans un registre répondait
# juste. Aucun état global n'est laissé derrière.
#
# ─── Ce que le test retient, et ce qu'il laisse passer ──────────────────────
# Le jeton est cherché précédé d'une espace, sous les deux formes que le greffon
# accepte lui-même (mesuré) : `/drapeau` (`currentuser`, `allusers` — posés par
# `multiUser.nsh`) et `--drapeau` (`--updated`, `--force-run` … — posés par
# `electron-updater`, et par `installUtil.nsh` pour le désinstalleur qu'il relance).
# L'espace de tête n'est pas décoratif : sans elle, un chemin comme `C:\un/updated`
# passerait pour `--updated`. Et `-drapeau` (un seul tiret) n'est PAS retenu, comme
# chez le greffon (mesuré).
#
# Parité MESURÉE avec le greffon, pas supposée (2026-10-15, banc `parity2`,
# `StdUtils.TestParameter` appelé explicitement à côté de la macro réellement
# active) : les sept décisions sont identiques sur les neuf lignes de commande que
# le canal produit —
#   `… /S /KEEP_APP_DATA /currentuser --updated _?=<dossier>`,
#   `… /S /KEEP_APP_DATA /allusers --updated _?=<dossier>`,
#   `… /S /KEEP_APP_DATA /allusers --updated --keep-shortcuts _?=<dossier>`,
#   `… /S /KEEP_APP_DATA /allusers --delete-app-data _?=<dossier>`,
#   `… /S /KEEP_APP_DATA /currentuser _?=<dossier>`,
#   `--updated /S --force-run` (le clic du propriétaire),
#   `--no-desktop-shortcut /S --updated`, `/S` seul, et aucun argument —
# et identiques aussi sur `/updated` et `--notupdated`.
#
# UN écart subsiste, mesuré lui aussi, et il est PLUS PERMISSIF : lire un drapeau que
# personne n'a passé est sans effet, tandis que NE PAS lire un drapeau qui l'a été
# change la branche (c'est `isDeleteAppData` qui décide, dans `installUtil.nsh`, si le
# vieux désinstalleur efface ou épargne les données du poste).
#   • `--updated-extra` (jeton plus long qui COMMENCE par le drapeau) est vu, alors
#     que le greffon exige le jeton exact.
# Cette forme n'est produite ni par `electron-updater` ni par `app-builder-lib`.
# Ce qui est VERROUILLÉ par `tests/installer-uninstaller-crash.test.ts`, c'est ce qui
# est décidable hors ligne : les sept redirections, la frontière du jeton (l'espace de
# tête) sur les deux formes, l'absence de tout greffon et de tout `Call`, et le
# registre du verdict. La parité ci-dessus, elle, est une MESURE de banc : aucun test
# ne la rejoue, et c'est écrit ici pour qu'on ne la croie pas verrouillée.
# ─── §2 — LA TOLÉRANCE, et ce qu'il en reste ─────────────────────────────────
# §1 répare les installeurs et les désinstalleurs CONSTRUITS À PARTIR DE
# MAINTENANT. Le désinstalleur qui plante sur le poste d'une école est, lui, DÉJÀ
# installé : rien ne le change à distance, et c'est encore LUI que l'installeur neuf
# lance en premier (`installUtil.nsh` → `uninstallOldVersion`, puis
# `handleUninstallResult`). Tant qu'un poste n'a pas fait une mise à jour qui
# traverse cette version, son ancien désinstalleur sort en `0xC0000374` après avoir
# vidé le dossier (mesuré : `0 entrée`) — et sans verdict ici, `app-builder-lib`
# affiche « Échec de désinstallation des anciens fichiers d'application » et QUITTE
# (niveau d'erreur 2) : le poste reste SANS application, ce qui se lit dans une
# école « la mise à jour automatique ne s'est pas déclenchée ». §2 est le verdict de
# cette TRAVERSÉE, pas une acceptation du défaut.
#
# Elle se retire quand plus aucun poste n'exécute un désinstalleur d'avant §1 : ce
# sera vrai après une mise à jour réussie du parc entier (le désinstalleur est
# réécrit à chaque installation). À ce moment-là, les deux macros de §2 n'ont plus
# qu'à disparaître — l'installeur neuf, lui, n'a plus rien à tolérer.
#
# Un seul code est toléré, et il est NOMMÉ. Tout AUTRE code reproduit le
# comportement d'origine — la boîte, le niveau d'erreur 2, l'arrêt —, parce que
# tolérer en bloc « tout code non nul » accepterait un désinstalleur qui a échoué
# pour une raison que personne n'a regardée, et l'installeur écraserait alors une
# version dont personne ne sait ce qu'elle est devenue. Un échec inconnu doit rester
# un échec visible.
#
# ─── ⚠️ ÉCRIRE LE CODE EN DÉCIMAL SIGNÉ, PAS EN HEXADÉCIMAL ──────────────────
# C'est une MESURE, pas une question de style. NSIS garde `$R0` en 32 bits signé et
# l'affiche `-1073740940` (c'est le code que la boîte a montré sur le canal réel).
# Mesuré le 2026-10-12 avec le `makensis` d'`electron-builder` (3.0.4.1), sur un
# script NSIS minimal exécuté : `${If} $R0 == 0xC0000374` est **FAUX**, et
# `${If} $R0 == 3221226356` aussi — seul `${If} $R0 == -1073740940` est vrai. Écrite
# en hexadécimal, cette tolérance ne se déclencherait donc JAMAIS, sans que rien ne
# rougisse : la même mise à jour cassée, mais avec un fichier qui a l'air d'un
# remède. `tests/installer-uninstaller-crash.test.ts` verrouille ce point.
# ─────────────────────────────────────────────────────────────────────────────

# LogicLib sert §2 (le verdict) et les gabarits d'`app-builder-lib` ; il ne peut pas
# servir DANS une macro d'opérateur, c'est-à-dire dans §1 : `${If}` y définit `_c`
# et refuse de s'imbriquer — mesuré : « !define: "_c=true" already defined! ».
# Les boucles de §1 sont donc du NSIS classique, avec une étiquette par drapeau
# (`mamaUpdatedScan` …), unique parce que chaque corps n'existe qu'une fois.
!include "LogicLib.nsh"

# Redirection d'un drapeau d'`app-builder-lib` vers le test ci-dessous.
# `!define _nom_ \`"" mama_suffixe_ ""\`` est la forme qu'il engendre : LogicLib ne
# retient que le deuxième mot (`mama_suffixe_`) et insère `_mama_suffixe_`. Le
# `${FLAG}` est donc REDÉFINI, pas supprimé — `!undef` ne retire pas une macro, et
# une macro redéfinie est une erreur fatale en NSIS (mesuré). `!undef` sur un nom
# absent est une erreur, d'où le garde `!ifdef`.
!macro mamaRedirectFlag FLAG SUFFIX
  !ifdef ${FLAG}
    !undef ${FLAG}
  !endif
  !define ${FLAG} `"" mama${SUFFIX} ""`
!macroend

# ─── Les sept drapeaux d'`app-builder-lib`, dans l'ordre de son appel ────────
# Chaque macro est un test d'opérateur LogicLib (`${_t}` si le drapeau est là,
# `${_f}` sinon — le contrat du gabarit d'origine, mot pour mot), et chaque corps est
# identique au nom de drapeau près. Elle sauve les registres qu'elle EMPRUNTE — `$R6`
# (longueur du jeton), `$R5` (la fenêtre comparée), `$R4` (longueur de la seconde
# forme) — et `$R9` porte le verdict : la ligne de commande encadrée y est écrite,
# puis remplacée par `true`/`false`, et le gabarit d'origine clobbe déjà `$R9` (il y
# reçoit la réponse du greffon), donc s'y fier ne casse rien de plus. Deux registres
# ne sont JAMAIS touchés, et ce n'est pas une omission : `$R0` porte le code de sortie
# du désinstalleur quand `handleUninstallResult` appelle ce test, et `$R8` est celui
# des gabarits alentour. Le verdict est lu APRÈS le rétablissement — `StrCmp` en
# dernier, et non un dépilement de `$R9` (mesuré : restaurer `$R9` avant le verdict
# répond « faux » aux sept drapeaux).

# Un compteur de préprocesseur : chaque insertion de sonde a besoin de SES étiquettes.
# Mesuré sans lui, sur le désinstalleur réellement émis : « label "mamaUpdatedScan:"
# already declared in function », parce que `_CHECK_APP_RUNNING`
# (`allowOnlyOneInstallerInstance.nsh`) teste le même drapeau deux fois dans la même
# fonction. NSIS n'a pas d'étiquette locale ; c'est donc le préprocesseur qui
# numérote, avec le même mécanisme que LogicLib (`!define /redef /math`).
!macro mamaProbeId
  !define /ifndef MAMA_PROBE_COUNTER 0
  !define /redef /math MAMA_PROBE_COUNTER `${MAMA_PROBE_COUNTER}` + 1
!macroend

!macro _mamaUpdated _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /updated"
  StrLen $R4 " --updated"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /updated" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --updated" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isUpdated Updated

!macro _mamaForceRun _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /force-run"
  StrLen $R4 " --force-run"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /force-run" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --force-run" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isForceRun ForceRun

!macro _mamaKeepShortcuts _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /keep-shortcuts"
  StrLen $R4 " --keep-shortcuts"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /keep-shortcuts" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --keep-shortcuts" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isKeepShortcuts KeepShortcuts

!macro _mamaNoDesktopShortcut _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /no-desktop-shortcut"
  StrLen $R4 " --no-desktop-shortcut"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /no-desktop-shortcut" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --no-desktop-shortcut" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isNoDesktopShortcut NoDesktopShortcut

!macro _mamaDeleteAppData _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /delete-app-data"
  StrLen $R4 " --delete-app-data"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /delete-app-data" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --delete-app-data" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isDeleteAppData DeleteAppData

!macro _mamaForAllUsers _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /allusers"
  StrLen $R4 " --allusers"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /allusers" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --allusers" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isForAllUsers ForAllUsers

!macro _mamaForCurrentUser _a _b _t _f
  !insertmacro mamaProbeId
  # `$R9` : la ligne de commande, puis le verdict. Le gabarit d'origine clobbe déjà
  # `$R9` (il y reçoit la réponse du greffon) ; tout le reste est rétabli.
  Push $R6
  Push $R5
  Push $R4
  StrCpy $R9 "$CMDLINE "
  StrLen $R6 " /currentuser"
  StrLen $R4 " --currentuser"
  mamaProbe${MAMA_PROBE_COUNTER}Scan:
    StrCpy $R5 $R9 $R6
    StrCmp $R5 " /currentuser" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R5 $R9 $R4
    StrCmp $R5 " --currentuser" mamaProbe${MAMA_PROBE_COUNTER}Present
    StrCpy $R9 $R9 "" 1
    StrCmp $R9 "" mamaProbe${MAMA_PROBE_COUNTER}Absent
    Goto mamaProbe${MAMA_PROBE_COUNTER}Scan
  mamaProbe${MAMA_PROBE_COUNTER}Present:
    StrCpy $R9 "true"
    Goto mamaProbe${MAMA_PROBE_COUNTER}Done
  mamaProbe${MAMA_PROBE_COUNTER}Absent:
    StrCpy $R9 "false"
  mamaProbe${MAMA_PROBE_COUNTER}Done:
  Pop $R4
  Pop $R5
  Pop $R6
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!insertmacro mamaRedirectFlag isForCurrentUser ForCurrentUser

# ─── §2 — Le verdict de traversée ────────────────────────────────────────────
# Écrit une fois : les deux macros ci-dessous l'insèrent, parce que le défaut mesuré
# ne dépend pas de la ruche visée (`SHELL_CONTEXT` pour une installation par
# utilisateur, `HKEY_CURRENT_USER` pour l'autre branche d'une installation machine).
!macro mamaUninstallerResultVerdict
  # 0 : le désinstalleur a fait son travail — rien à dire, l'installation continue.
  ${If} $R0 == 0
    Return
  ${EndIf}

  # Le plantage de sortie des désinstalleurs d'avant §1, et lui SEUL est toléré. Les
  # fichiers sont déjà retirés quand il survient (mesuré : dossier à 0 entrée) :
  # continuer ÉCRIT donc la nouvelle version là où l'ancienne n'est plus — l'effet
  # d'une mise à jour normale — au lieu de laisser un poste sans application.
  ${If} $R0 == -1073740940
    DetailPrint "Désinstalleur de la version précédente : plantage de sortie 0xC0000374 (STATUS_HEAP_CORRUPTION) après le retrait des fichiers — la nouvelle version s'installe à la place."
    Return
  ${EndIf}

  # Tout le reste, mot pour mot le verdict d'origine d'`app-builder-lib` : un échec
  # qu'on n'a pas nommé ne doit pas être absorbé.
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
  DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
  SetErrorLevel 2
  Quit
!macroend

!macro customUnInstallCheck
  !insertmacro mamaUninstallerResultVerdict
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro mamaUninstallerResultVerdict
!macroend
