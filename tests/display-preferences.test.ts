/**
 * Suite du CONTRAT des préférences d'affichage (thème, densité, verre des
 * icônes, langue).
 *
 * Ces quatre réglages vivaient dans le `localStorage` du poste et nulle part
 * ailleurs : un poste réinstallé repartait donc aux défauts, alors que la
 * sauvegarde de la base, elle, se restaure. Ils sont maintenant des lignes
 * d'`app_settings`, donc ils VOYAGENT — et ce qui voyage doit être tenu :
 *
 *   • la liste des clés publiées est la MÊME que celle que la migration borne
 *     dans ses politiques d'écriture (un test lit le SQL : une clé écrite sous
 *     un nom que la base ne connaît pas serait un réglage qui ne voyage jamais) ;
 *   • une valeur hors contrat n'est ni lue ni écrite — peindre un thème
 *     inexistant ne se voit que sur le poste d'une école ;
 *   • **le poste gagne** : la copie de la base n'est adoptée que par un poste qui
 *     n'a JAMAIS choisi, sinon un vidéoprojecteur de salle et un poste de
 *     guichet se règleraient l'un l'autre ;
 *   • la ligne publiée a UNE forme, bâtie par un seul constructeur que les deux
 *     chemins d'écriture (en ligne et rejeu) appellent.
 *
 * Suite PURE : aucune base, aucun réseau, aucun React — un `localStorage` de
 * laboratoire suffit, et il est réinstallé à chaque cas.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DISPLAY_PREFERENCE_KEYS,
  DISPLAY_PREFERENCE_STORAGE_KEYS,
  DISPLAY_PREFERENCE_VALUES,
  LANGUAGE_STORAGE_KEY,
  adoptablePreferences,
  displayPreferenceRow,
  getStoredLanguage,
  hasStoredChoice,
  isDisplayPreferenceValue,
  parseDisplayPreferences,
  readStoredChoices,
  saveLanguage,
} from '../src/lib/displayPreferences';
import type { DisplayPreferenceName } from '../src/lib/displayPreferences';
import { BACKUP_TABLES, restorableRows } from '../scripts/lib/db-tables.mjs';
import { DEFAULT_DENSITY } from '../src/lib/density';
import { DEFAULT_ICON_GLASS } from '../src/lib/iconGlass';
import { DEFAULT_THEME } from '../src/app/useTheme';

const NAMES = Object.keys(DISPLAY_PREFERENCE_KEYS) as DisplayPreferenceName[];
const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');

// ─── Un `localStorage` de laboratoire ────────────────────────────────────────

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/** Installer (ou retirer, avec `undefined`) le stockage du poste. */
function installStorage(storage?: MemoryStorage): MemoryStorage {
  const value = storage ?? new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
  return value;
}

/** Le source du `localStorage` : les modules lisent `typeof localStorage`. */
function removeStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
}

afterEach(removeStorage);

// ─── La liste des clés, telle que la MIGRATION la borne ──────────────────────

describe('contrat des préférences d’affichage', () => {
  it('les clés publiées sont exactement celles que la migration borne', () => {
    const file = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith('_display_preferences.sql'));
    assert.ok(file, 'la migration des préférences d’affichage doit exister');
    const sql = readFileSync(join(MIGRATIONS_DIR, file as string), 'utf8');
    const declared = [...new Set([...sql.matchAll(/'(display\.[a-z_.]+)'/g)].map((m) => m[1]))].sort();

    assert.deepEqual(
      declared,
      Object.values(DISPLAY_PREFERENCE_KEYS).slice().sort(),
      'une clé d’un seul côté (SQL ou code) serait un réglage qui ne voyage pas',
    );
    // La table, elle aussi écrite en toutes lettres des deux côtés : c'est ELLE
    // que la sauvegarde emporte (`scripts/lib/db-tables.mjs`).
    assert.match(sql, /public\.app_settings/);
  });

  it('chaque préférence admet les valeurs de son type, et rien d’autre', () => {
    for (const name of NAMES) {
      const values = DISPLAY_PREFERENCE_VALUES[name];
      assert.ok(values.length > 0, `${name} doit admettre au moins une valeur`);
      assert.equal(new Set(values).size, values.length, `${name} ne doit pas répéter une valeur`);
      for (const value of values) assert.equal(isDisplayPreferenceValue(name, value), true, `${name} = ${value}`);
    }
    assert.equal(isDisplayPreferenceValue('theme', 'gothic'), false);
    assert.equal(isDisplayPreferenceValue('density', 'cozy'), false);
    assert.equal(isDisplayPreferenceValue('iconGlass', 'glassy'), false);
    assert.equal(isDisplayPreferenceValue('language', 'es'), false);
    // Le type compte autant que la liste : du JSONB peut porter un nombre.
    for (const wrong of [null, 1, true, {}, [], undefined]) {
      assert.equal(isDisplayPreferenceValue('theme', wrong), false, `${String(wrong)} n’est pas un thème`);
    }
  });

  it('les DÉFAUTS compilés sont des valeurs admises — sinon un poste neuf publierait rien', () => {
    assert.equal(isDisplayPreferenceValue('theme', DEFAULT_THEME), true);
    assert.equal(isDisplayPreferenceValue('density', DEFAULT_DENSITY), true);
    assert.equal(isDisplayPreferenceValue('iconGlass', DEFAULT_ICON_GLASS), true);
    assert.equal(isDisplayPreferenceValue('language', 'fr'), true);
  });

  it('la lecture ne retient que les lignes connues ET admises', () => {
    const parsed = parseDisplayPreferences([
      { key: 'display.theme', value: 'midnight' },
      { key: 'display.density', value: 'compact' },
      { key: 'inactivity_minutes', value: '30' }, // un autre réglage d'équipe
      { key: 'display.icon_glass', value: 42 }, // le bon type de ligne, la mauvaise valeur
      { key: 'display.language', value: 'es' }, // une langue que l'app ne parle pas
      { key: 'display.unknown_key', value: 'x' }, // une clé que le contrat ne connaît pas
    ]);
    assert.deepEqual(parsed, { theme: 'midnight', density: 'compact' });
  });

  it('une préférence absente n’est jamais inventée', () => {
    // Le drame que ce cas évite : huit cents postes qui adoptent un « défaut »
    // que personne n'a choisi et qui écrase le réglage de l'école.
    assert.deepEqual(parseDisplayPreferences([]), {});
    assert.deepEqual(parseDisplayPreferences([] as unknown as { key: string }[]), {});
  });

  it('une réponse qui n’est pas une liste ne casse pas la lecture', () => {
    for (const wrong of [null, undefined, 'nope', 7, { key: 'display.theme' }]) {
      assert.deepEqual(
        parseDisplayPreferences(wrong as unknown as { key?: unknown; value?: unknown }[]),
        {},
        `${JSON.stringify(wrong)} doit être ignoré, jamais interprété`,
      );
    }
  });

  it('« le poste gagne » : la copie de la base est adoptée seulement là où rien n’a été choisi', () => {
    const remote = { theme: 'emerald', density: 'compact', iconGlass: 'discreet', language: 'en' } as const;

    // Ce poste-ci a déjà choisi son thème : il le garde, et adopte le reste.
    assert.deepEqual(adoptablePreferences({ theme: true, density: false, iconGlass: false, language: false }, remote), {
      density: 'compact',
      iconGlass: 'discreet',
      language: 'en',
    });

    // Jamais rien choisi (poste neuf, Windows refait, navigateur vidé) : tout.
    assert.deepEqual(adoptablePreferences({}, remote), remote);

    // L'école n'a rien réglé (aucune ligne en base) : le poste garde ses défauts.
    assert.deepEqual(adoptablePreferences({}, {}), {});
  });

  it('la ligne publiée a UNE forme, et aucun `updated_by`', () => {
    const row = displayPreferenceRow('display.theme', 'midnight', new Date('2026-10-19T09:00:00.000Z'));
    assert.deepEqual(row, { key: 'display.theme', value: 'midnight', updated_at: '2026-10-19T09:00:00.000Z' });
    // `restorableRows` écarte toute ligne dont le compte n'existe pas dans la
    // cible, et les comptes ne voyagent pas : nommer un auteur ici rendrait les
    // préférences non restaurables le jour même où on en a besoin.
    assert.equal('updated_by' in row, false);
    assert.match(displayPreferenceRow('display.density', 'compact').updated_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('les lignes publiées sont RESTAURABLES dans une cible fraîche', () => {
    // La seconde moitié de la promesse : « voyager avec la sauvegarde » ne sert à
    // rien si la restauration écarte la ligne. Or `restorableRows` écarte toute
    // ligne dont le compte `auth.users` n'existe pas dans la cible, et les comptes
    // ne voyagent pas par l'API REST — une cible fraîche n'en a donc AUCUN.
    const spec = BACKUP_TABLES.find((table) => table.name === 'app_settings');
    assert.ok(spec, 'app_settings doit être dans l’inventaire de la sauvegarde');
    assert.equal(spec?.pk, 'key', 'la clé d’une préférence EST sa clé primaire');

    const rows = Object.values(DISPLAY_PREFERENCE_KEYS).map((key) =>
      displayPreferenceRow(key, 'x', new Date('2026-10-19T09:00:00.000Z')),
    );
    assert.equal(restorableRows(spec, rows, []).length, rows.length);
    // La contre-épreuve : nommer un auteur absent les rendrait non restaurables.
    assert.equal(restorableRows(spec, [{ ...rows[0], updated_by: 'compte-absent' }], []).length, 0);
  });

  it('les DEUX chemins d’écriture bâtissent la ligne avec le même constructeur', () => {
    // Deux formes jumelles finiraient par diverger, et la copie d'école ne
    // dirait alors plus ce que le poste auteur avait à l'écran.
    const online = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'dataOps', 'settings.ts'), 'utf8');
    const replay = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'offlineReplaySettings.ts'), 'utf8');
    for (const [who, source] of [
      ['le chemin en ligne', online],
      ['le rejeu', replay],
    ] as const) {
      assert.match(source, /displayPreferenceRow\(/, `${who} doit publier la ligne du contrat`);
      // Et la valeur est validée AVANT d'écrire, des deux côtés.
      assert.match(source, /isDisplayPreferenceValue\(/, `${who} doit refuser une valeur hors contrat`);
    }
  });

  it('la langue du poste est retenue, et son absence veut dire « jamais choisi »', () => {
    installStorage();
    assert.equal(getStoredLanguage(), 'fr', 'sans choix, un poste parle français');
    assert.equal(hasStoredChoice('language'), false, 'aucune clé : ce poste n’a jamais choisi');

    saveLanguage('en');
    assert.equal(getStoredLanguage(), 'en');
    assert.equal(hasStoredChoice('language'), true);

    // Choisir le DÉFAUT est un choix : la clé est présente, donc « fr » posé
    // exprès n'est pas écrasé par la copie de la base.
    saveLanguage('fr');
    assert.equal(getStoredLanguage(), 'fr');
    assert.equal(hasStoredChoice('language'), true);
    assert.equal(LANGUAGE_STORAGE_KEY, DISPLAY_PREFERENCE_STORAGE_KEYS.language);
    assert.equal(localStorage.getItem(LANGUAGE_STORAGE_KEY), 'fr');
  });

  it('une valeur de langue corrompue dégrade au français', () => {
    installStorage().setItem(LANGUAGE_STORAGE_KEY, 'de');
    assert.equal(getStoredLanguage(), 'fr');
  });

  it('l’instantané des choix lit les quatre clés en une fois', () => {
    const storage = installStorage();
    assert.deepEqual(readStoredChoices(), { theme: false, density: false, iconGlass: false, language: false });

    for (const name of NAMES) storage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS[name], 'x');
    assert.deepEqual(readStoredChoices(), { theme: true, density: true, iconGlass: true, language: true });
  });

  it('sans stockage (SSR) ou sur un stockage qui refuse, tout dégrade sans lever', () => {
    removeStorage();
    assert.equal(getStoredLanguage(), 'fr');
    assert.equal(hasStoredChoice('theme'), false);
    assert.deepEqual(readStoredChoices(), { theme: false, density: false, iconGlass: false, language: false });
    assert.doesNotThrow(() => saveLanguage('en'));

    // Un stockage qui LÈVE à la lecture (mode privé, quota) : les quatre
    // questions doivent répondre « non », pas faire tomber l'écran.
    installStorage({
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {},
    } as unknown as MemoryStorage);
    assert.equal(getStoredLanguage(), 'fr');
    assert.equal(hasStoredChoice('density'), false);
    assert.deepEqual(readStoredChoices(), { theme: false, density: false, iconGlass: false, language: false });
    assert.doesNotThrow(() => saveLanguage('en'));
  });
});
