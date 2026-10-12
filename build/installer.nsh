# ─────────────────────────────────────────────────────────────────────────────
# build/installer.nsh — inclus dans le script NSIS de l'installeur Windows.
#
# Le fichier est chargé par `electron-builder` (`nsis.include`, electron-builder.yml
# le nomme pour qu'un lecteur n'ait pas à connaître la convention). Il ne concerne
# que le poste Windows, et il ne modifie rien d'autre que le verdict porté sur un
# désinstalleur qui a planté en sortant.
#
# ─── Le défaut réparé ici, et il valait pour tout le parc d'un coup ──────────
# `app-builder-lib` met une mise à jour en deux temps : l'installeur NEUF lance
# d'abord le DÉSINSTALLEUR de la version en place (`_?=<dossier>`, en place), puis
# écrit ses fichiers (`installUtil.nsh` → `uninstallOldVersion`, puis
# `installSection.nsh`).
#
# Mesuré le 2026-10-12 sur le CANAL RÉEL (`npm run verify:updater:channel`, poste de
# départ v1.0.28 → tête v1.0.29, trois constats identiques dans le même run) : ce
# désinstalleur meurt en `0xC0000374` (STATUS_HEAP_CORRUPTION) — APRÈS avoir vidé le
# dossier d'installation (mesuré : `0 entrée`). `installUtil.nsh` le relance cinq
# fois (`UninstallLoop`), obtient cinq fois le même code, puis
# `handleUninstallResult` affiche « Échec de désinstallation des anciens fichiers
# d'application » et QUITTE (niveau d'erreur 2). La mise à jour s'arrête donc là,
# sur une boîte que personne ne clique, et le poste reste SANS application — ce qui
# se lit, dans une école : « la mise à jour automatique ne s'est pas déclenchée ».
#
# C'est le défaut NSIS connu d'`electron-builder`
# (github.com/electron-userland/electron-builder/issues/8664), close sans plan.
# Écarté comme fausse piste, mesuré : un installeur NSIS MINIMAL compilé avec le
# même `makensis` sort à 0 — le runtime de cette machine va bien, c'est le
# désinstalleur CONSTRUIT qui plante. Et il n'est PAS réparable sur le poste : le
# désinstalleur qui plante est DÉJÀ installé chez les clients, on ne peut pas le
# changer à distance. Ce qu'on peut réparer, c'est l'installeur NEUF — celui-ci —
# pour qu'il cesse de s'arrêter : c'est exactement le point d'accroche prévu par
# `app-builder-lib` (`handleUninstallResult`, `!ifmacrodef customUnInstallCheck`).
#
# ─── Ce qui est TOLÉRÉ, et ce qui ne l'est pas ───────────────────────────────
# Un seul code est toléré, et il est NOMMÉ. Tout AUTRE code reproduit le
# comportement d'origine — la boîte, le niveau d'erreur 2, l'arrêt —, parce que
# tolérer en bloc « tout code non nul » accepterait un désinstalleur qui a échoué
# pour une raison que personne n'a regardée, et l'installeur écraserait alors une
# version dont personne ne sait ce qu'elle est devenue. Un échec inconnu doit
# rester un échec visible.
#
# ─── ⚠️ ÉCRIRE LE CODE EN DÉCIMAL SIGNÉ, PAS EN HEXADÉCIMAL ──────────────────
# C'est une MESURE, pas une question de style. NSIS garde `$R0` en 32 bits signé et
# l'affiche `-1073740940` (c'est le code que la boîte a montré sur le canal réel).
# Mesuré le 2026-10-12 avec le `makensis` d'`electron-builder` (3.0.4.1), sur un
# script NSIS minimal exécuté : `${If} $R0 == 0xC0000374` est **FAUX**, et
# `${If} $R0 == 3221226356` aussi — seul `${If} $R0 == -1073740940` est vrai.
# Écrite en hexadécimal, cette tolérance ne se déclencherait donc JAMAIS, sans que
# rien ne rougisse : la même mise à jour cassée, mais avec un fichier qui a l'air
# d'un remède. `tests/installer-uninstall-tolerance.test.ts` verrouille ce point.
# ─────────────────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

# Le verdict, écrit une fois : les deux macros ci-dessous l'insèrent, parce que le
# défaut mesuré ne dépend pas de la ruche visée (`SHELL_CONTEXT` pour une
# installation par utilisateur, `HKEY_CURRENT_USER` pour l'autre branche d'une
# installation machine).
!macro mamaUninstallerResultVerdict
  # 0 : le désinstalleur a fait son travail — rien à dire, l'installation continue.
  ${If} $R0 == 0
    Return
  ${EndIf}

  # Le plantage de sortie mesuré, et lui SEUL est toléré. Les fichiers sont déjà
  # retirés quand il survient (mesuré : dossier à 0 entrée) : continuer ÉCRIT donc
  # la nouvelle version là où l'ancienne n'est plus — l'effet d'une mise à jour
  # normale — au lieu de laisser un poste sans application.
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
