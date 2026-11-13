import { describe, expect, it } from 'vitest';
import { AdrInvariantError, assertCertificateMatchesEmitter } from '../src/index.ts';

const ICE = '001534290000057';
const IF = '45678901';

function check(dn: string, ice: string = ICE, ifValue: string = IF): void {
  assertCertificateMatchesEmitter(dn, ice, ifValue);
}

function expectRefused(dn: string, ice: string = ICE, ifValue: string = IF): void {
  try {
    check(dn, ice, ifValue);
  } catch (error) {
    expect(error).toBeInstanceOf(AdrInvariantError);
    expect(error).toMatchObject({ code: 'ADR_06_LOI4320_CERT_MISMATCH' });
    return;
  }
  expect.unreachable(`SubjectDN accepté à tort : ${dn}`);
}

describe('ADR-06 : vecteurs du propriétaire', () => {
  it('accepte organizationIdentifier=NTRMA-<ICE>', () => {
    expect(() => check(`CN=ATLAS SARL, organizationIdentifier=NTRMA-${ICE}, C=MA`)).not.toThrow();
  });
  it('accepte 2.5.4.97=VATMA-<IF>', () => {
    expect(() => check(`CN=ATLAS SARL, 2.5.4.97=VATMA-${IF}, C=MA`)).not.toThrow();
  });
  it('accepte serialNumber=<ICE> (valeur nue)', () => {
    expect(() => check(`CN=ATLAS SARL, serialNumber=${ICE}, C=MA`)).not.toThrow();
  });
  it('refuse un préfixe ETSI étranger (VATFR-)', () => {
    expectRefused(`CN=ATLAS SARL, organizationIdentifier=VATFR-${IF}, C=FR`);
  });
  it('refuse un serialNumber qui n\'est ni l\'ICE ni un jeton de l\'IF', () => {
    expectRefused('CN=OTHER, serialNumber=994567890199, C=MA');
  });
  it('refuse le CN seul, même contenant l\'ICE', () => {
    expectRefused(`CN=ATLAS ${ICE}, C=MA`);
    expectRefused(`CN=${ICE}, C=MA`);
  });
});

describe('ADR-06 : jetons acceptés', () => {
  const iceTokens = [ICE, `NTRMA-${ICE}`, `ICEMA-${ICE}`, `ICE:${ICE}`, `ICE-${ICE}`];
  const ifTokens = [`VATMA-${IF}`, `IFMA-${IF}`, `IF:${IF}`, `IF-${IF}`];
  const keys = ['organizationIdentifier', 'OID.2.5.4.97', '2.5.4.97', 'serialNumber', 'OID.2.5.4.5', '2.5.4.5'];
  for (const key of keys) {
    for (const token of [...iceTokens, ...ifTokens]) {
      it(`accepte ${key}=${token}`, () => {
        expect(() => check(`CN=X, ${key}=${token}, C=MA`)).not.toThrow();
      });
    }
  }
  it('accepte la valeur entre guillemets et en minuscules', () => {
    expect(() => check(`CN=X, organizationIdentifier="ntrma-${ICE}"`)).not.toThrow();
    expect(() => check(`CN=X, serialNumber=vatma-${IF}`)).not.toThrow();
  });
  it('accepte les séparateurs "/" et "+"', () => {
    expect(() => check(`/C=MA/CN=X/organizationIdentifier=NTRMA-${ICE}`)).not.toThrow();
    expect(() => check(`CN=X+serialNumber=${ICE}, C=MA`)).not.toThrow();
  });
  it('garde les échappements existants', () => {
    expect(() => check(`CN=ACME\\, SARL, serialNumber=${ICE}`)).not.toThrow();
  });
});

describe('ADR-06 : cas adverses', () => {
  it('refuse l\'ICE en sous-chaîne d\'une valeur plus longue', () => {
    expectRefused(`CN=X, serialNumber=${ICE}9`);
    expectRefused(`CN=X, serialNumber=9${ICE}`);
    expectRefused(`CN=X, organizationIdentifier=NTRMA-${ICE}0`);
    expectRefused(`CN=X, organizationIdentifier=NTRMA-${ICE} SARL`);
    expectRefused(`CN=X, serialNumber=VATMA-${IF}1`);
  });
  it('refuse des jetons croisés (ICE avec préfixe IF, IF avec préfixe ICE)', () => {
    expectRefused(`CN=X, serialNumber=VATMA-${ICE}`);
    expectRefused(`CN=X, serialNumber=NTRMA-${IF}`);
    expectRefused(`CN=X, serialNumber=${IF}`);
  });
  it('refuse un attribut non identifiant (O, OU)', () => {
    expectRefused(`CN=X, O=NTRMA-${ICE}`);
    expectRefused(`CN=X, OU=${ICE}`);
  });
  it('refuse tout préfixe ETSI à code pays autre que MA, quelle que soit la casse', () => {
    for (const value of [`VATFR-${IF}`, `NTRDE-${ICE}`, `PSDES-${ICE}`, `LEIUS-${ICE}`, `vatfr-${IF}`]) {
      expectRefused(`CN=X, organizationIdentifier=${value}`);
      expectRefused(`CN=X, serialNumber=${value}`);
    }
  });
  it('refuse un double attribut dont un valide et un d\'un autre pays (dans les deux ordres)', () => {
    expectRefused(`CN=X, organizationIdentifier=NTRMA-${ICE}, serialNumber=VATFR-${IF}`);
    expectRefused(`CN=X, serialNumber=VATFR-${IF}, organizationIdentifier=NTRMA-${ICE}`);
    expectRefused(`CN=X, serialNumber=${ICE}, 2.5.4.97=NTRDE-${ICE}`);
  });
  it('refuse un DN malformé ou vide', () => {
    for (const dn of ['', '   ', 'serialNumber', `=${ICE}`, `serialNumber${ICE}`, `CN=X, serialNumber=`, `"serialNumber=${ICE}`, `CN=X,,,`]) {
      expectRefused(dn);
    }
  });
  it('échec fermé : ICE de 14 ou 16 chiffres, ou non numérique', () => {
    const dn = `CN=X, serialNumber=${ICE}, organizationIdentifier=VATMA-${IF}`;
    expectRefused(dn, ICE.slice(1));
    expectRefused(dn, `${ICE}0`);
    expectRefused(dn, `${ICE.slice(1)}A`);
    expectRefused(dn, '');
    expectRefused(`CN=X, serialNumber=${ICE.slice(1)}`, ICE.slice(1));
    expectRefused(`CN=X, serialNumber=${ICE}0`, `${ICE}0`);
  });
  it('échec fermé : IF de 5 ou 13 chiffres, ou non numérique', () => {
    const dn = `CN=X, serialNumber=${ICE}, organizationIdentifier=VATMA-12345`;
    expectRefused(dn, ICE, '12345');
    expectRefused(`CN=X, serialNumber=${ICE}`, ICE, '12345');
    expectRefused(`CN=X, serialNumber=${ICE}`, ICE, '1234567890123');
    expectRefused(`CN=X, serialNumber=${ICE}`, ICE, '4567890A');
    expectRefused(`CN=X, serialNumber=${ICE}`, ICE, '');
    expectRefused(`CN=X, organizationIdentifier=VATMA-1234567890123`, ICE, '1234567890123');
  });
  it('accepte un IF de 6 et de 12 chiffres (bornes)', () => {
    expect(() => check('CN=X, serialNumber=IFMA-123456', ICE, '123456')).not.toThrow();
    expect(() => check('CN=X, serialNumber=IFMA-123456789012', ICE, '123456789012')).not.toThrow();
  });
});
