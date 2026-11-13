import { describe, expect, it, vi } from 'vitest';
import canary from '../../compliance-cndp/tests/golden/pentest-canaries.vectors.json';
import { E2eeError, EphemeralRamPiiScrubber } from '../src/e2ee-engine.ts';
import type { PiiScrubContext } from '../src/e2ee-engine.ts';

/** Générateur d'aléa déterministe (xorshift32) à graine fixe : jamais Math.random. */
function seededRandom(seed: number): (buffer: Uint8Array<ArrayBuffer>) => void {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return (buffer) => {
    for (let i = 0; i < buffer.length; i += 1) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      buffer[i] = state & 0xff;
    }
  };
}

const OBFUSCATED =
  `RIB 011 780 0000123456 78901234 ICE ００１２３４５６７０００\u200b０８９ mail A@B.MA \u202etel\u202c`;
const TOKEN_PATTERN = /\[[A-Za-z0-9_]+\]/g;

const RIB = '011780000012345678901234';
const ICE = '001234567000089';
const CONTEXT: PiiScrubContext = {
  names: ['Atlas Conseil SARL', 'Karim Benali'],
  addresses: ['12 rue des Orangers, Rabat'],
  taxIdentifiers: ['40123456'],
  cnssNumbers: ['1234567'],
  nationalIds: [],
};
const RAW =
  `Client Atlas Conseil SARL (ICE ${ICE}, IF 40123456, CNSS 1234567), salarié Karim Benali CIN AB123456, ` +
  `RIB ${RIB}, IBAN MA64 0117 8000 0012 3456 7890 1234, mail k.benali@atlas.ma, tel +212 661-234567 ou 0612345678, ` +
  `adresse 12 rue des Orangers, Rabat. Compte 3421 montant 1200000 centimes.`;
const LEAKS = [
  ICE, '40123456', '1234567', 'AB123456', RIB, '0117 8000', 'k.benali@atlas.ma', '661-234567', '0612345678',
  'Atlas Conseil', 'Benali', 'rue des Orangers',
];

describe('EphemeralRamPiiScrubber — zéro fuite', () => {
  it('ne laisse aucune donnée réelle dans la sortie', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    const out = scrubber.scrubText(RAW, [], CONTEXT);
    for (const leak of LEAKS) expect(out).not.toContain(leak);
    expect(out).toContain('Compte 3421 montant 1200000 centimes');
    expect(out).toMatch(/\[ICE15_01_[0-9a-f]{8}\]/);
    expect(out).toMatch(/\[RIB24_01_[0-9a-f]{8}\]/);
    expect(out).toMatch(/\[PHONE_MA_01_[0-9a-f]{8}\]/);
    expect(out).toMatch(/\[EMAIL_01_[0-9a-f]{8}\]/);
  });

  it('masque CIN, IF et CNSS même sans déclaration pour le CIN', () => {
    const out = new EphemeralRamPiiScrubber().scrubText('CIN K123456 et BE12345', []);
    expect(out).not.toContain('K123456');
    expect(out).not.toContain('BE12345');
  });

  it('masque les valeurs obfusquées par chiffres pleine largeur, espaces et caractères invisibles', () => {
    const out = new EphemeralRamPiiScrubber({ randomSource: seededRandom(1) }).scrubText(OBFUSCATED, []);
    expect(out.replace(TOKEN_PATTERN, '')).not.toMatch(/\d{6}/);
    expect(out).not.toMatch(/[\u202A-\u202E\u200B]/u);
    expect(out).not.toContain('A@B.MA');
  });

  it('déterministe : 2 000 graines différentes, 0 faux rouge (jetons à aléa hexadécimal minuscule inclus)', () => {
    let falseReds = 0;
    let nonceWithSixDigits = 0;
    for (let seed = 1; seed <= 2000; seed += 1) {
      const out = new EphemeralRamPiiScrubber({ randomSource: seededRandom(seed) }).scrubText(OBFUSCATED, []);
      if (/\d{6}/.test(out.replace(TOKEN_PATTERN, ''))) falseReds += 1;
      // l'ancienne expression (majuscules seules) aurait été sensible à ces aléas : le test les exerce bien
      if (/\d{6}/.test(out.replace(/\[[A-Z0-9_]+\]/g, ''))) nonceWithSixDigits += 1;
    }
    expect(falseReds).toBe(0);
    expect(nonceWithSixDigits).toBeGreaterThan(0);
  });

  it('le générateur injecté est la seule source d’aléa : même graine => mêmes jetons ; défaut = crypto.getRandomValues', () => {
    const a = new EphemeralRamPiiScrubber({ randomSource: seededRandom(7) }).scrubText(ICE, []);
    const b = new EphemeralRamPiiScrubber({ randomSource: seededRandom(7) }).scrubText(ICE, []);
    const c = new EphemeralRamPiiScrubber({ randomSource: seededRandom(8) }).scrubText(ICE, []);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const math = vi.spyOn(Math, 'random');
    try {
      new EphemeralRamPiiScrubber();
      expect(spy).toHaveBeenCalled();
      expect(math).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      math.mockRestore();
    }
  });

  it('retire les tags Unicode et les contrôles bidi comme le code de référence', () => {
    const tag = String.fromCodePoint(0xe0041, 0xe0042);
    const out = new EphemeralRamPiiScrubber().scrubText(`a${tag}b\u202e\u2066c`, []);
    expect(out).toBe('abc');
  });

  it('couvre la phrase canary de la spec', () => {
    const out = new EphemeralRamPiiScrubber().scrubText(canary.canary.visibleText, []);
    expect(out).not.toContain(canary.canary.ribThatMustNeverLeakToAi);
  });

  it('les noms déclarés par les anciens appels (knownNames) restent pris en charge, sans casse', () => {
    const out = new EphemeralRamPiiScrubber().scrubText('Karim BENALI a signé', ['Karim Benali']);
    expect(out).not.toMatch(/benali/i);
  });
});

describe('EphemeralRamPiiScrubber — jetons', () => {
  it('même valeur => même jeton, valeurs distinctes => jetons distincts', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    const out = scrubber.scrubText(`${ICE} ${ICE} 001234567000090 ${RIB} 011780000012345678901235`, []);
    const tokens = out.split(' ');
    expect(tokens[0]).toBe(tokens[1]);
    expect(new Set([tokens[0], tokens[2], tokens[3], tokens[4]]).size).toBe(4);
    expect(scrubber.tokenCount).toBe(4);
  });

  it('le même numéro écrit avec séparateurs différents reçoit le même jeton', () => {
    const out = new EphemeralRamPiiScrubber().scrubText('0612345678 / +212 6 12 34 56 78', []);
    const parts = out.split(' / ');
    expect(parts[0]).toBe(parts[1]);
  });

  it('les jetons ne sont pas devinables : deux requêtes donnent des suffixes différents', () => {
    const a = new EphemeralRamPiiScrubber().scrubText(ICE, []);
    const b = new EphemeralRamPiiScrubber().scrubText(ICE, []);
    expect(a).not.toBe(b);
  });

  it('un faux jeton injecté par un document tiers n’est jamais réhydraté', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    scrubber.scrubText(`ICE ${ICE}`, []);
    const forged = '[ICE15_01_00000000] et [ICE15_01]';
    expect(scrubber.rehydrateText(forged)).toBe(forged);
  });

  it('un nom déclaré court ou vide est ignoré, et un nom ne casse pas les jetons produits', () => {
    const out = new EphemeralRamPiiScrubber().scrubText(`ICE ${ICE} ENT`, ['EN', 'ENT', ' ']);
    expect(out).toMatch(/^ICE \[ICE15_01_[0-9a-f]{8}\] \[ENTITY_01_[0-9a-f]{8}\]$/);
  });
});

describe('EphemeralRamPiiScrubber — aller-retour et destruction', () => {
  it('réhydrate la réponse du modèle', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    const out = scrubber.scrubText(RAW, [], CONTEXT);
    const restored = scrubber.rehydrateText(`Analyse : ${out}`);
    expect(restored).toContain(ICE);
    expect(restored).toContain('Atlas Conseil SARL');
    expect(restored).toContain('k.benali@atlas.ma');
    expect(restored).toContain('AB123456');
  });

  it('la ré-hydratation ne rejoue pas un jeton contenu dans une valeur restaurée', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    const out = scrubber.scrubText('Atlas Conseil SARL', ['Atlas Conseil SARL']);
    expect(scrubber.rehydrateText(`${out}${out}`)).toBe('Atlas Conseil SARLAtlas Conseil SARL');
  });

  it('destroy vide la table, est idempotent et interdit tout usage ultérieur', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    const out = scrubber.scrubText(`ICE ${ICE}`, []);
    expect(scrubber.isDestroyed).toBe(false);
    scrubber.destroy();
    scrubber.destroy();
    expect(scrubber.isDestroyed).toBe(true);
    expect(scrubber.tokenCount).toBe(0);
    expect(() => scrubber.rehydrateText(out)).toThrow(E2eeError);
    expect(() => scrubber.scrubText(ICE, [])).toThrow(E2eeError);
  });

  it('withScrubber détruit la table même en cas d’erreur', async () => {
    let captured: EphemeralRamPiiScrubber | undefined;
    await expect(
      EphemeralRamPiiScrubber.withRequest(async (s) => {
        captured = s;
        s.scrubText(ICE, []);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(captured?.isDestroyed).toBe(true);
    const value = await EphemeralRamPiiScrubber.withRequest(async (s) => s.scrubText('rien', []));
    expect(value).toBe('rien');
  });

  it('ne produit aucune sortie console ni écriture (aucun stockage)', () => {
    const scrubber = new EphemeralRamPiiScrubber();
    expect(Object.keys(scrubber)).not.toContain('log');
    scrubber.destroy();
  });
});

describe('EphemeralRamPiiScrubber — ICE (15 chiffres) avec séparateurs', () => {
  const SPELLINGS: readonly (readonly [string, string])[] = [
    ['espaces 4-3-3-3-2', 'ICE 0012 3456 7000 089'],
    ['espaces 3 par 3', '001 234 567 000 089'],
    ['espaces 9-6', '001234567 000089'],
    ['tirets', '001-234-567-000-089'],
    ['points', '001.234.567.000.089'],
    ['espace insécable', '001\u00a0234\u00a0567\u00a0000\u00a0089'],
    ['espace fine', '001\u2009234\u2009567\u2009000\u2009089'],
    ['espace fine insécable', '001\u202f234\u202f567\u202f000\u202f089'],
    ['tiret demi-cadratin', '001\u2013234\u2013567\u2013000\u2013089'],
    ['tiret cadratin', '001\u2014234\u2014567\u2014000\u2014089'],
    ['trait d’union typographique', '001\u2010234\u2010567\u2010000\u2010089'],
    ['barre oblique', '001/234/567/000/089'],
    ['zéro-largeur entre chiffres', '001\u200b234\u200c567\u200d000\u2060089'],
    ['zéro-largeur + espaces', '001 \u200b234 \u200b567 000 089'],
    ['chiffres pleine largeur séparés', '００１ ２３４ ５６７ ０００ ０８９'],
  ];

  for (const [label, spelling] of SPELLINGS) {
    it(`masque entièrement l’ICE écrit avec ${label}, sans fragment de chiffres`, () => {
      const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(3) });
      const out = scrubber.scrubText(`Société ${spelling} fin`, []);
      expect(out).toMatch(/^Société (?:ICE )?\[ICE15_01_[0-9a-f]{8}\] fin$/);
      expect(out.replace(TOKEN_PATTERN, '')).not.toMatch(/\d/);
    });
  }

  it('toutes les graphies du même ICE reçoivent le même jeton', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(4) });
    const tokens = SPELLINGS.map(([, spelling]) => scrubber.scrubText(spelling.replace(/^ICE /, ''), []));
    expect(new Set(tokens).size).toBe(1);
    expect(scrubber.tokenCount).toBe(1);
  });

  it('aller-retour : la graphie d’origine est restituée à la réhydratation', () => {
    for (const spelling of [
      '0012 3456 7000 089',
      '001 234 567 000 089',
      '001234567 000089',
      '001-234-567-000-089',
      '001.234.567.000.089',
      '001/234/567/000/089',
      '001\u00a0234\u00a0567\u00a0000\u00a0089'.normalize('NFKC'),
      '001\u2013234\u2013567\u2013000\u2013089',
      '001\u2014234\u2014567\u2014000\u2014089',
    ]) {
      const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(5) });
      const masked = scrubber.scrubText(`avant ${spelling} après`, []);
      expect(masked).not.toContain('001');
      expect(scrubber.rehydrateText(masked)).toBe(`avant ${spelling} après`);
    }
  });

  it('les graphies obfusquées sont restituées sans les caractères invisibles (comportement documenté de normalisation)', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(6) });
    const masked = scrubber.scrubText('ICE 001\u200b234\u200b567\u200b000\u200b089 ok', []);
    expect(masked.replace(TOKEN_PATTERN, '')).not.toMatch(/\d/);
    expect(scrubber.rehydrateText(masked)).toBe('ICE 001234567000089 ok');
  });

  it('faux positifs : téléphone marocain, montant, date, référence, 14 et 16 chiffres séparés', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(9) });
    const phone = scrubber.scrubText('+212 6 12 34 56 78', []);
    expect(phone).toMatch(/^\[PHONE_MA_01_[0-9a-f]{8}\]$/);
    const untouched = [
      'Montant 1 234 567,89 MAD',
      'Montant 1.234.567,89 MAD',
      'Date 15/03/2024 et 2024-03-15',
      'Facture FA-2024-0042 du 03.04.2024',
      'Réf 123-456-789',
      'Nombre 0012 3456 7000 08',
      'Nombre 0012 3456 7000 0891 2',
      '12 345 678 901 234',
      '1234 5678 9012 3456',
      '1-2-3-4-5-6-7-8-9-0-1-2-3-4',
    ];
    for (const text of untouched) expect(scrubber.scrubText(text, [])).toBe(text);
  });

  it('un nombre de 16 chiffres collés reste masqué (NUM_LONG) et un ICE collé à du texte n’est pas tronqué', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(10) });
    expect(scrubber.scrubText('1234567890123456', [])).toMatch(/^\[NUM_LONG_01_[0-9a-f]{8}\]$/);
    expect(scrubber.scrubText('ICE:001234567000089.', [])).toMatch(/^ICE:\[ICE15_01_[0-9a-f]{8}\]\.$/);
  });

  it('deux identifiants consécutifs séparés par une espace donnent deux jetons, sans fusion ni fuite', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(12) });
    const out = scrubber.scrubText(`${ICE} 001234567000090 15/03/2024 ${ICE}`, []);
    expect(out).toMatch(/^\[ICE15_01_[0-9a-f]{8}\] \[ICE15_02_[0-9a-f]{8}\] 15\/03\/2024 \[ICE15_01_[0-9a-f]{8}\]$/);
  });

  it('ne régresse pas : RIB, IBAN, e-mail, téléphones restent masqués', () => {
    const scrubber = new EphemeralRamPiiScrubber({ randomSource: seededRandom(11) });
    const out = scrubber.scrubText(
      `RIB ${RIB} puis 0117-8000-0012-3456-7890-1234, IBAN MA64 0117 8000 0012 3456 7890 1234, a@b.ma, 0612345678, +212 661-234567`,
      [],
    );
    expect(out.replace(TOKEN_PATTERN, '')).not.toMatch(/\d{3}/);
    expect(out).not.toContain('a@b.ma');
    expect(out).toMatch(/\[RIB24_/);
    expect(out).toMatch(/\[IBAN_MA_/);
  });
});
