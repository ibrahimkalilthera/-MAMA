/**
 * LE CACHET DE L'ÉCOLE HORS LIGNE — le seul morceau d'un reçu qui venait du réseau.
 *
 * Mesuré : `pdfStamp.ts` chargeait `public/tampon.png` par `fetch` AU MOMENT
 * d'imprimer. Sans ligne, le document était bien généré — mais SANS sceau, et
 * sans rien dire : sur un reçu, c'est la marque de l'école qui manque.
 *
 * Trois comportements sont verrouillés ici :
 *   • un échec n'est pas mémorisé (l'ancienne version gardait le `null` de la
 *     session : le premier reçu imprimé pendant une coupure privait de cachet
 *     TOUS les suivants, même après le retour de la ligne) ;
 *   • une fois obtenu, le cachet est conservé sur le poste et relu sans requête ;
 *   • un cachet d'un build précédent reste utilisé si le nouveau n'a pas pu être
 *     lu (un cachet d'hier vaut mieux qu'un reçu sans sceau).
 *
 * Aucun DOM ici : `Image`/`document` manquent, donc le cachet est pris tel quel
 * (la mise à l'échelle par canvas est un détail de navigateur, pas du contrat).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

/** FileReader minimal : c'est lui qui transforme le blob en data URL. */
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: unknown): void {
    this.result = (blob as { dataUrl: string }).dataUrl;
    queueMicrotask(() => this.onload?.());
  }
}

const STORAGE_KEY = 'mama_thera_school_stamp_v1';
const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const storage = new MemoryStorage();
let fetchCalls = 0;
let fetchBehaviour: 'ok' | 'offline' = 'ok';

Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'FileReader', { value: FakeFileReader, configurable: true });
Object.defineProperty(globalThis, 'fetch', {
  value: async () => {
    fetchCalls += 1;
    if (fetchBehaviour === 'offline') throw new TypeError('Failed to fetch');
    return { ok: true, blob: async () => ({ dataUrl: PNG_URL }) };
  },
  configurable: true,
});

const { drawSchoolStamp, preloadSchoolStamp } = await import('../src/lib/pdfStamp');

/** Un faux document jsPDF : on ne garde que ce qui a été dessiné. */
function fakeDoc() {
  const drawn: string[] = [];
  return {
    drawn,
    doc: {
      addImage: (...args: unknown[]) => {
        drawn.push(String(args[0]));
      },
    } as unknown as Parameters<typeof drawSchoolStamp>[0],
  };
}

beforeEach(() => {
  storage.removeItem(STORAGE_KEY);
  fetchCalls = 0;
  fetchBehaviour = 'ok';
});

describe('cachet de l’école hors ligne', () => {
  it('sans réseau ni copie locale : le document sort sans cachet, sans lever', async () => {
    fetchBehaviour = 'offline';
    const { doc, drawn } = fakeDoc();

    await drawSchoolStamp(doc, 105, 40, 20);
    assert.deepEqual(drawn, [], 'rien n’est dessiné — mais rien n’a échoué non plus');
  });

  it('la ligne revenue, le cachet revient : l’échec n’a pas été mémorisé', async () => {
    fetchBehaviour = 'offline';
    await preloadSchoolStamp();
    assert.equal(storage.getItem(STORAGE_KEY), null, 'un échec ne laisse rien derrière lui');

    fetchBehaviour = 'ok';
    const { doc, drawn } = fakeDoc();
    await drawSchoolStamp(doc, 105, 40, 20);

    assert.deepEqual(drawn, [PNG_URL], 'le premier reçu APRÈS la coupure est cacheté');
    assert.ok(storage.getItem(STORAGE_KEY), 'et le cachet est désormais conservé sur le poste');
  });

  it('le cachet conservé est relu SANS aucune requête (c’est le point)', async () => {
    fetchBehaviour = 'offline';
    storage.setItem(STORAGE_KEY, JSON.stringify({ build: '', url: PNG_URL }));
    const { doc, drawn } = fakeDoc();

    await drawSchoolStamp(doc, 105, 40, 20);
    assert.deepEqual(drawn, [PNG_URL], 'le sceau est là, sans réseau');
    assert.equal(fetchCalls, 0, 'et le réseau n’est même pas interrogé');
  });

  it('un cachet d’un build précédent sert encore si le nouveau est injoignable', async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ build: 'ancien-sha', url: PNG_URL }));
    fetchBehaviour = 'offline';
    const { doc, drawn } = fakeDoc();

    await drawSchoolStamp(doc, 105, 40, 20);
    assert.deepEqual(drawn, [PNG_URL], 'un cachet d’hier vaut mieux qu’un reçu sans sceau');
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)!).build, 'ancien-sha', 'la copie n’est pas écrasée par un échec');
  });
});
