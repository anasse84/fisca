import { describe, expect, it } from 'vitest';
import {
  CNDP_ADEQUATE_ISO2,
  CGI_ART_211_RETENTION_YEARS,
  DsarInputError,
  SOVEREIGNTY_POLICIES,
  SovereignEgressError,
  assertSovereignEgressAllowed,
  evaluateCndpErasureAgainstCgiArt211,
  evaluateCndpErasureRequest,
} from '../src/index.ts';
import goldenVectors from './golden/dsar-art211.vectors.json';
import type { OutboundServiceTarget, SubjectRecordDescriptor } from '../src/index.ts';

const STRICT = 'STRICT_DGSSI_LAW_05_20_MOROCCO' as const;
const STANDARD = 'STANDARD_CNDP_EU_ADEQUACY' as const;

function target(overrides: Partial<OutboundServiceTarget> = {}): OutboundServiceTarget {
  return {
    serviceName: 'SES',
    destinationCountryIso2: 'FR',
    hasCndpF118Authorization: false,
    carriesPersonalOrFiscalData: true,
    ...overrides,
  };
}

function catchError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('assertSovereignEgressAllowed : mode souverain Loi 05-20 (zéro egress)', () => {
  it('accepte le Maroc, même sans donnée personnelle', () => {
    expect(() => assertSovereignEgressAllowed(STRICT, target({ destinationCountryIso2: 'MA' }))).not.toThrow();
    expect(() =>
      assertSovereignEgressAllowed(STRICT, target({ destinationCountryIso2: 'MA', carriesPersonalOrFiscalData: false })),
    ).not.toThrow();
  });

  it.each([...CNDP_ADEQUATE_ISO2].filter((iso2) => iso2 !== 'MA').concat(['US', 'CN', 'GB', 'CH', 'PL']))(
    'refuse %s avec le message exact de l’ERRATA C',
    (iso2) => {
      const error = catchError(() =>
        assertSovereignEgressAllowed(STRICT, target({ serviceName: 'Infobip', destinationCountryIso2: iso2 })),
      );
      expect(error).toBeInstanceOf(SovereignEgressError);
      expect((error as SovereignEgressError).message).toBe(
        `DGSSI_LAW_05_20_EGRESS_BLOCKED: Flux vers [Infobip] (${iso2}) interdit en mode Souverain Maroc.`,
      );
      expect((error as SovereignEgressError).code).toBe('DGSSI_LAW_05_20_EGRESS_BLOCKED');
    },
  );

  it('refuse même une autorisation F118 et même un flux sans donnée personnelle', () => {
    expect(() =>
      assertSovereignEgressAllowed(STRICT, target({ hasCndpF118Authorization: true, carriesPersonalOrFiscalData: false })),
    ).toThrow(SovereignEgressError);
  });

  it('deny-by-default : code pays vide, minuscule ou mal formé refusé', () => {
    for (const iso2 of ['', 'ma', ' MA', 'MAR', 'M']) {
      expect(() => assertSovereignEgressAllowed(STRICT, target({ destinationCountryIso2: iso2 }))).toThrow(SovereignEgressError);
    }
  });
});

describe('assertSovereignEgressAllowed : mode standard (Art. 43 et 44 Loi 09-08)', () => {
  it('accepte un pays adéquat avec donnée personnelle', () => {
    expect(() => assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: 'IE' }))).not.toThrow();
  });

  it('refuse un pays non adéquat sans F118, message exact de l’ERRATA C', () => {
    const error = catchError(() =>
      assertSovereignEgressAllowed(STANDARD, target({ serviceName: 'Mailer', destinationCountryIso2: 'US' })),
    );
    expect(error).toBeInstanceOf(SovereignEgressError);
    expect((error as SovereignEgressError).message).toBe(
      'CNDP_ART_43_44_TRANSFER_BLOCKED: Transfert vers [Mailer] (US) interdit sans adéquation CNDP ou autorisation F118.',
    );
    expect((error as SovereignEgressError).code).toBe('CNDP_ART_43_44_TRANSFER_BLOCKED');
  });

  it('accepte un pays non adéquat avec autorisation F118, ou sans donnée personnelle ni fiscale', () => {
    expect(() =>
      assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: 'US', hasCndpF118Authorization: true })),
    ).not.toThrow();
    expect(() =>
      assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: 'US', carriesPersonalOrFiscalData: false })),
    ).not.toThrow();
  });

  it('refuse une politique inconnue (deny-by-default) et expose les deux politiques', () => {
    expect(SOVEREIGNTY_POLICIES).toEqual([STANDARD, STRICT]);
    const unknown = 'POLITIQUE_INCONNUE' as unknown as typeof STRICT;
    expect(() => assertSovereignEgressAllowed(unknown, target({ destinationCountryIso2: 'MA' }))).toThrow(SovereignEgressError);
  });

  it('est pure : mêmes entrées, même issue, aucune mutation de la cible', () => {
    const cible = target({ destinationCountryIso2: 'US' });
    const copie = JSON.stringify(cible);
    for (let index = 0; index < 3; index += 1) {
      expect(() => assertSovereignEgressAllowed(STANDARD, cible)).toThrow(SovereignEgressError);
    }
    expect(JSON.stringify(cible)).toBe(copie);
  });
});

type RecordOverrides = Partial<Omit<SubjectRecordDescriptor, 'fiscalYearClosedDateIso'>> & { fiscalYearClosedDateIso?: string | undefined };

function record(overrides: RecordOverrides = {}): SubjectRecordDescriptor {
  const merged = {
    recordId: 'rec-1',
    tableName: 'journal_entries',
    category: 'POSTED_ACCOUNTING_OR_INVOICE' as const,
    fiscalYearClosedDateIso: '2020-12-31' as string | undefined,
    ...overrides,
  };
  const { fiscalYearClosedDateIso, ...rest } = merged;
  return fiscalYearClosedDateIso === undefined ? rest : { ...rest, fiscalYearClosedDateIso };
}

describe('evaluateCndpErasureAgainstCgiArt211 : arbitre DSAR Loi 09-08 / Art. 211 CGI', () => {
  it('la durée décennale est la seule constante fiscale', () => {
    expect(CGI_ART_211_RETENTION_YEARS).toBe(10);
  });

  it.each(['MARKETING_OR_PREFERENCE', 'UNNUMBERED_DRAFT'] as const)('%s : effacement immédiat', (category) => {
    const decision = evaluateCndpErasureAgainstCgiArt211(record({ category, recordId: 'm-1' }), '2026-11-13');
    expect(decision.action).toBe('IMMEDIATE_HARD_DELETE');
    expect(decision.recordId).toBe('m-1');
    expect(decision.legalBasis).toBe('Loi 09-08 Art. 9 — Aucune obligation fiscale de conservation applicable.');
    expect(decision.piiRestrictedFlag).toBe(0);
    expect(decision.scheduledCryptoShredDateIso).toBeUndefined();
    expect(decision.retentionEndDateIso).toBeUndefined();
  });

  it.each(['POSTED_ACCOUNTING_OR_INVOICE', 'SIMPL_PAYROLL_9421_OR_DRVT'] as const)(
    '%s sous conservation : restriction, drapeau pii_restricted_flag = 1 et date de crypto-shredding',
    (category) => {
      const decision = evaluateCndpErasureAgainstCgiArt211(record({ category }), '2026-11-13');
      expect(decision.action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
      expect(decision.piiRestrictedFlag).toBe(1);
      expect(decision.retentionEndDateIso).toBe('2030-12-31');
      expect(decision.scheduledCryptoShredDateIso).toBe('2031-01-01');
      expect(decision.legalBasis).toBe(
        'Primauté légale Art. 211 & 145-I CGI (conservation probante 10 ans) — Restriction d\'accès appliquée.',
      );
    },
  );

  it('cas limite : le jour exact de fin de conservation reste restreint, le lendemain est effaçable', () => {
    const dernierJour = evaluateCndpErasureAgainstCgiArt211(record(), '2030-12-31');
    expect(dernierJour.action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
    const lendemain = evaluateCndpErasureAgainstCgiArt211(record(), '2031-01-01');
    expect(lendemain.action).toBe('IMMEDIATE_HARD_DELETE');
    expect(lendemain.legalBasis).toBe('Expiration du délai décennal Art. 211 CGI — Destruction cryptographique autorisée.');
    expect(lendemain.piiRestrictedFlag).toBe(0);
    expect(evaluateCndpErasureAgainstCgiArt211(record(), '2030-12-30').action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
  });

  it('la date de fin ne dépend que de l’exercice clos, pas de l’horloge (déterminisme)', () => {
    const a = evaluateCndpErasureAgainstCgiArt211(record(), '2026-01-01');
    const b = evaluateCndpErasureAgainstCgiArt211(record(), '2029-06-15');
    expect(a.scheduledCryptoShredDateIso).toBe(b.scheduledCryptoShredDateIso);
    expect(evaluateCndpErasureAgainstCgiArt211(record(), '2026-01-01')).toEqual(a);
  });

  it('exercice clos en cours d’année : conservation jusqu’à la fin de l’année civile + 10 ans (référence Doc_11)', () => {
    const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: '2020-06-30' }), '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2030-12-31');
    expect(decision.scheduledCryptoShredDateIso).toBe('2031-01-01');
  });

  it('sans date de clôture, l’année de l’horloge sert de base', () => {
    const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: undefined }), '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2036-12-31');
    expect(decision.scheduledCryptoShredDateIso).toBe('2037-01-01');
  });

  it('refuse une date malformée ou impossible (DsarInputError), sans deviner', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '13/11/2026', '', '2026-1-1']) {
      expect(() => evaluateCndpErasureAgainstCgiArt211(record(), bad)).toThrow(DsarInputError);
      expect(() => evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: bad }), '2026-11-13')).toThrow(DsarInputError);
    }
  });

  it('deny-by-default : une catégorie inconnue n’est jamais effacée', () => {
    const unknown = record({ category: 'AUTRE' as unknown as SubjectRecordDescriptor['category'] });
    expect(() => evaluateCndpErasureAgainstCgiArt211(unknown, '2026-11-13')).toThrow(DsarInputError);
  });
});

describe('evaluateCndpErasureRequest : demande d’effacement partielle', () => {
  it('sépare ce qui est effacé de ce qui est restreint, dans l’ordre des enregistrements', () => {
    const records: SubjectRecordDescriptor[] = [
      record({ recordId: 'a', category: 'MARKETING_OR_PREFERENCE', tableName: 'marketing_prefs', fiscalYearClosedDateIso: undefined }),
      record({ recordId: 'b' }),
      record({ recordId: 'c', category: 'UNNUMBERED_DRAFT', tableName: 'drafts', fiscalYearClosedDateIso: undefined }),
      record({ recordId: 'd', category: 'SIMPL_PAYROLL_9421_OR_DRVT', fiscalYearClosedDateIso: '2015-12-31' }),
    ];
    const result = evaluateCndpErasureRequest(records, '2026-11-13');
    expect(result.decisions.map((d) => d.recordId)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.erasableRecordIds).toEqual(['a', 'c', 'd']);
    expect(result.restrictedRecordIds).toEqual(['b']);
    expect(result.outcome).toBe('PARTIAL_ERASURE');
    expect(result.nextCryptoShredDateIso).toBe('2031-01-01');
  });

  it('effacement total, restriction totale et demande vide', () => {
    expect(evaluateCndpErasureRequest([record({ category: 'UNNUMBERED_DRAFT' })], '2026-11-13').outcome).toBe('FULL_ERASURE');
    const restricted = evaluateCndpErasureRequest([record(), record({ recordId: 'r2', fiscalYearClosedDateIso: '2022-12-31' })], '2026-11-13');
    expect(restricted.outcome).toBe('FULL_RESTRICTION');
    expect(restricted.nextCryptoShredDateIso).toBe('2031-01-01');
    const empty = evaluateCndpErasureRequest([], '2026-11-13');
    expect(empty.outcome).toBe('NOTHING_TO_PROCESS');
    expect(empty.nextCryptoShredDateIso).toBeNull();
  });
});

describe('vecteurs d’or DSAR (tests/golden/dsar-art211.vectors.json)', () => {
  it('reproduisent les décisions attendues', () => {
    const { vectors } = goldenVectors;
    expect(vectors.length).toBeGreaterThanOrEqual(3);
    for (const vector of vectors) {
      const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: vector.closed }), vector.now);
      expect(decision.action).toBe(vector.expected);
      expect(decision.retentionEndDateIso ?? null).toBe(vector.retentionEnd);
      expect(decision.scheduledCryptoShredDateIso ?? null).toBe(vector.shred);
    }
  });
});
