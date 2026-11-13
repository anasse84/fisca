import { describe, expect, it } from 'vitest';
import canary from '../../compliance-cndp/tests/golden/pentest-canaries.vectors.json';
import { E2eeError, EphemeralRamPiiScrubber } from '../src/e2ee-engine.ts';
import type { PiiScrubContext } from '../src/e2ee-engine.ts';

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
    const out = new EphemeralRamPiiScrubber().scrubText(
      `RIB 011 780 0000123456 78901234 ICE ００１２３４５６７０００\u200b０８９ mail A@B.MA \u202etel\u202c`,
      [],
    );
    expect(out.replace(/\[[A-Z0-9_]+\]/g, '')).not.toMatch(/\d{6}/);
    expect(out).not.toMatch(/[\u202A-\u202E\u200B]/u);
    expect(out).not.toContain('A@B.MA');
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
