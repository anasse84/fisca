import { describe, expect, it } from 'vitest';
import { amountInWordsAr, amountInWordsFr } from './amount-in-words.ts';

/** Vecteurs écrits à la main (orthographe française usuelle : traits d'union entre dizaines et unités, « et » sans trait). */
const FR_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [0, 'zéro dirham et zéro centime'],
  [1, 'zéro dirham et un centime'],
  [100, 'un dirham et zéro centime'],
  [200, 'deux dirhams et zéro centime'],
  [1200000, 'douze mille dirhams et zéro centime'], // exemple de la Section 09
  [8000, 'quatre-vingts dirhams et zéro centime'],
  [8100, 'quatre-vingt-un dirhams et zéro centime'],
  [2100, 'vingt et un dirhams et zéro centime'],
  [7100, 'soixante et onze dirhams et zéro centime'],
  [9900, 'quatre-vingt-dix-neuf dirhams et zéro centime'],
  [1700, 'dix-sept dirhams et zéro centime'],
  [20000, 'deux cents dirhams et zéro centime'],
  [20100, 'deux cent un dirhams et zéro centime'],
  [10000, 'cent dirhams et zéro centime'],
  [100000, 'mille dirhams et zéro centime'],
  [110000, 'mille cent dirhams et zéro centime'],
  [20000000, 'deux cent mille dirhams et zéro centime'],
  [8000000, 'quatre-vingt mille dirhams et zéro centime'],
  [123456, 'mille deux cent trente-quatre dirhams et cinquante-six centimes'],
  [10000000, 'cent mille dirhams et zéro centime'],
  [100000000, 'un million de dirhams et zéro centime'],
  [200000000, 'deux millions de dirhams et zéro centime'],
  [100000100, 'un million un dirhams et zéro centime'],
  [2000000000, 'vingt millions de dirhams et zéro centime'],
  [800000000, 'huit millions de dirhams et zéro centime'],
  [8000000000, 'quatre-vingts millions de dirhams et zéro centime'],
  [100000000000, 'un milliard de dirhams et zéro centime'],
  [100200000000, 'un milliard deux millions de dirhams et zéro centime'],
  [5, 'zéro dirham et cinq centimes'],
  [101, 'un dirham et un centime'],
];

/** Vecteurs arabes écrits à la main (accord du dénombré, duel à l'état construit devant le nom compté). */
const AR_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [0, 'صفر درهم وصفر سنتيم'],
  [1200000, 'اثنا عشر ألف درهم وصفر سنتيم'], // exemple de la Section 09
  [100, 'درهم واحد وصفر سنتيم'],
  [201, 'درهمان وسنتيم واحد'],
  [350, 'ثلاثة دراهم وخمسون سنتيم'],
  [20000, 'مائتا درهم وصفر سنتيم'],
  [123456, 'ألف ومائتان وأربعة وثلاثون درهم وستة وخمسون سنتيم'],
  [200000, 'ألفا درهم وصفر سنتيم'],
  [1100, 'أحد عشر درهم وصفر سنتيم'],
  [10000, 'مائة درهم وصفر سنتيم'],
  [500000, 'خمسة آلاف درهم وصفر سنتيم'],
  [100000000, 'مليون درهم وصفر سنتيم'],
  [200000000, 'مليونا درهم وصفر سنتيم'],
  [300000000, 'ثلاثة ملايين درهم وصفر سنتيم'],
  [2000000, 'عشرون ألف درهم وصفر سنتيم'],
  [20000000, 'مائتا ألف درهم وصفر سنتيم'],
  [100000500, 'مليون وخمسة دراهم وصفر سنتيم'],
  [20200, 'مائتان واثنان درهم وصفر سنتيم'],
  [100210, 'ألف واثنان درهم وعشرة سنتيمات'],
  [100000000000, 'مليار درهم وصفر سنتيم'],
  [1, 'صفر درهم وسنتيم واحد'],
  [2, 'صفر درهم وسنتيمان'],
  [2100, 'واحد وعشرون درهم وصفر سنتيم'],
  [2200, 'اثنان وعشرون درهم وصفر سنتيم'],
];

describe('arrêté en lettres — français (fonction pure, centimes entiers)', () => {
  for (const [cents, text] of FR_VECTORS) {
    it(`${cents} centimes → ${text}`, () => {
      expect(amountInWordsFr(cents)).toBe(text);
    });
  }
  it('accepte un bigint et refuse négatif, flottant et valeur hors limite', () => {
    expect(amountInWordsFr(1200000n)).toBe('douze mille dirhams et zéro centime');
    expect(() => amountInWordsFr(-1)).toThrow(/AMOUNT_WORDS_INVALID/);
    expect(() => amountInWordsFr(12.5)).toThrow(/AMOUNT_WORDS_INVALID/);
    expect(() => amountInWordsFr(10n ** 18n)).toThrow(/AMOUNT_WORDS_INVALID/);
  });
});

describe('arrêté en lettres — arabe classique (algorithme implémenté, vecteurs vérifiés à la main)', () => {
  for (const [cents, text] of AR_VECTORS) {
    it(`${cents} centimes → ${text}`, () => {
      expect(amountInWordsAr(cents)).toBe(text);
    });
  }
  it('refuse négatif, flottant et valeur hors limite', () => {
    expect(() => amountInWordsAr(-1)).toThrow(/AMOUNT_WORDS_INVALID/);
    expect(() => amountInWordsAr(0.5)).toThrow(/AMOUNT_WORDS_INVALID/);
    expect(() => amountInWordsAr(10n ** 18n)).toThrow(/AMOUNT_WORDS_INVALID/);
  });
});
