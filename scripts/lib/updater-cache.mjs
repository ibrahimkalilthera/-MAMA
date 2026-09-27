// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/updater-cache.mjs — le cache de téléchargement PARTAGÉ du poste, et
// comment le rendre inerte pour une preuve.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// `electron-updater` garde l'installeur téléchargé sous
// `%LOCALAPPDATA%\<updaterCacheDirName>` — un dossier PARTAGÉ par toutes les
// installations de l'application sur une même machine. Tant que
// `pending/update-info.json` est là et que l'empreinte correspond, le poste
// « télécharge » depuis ce cache, SANS aucun GET.
//
// Conséquence pour une preuve : un run précédent y laisse l'installeur, l'app se
// croit servie, la chaîne de mise à jour est parcourue sans réseau — et une
// preuve qui « passe » alors qu'aucun octet n'a voyagé ne prouve rien. Deux
// preuves différentes ont donc besoin du même geste (`verify-updater.mjs` sur un
// flux local, `verify-updater-channel.mjs` sur le canal réel) : rendre ce cache
// inerte AVANT de lancer l'application. Il vit ici, une fois, avec son refus :
// si le petit `update-info.json` résiste aux suppressions, on ÉCHOUE plutôt que
// de continuer sans pouvoir dire si le téléchargement a eu lieu.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Le `updaterCacheDirName` écrit par electron-builder dans `app-update.yml`. */
export const UPDATER_CACHE_DIRNAME = 'mama-thera-finance-updater';

/**
 * Le dossier du cache partagé, tel que l'application le calcule.
 * @param {{ env?: Record<string, string|undefined> }} [options]
 * @returns {string}
 */
export function updaterCacheDir({ env = process.env } = {}) {
  const base = env.LOCALAPPDATA || join(tmpdir(), 'AppData', 'Local');
  return join(base, UPDATER_CACHE_DIRNAME);
}

/** Le petit fichier qui, seul, rend le dossier réutilisable. */
export const updaterPendingInfo = (dir) => join(dir, 'pending', 'update-info.json');

/**
 * Rendre le cache inerte : `update-info.json` d'abord (c'est LUI que
 * `electron-updater` relit pour décider de resservir), puis le dossier entier
 * quand il se laisse faire.
 *
 * Une tentative : le gros installeur reste volontiers verrouillé (handle d'un run
 * précédent, antivirus) — mesuré : vingt essais sur le dossier entier n'y
 * suffisaient pas, alors que le petit JSON part tout de suite. Ce que le refus
 * interdit, c'est de continuer avec un `update-info.json` encore en place : là,
 * le cache pourrait valider la version suivante et la preuve ne prouverait rien.
 *
 * @param {{ dir?: string, attempts?: number, waitMs?: number, sleep?: (ms: number) => Promise<void> }} [input]
 * @returns {Promise<{ ok: boolean, purged: boolean, problems: string[], detail: string }>}
 */
export async function invalidateUpdaterCache({
  dir = updaterCacheDir(),
  attempts = 20,
  waitMs = 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!existsSync(dir)) {
    return { ok: true, purged: false, problems: [], detail: `aucun cache à invalider (${dir} absent)` };
  }
  const pendingInfo = updaterPendingInfo(dir);
  for (let i = 0; i < attempts && existsSync(pendingInfo); i += 1) {
    try {
      rmSync(pendingInfo, { force: true });
    } catch {
      /* verrouillé un instant */
    }
    if (existsSync(pendingInfo)) await sleep(waitMs);
  }
  if (existsSync(pendingInfo)) {
    return {
      ok: false,
      purged: false,
      problems: [
        `pending/update-info.json reste illisible (${pendingInfo}) — le cache pourrait resservir le téléchargement à la place du réseau, donc la preuve ne prouverait rien`,
        'cause la plus probable : une application précédente tient encore le dossier ; ferme-la et relance',
      ],
      detail: 'cache non invalidé',
    };
  }
  let purged = false;
  try {
    rmSync(dir, { recursive: true, force: true });
    purged = true;
  } catch {
    /* payload encore verrouillé : sans conséquence, le cache ne valide plus rien */
  }
  return {
    ok: true,
    purged,
    problems: [],
    detail: purged
      ? 'cache electron-updater purgé (téléchargement réel forcé)'
      : 'pending/update-info.json retiré (payload verrouillé, sans conséquence : le cache ne valide plus rien)',
  };
}
