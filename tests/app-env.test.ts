// Suite for appEnvFrom (src/lib/networkUtils.ts).
//
// WHY THIS EXISTS
// ---------------
// L'application Windows LIVRÉE le 2026-09-13 se déclarait `development` : le
// bundle publié contenait `function Ge(){return`development`}`. La cause est un
// fichier absent — `.env.production` est gitignoré, donc le build du runner ne
// l'avait pas, donc `import.meta.env.VITE_APP_ENV` valait `undefined` et le
// repli répondait `development`. Le site web déployé, lui, répondait bien
// `production` (`return`production`` dans son bundle) : deux artefacts publics,
// deux environnements déclarés, pour un même `main`.
//
// Ce que la suite verrouille est donc la règle, pas la valeur d'un jour : le
// MODE compilé par Vite décide, et un build de production ne peut plus se
// déclarer en test même si aucun fichier `.env` n'existe.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appEnvFrom } from '../src/lib/networkUtils';

describe('l’environnement d’un build est déduit du MODE compilé', () => {
  it('un build `production` sans aucun VITE_APP_ENV est en PRODUCTION (le défaut mesuré)', () => {
    // C'est le cas exact du runner : aucun `.env.production` dans le dépôt.
    assert.equal(appEnvFrom({ MODE: 'production' }), 'production');
  });

  it('un build `staging` est en staging, jamais confondu avec la production', () => {
    assert.equal(appEnvFrom({ MODE: 'staging' }), 'staging');
  });

  it('le serveur de développement reste en développement', () => {
    assert.equal(appEnvFrom({ MODE: 'development' }), 'development');
  });

  it('VITE_APP_ENV reste PRIORITAIRE sur le mode', () => {
    // Un build `production` peut devoir se présenter autrement (pré-version
    // servie depuis un build de production) : l'explicite gagne.
    assert.equal(appEnvFrom({ MODE: 'production', VITE_APP_ENV: 'staging' }), 'staging');
    assert.equal(appEnvFrom({ MODE: 'development', VITE_APP_ENV: 'production' }), 'production');
  });

  it('une valeur inconnue, vide ou absente retombe en développement, jamais en production', () => {
    // Le repli doit être SÛR : ne rien savoir ne donne pas un feu vert.
    for (const env of [{ MODE: 'preview' }, { VITE_APP_ENV: '' }, { VITE_APP_ENV: 'PRODUCTION' }, {}, undefined]) {
      assert.equal(appEnvFrom(env), 'development', JSON.stringify(env));
    }
  });

  it('aucun chemin ne peut rendre `production` par accident', () => {
    // La pastille « DEV » de l'app livrée venait d'un repli optimiste : le seul
    // chemin vers `production` doit être une déclaration explicite, mode compris.
    const accidental = [
      { MODE: 'prod' },
      { MODE: 'Production' },
      { VITE_APP_ENV: 'prod' },
      { MODE: 'production ', VITE_APP_ENV: ' ' },
    ];
    for (const env of accidental) {
      assert.notEqual(appEnvFrom(env), 'production', JSON.stringify(env));
    }
  });
});
