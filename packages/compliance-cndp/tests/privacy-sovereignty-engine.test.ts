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

const EU_MEMBER_STATES_ISO2 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

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

describe('CNDP_ADEQUATE_ISO2 : 27 États membres de l’UE + Maroc (Doc_11 § 03)', () => {
  it('contient exactement les 27 États membres et MA', () => {
    expect(EU_MEMBER_STATES_ISO2).toHaveLength(27);
    expect(new Set(EU_MEMBER_STATES_ISO2).size).toBe(27);
    expect(CNDP_ADEQUATE_ISO2.size).toBe(28);
    for (const iso2 of EU_MEMBER_STATES_ISO2) {
      expect(CNDP_ADEQUATE_ISO2.has(iso2)).toBe(true);
    }
    expect(CNDP_ADEQUATE_ISO2.has('MA')).toBe(true);
  });

  it.each(['PL', 'GR', 'RO'])('%s (absent de l’ancienne liste de 14) est admis en mode standard sans F118', (iso2) => {
    expect(() => assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: iso2 }))).not.toThrow();
  });

  it.each(['US', 'CN', 'RU'])('%s est refusé sans autorisation F118, admis avec', (iso2) => {
    const error = catchError(() => assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: iso2 })));
    expect(error).toBeInstanceOf(SovereignEgressError);
    expect((error as SovereignEgressError).code).toBe('CNDP_ART_43_44_TRANSFER_BLOCKED');
    expect(() =>
      assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: iso2, hasCndpF118Authorization: true })),
    ).not.toThrow();
  });

  it('échec fermé : code inconnu, minuscule, espacé ou mal formé refusé sans F118', () => {
    for (const iso2 of ['XX', 'ZZ', 'fr', 'Fr', ' FR', 'FR ', 'FRA', 'F', '', 'EL', 'UK']) {
      const error = catchError(() => assertSovereignEgressAllowed(STANDARD, target({ destinationCountryIso2: iso2 })));
      expect(error).toBeInstanceOf(SovereignEgressError);
      expect((error as SovereignEgressError).code).toBe('CNDP_ART_43_44_TRANSFER_BLOCKED');
    }
  });

  it('le mode souverain n’admet toujours que MA, y compris pour les nouveaux États adéquats', () => {
    for (const iso2 of ['PL', 'GR', 'RO', 'FR', 'US']) {
      expect(() => assertSovereignEgressAllowed(STRICT, target({ destinationCountryIso2: iso2 }))).toThrow(SovereignEgressError);
    }
    expect(() => assertSovereignEgressAllowed(STRICT, target({ destinationCountryIso2: 'MA' }))).not.toThrow();
  });
});

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

  it('cas limite : le jour du dixième anniversaire de la clôture reste restreint, le lendemain est effaçable', () => {
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

  it('exercice clos le 30 juin : échéance = clôture + 10 ans (30 juin), destruction dès le 1er juillet suivant', () => {
    const closed = record({ fiscalYearClosedDateIso: '2020-06-30' });
    const decision = evaluateCndpErasureAgainstCgiArt211(closed, '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2030-06-30');
    expect(decision.scheduledCryptoShredDateIso).toBe('2030-07-01');
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-06-30').action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-07-01').action).toBe('IMMEDIATE_HARD_DELETE');
    // L'ancienne règle (fin d'année civile) maintenait la restriction jusqu'au 31 décembre 2030 : fausse.
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-12-31').action).toBe('IMMEDIATE_HARD_DELETE');
  });

  it('exercice clos le 31 décembre : veille restreinte, 31 décembre restreint, 1er janvier de l’année +11 effaçable', () => {
    const closed = record({ fiscalYearClosedDateIso: '2019-12-31' });
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2029-12-30').action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
    const anniversaire = evaluateCndpErasureAgainstCgiArt211(closed, '2029-12-31');
    expect(anniversaire.action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
    expect(anniversaire.retentionEndDateIso).toBe('2029-12-31');
    expect(anniversaire.scheduledCryptoShredDateIso).toBe('2030-01-01');
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-01-01').action).toBe('IMMEDIATE_HARD_DELETE');
  });

  it('exercice clos le 29 février : règle déterministe, 28 février de l’année cible puis +1 jour', () => {
    const closed = record({ fiscalYearClosedDateIso: '2020-02-29' });
    const decision = evaluateCndpErasureAgainstCgiArt211(closed, '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2030-02-28');
    expect(decision.scheduledCryptoShredDateIso).toBe('2030-03-01');
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-02-28').action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
    expect(evaluateCndpErasureAgainstCgiArt211(closed, '2030-03-01').action).toBe('IMMEDIATE_HARD_DELETE');
    const autre = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: '2096-02-29' }), '2100-01-01');
    expect(autre.retentionEndDateIso).toBe('2106-02-28');
    expect(autre.scheduledCryptoShredDateIso).toBe('2106-03-01');
  });

  it('clôture le 28 février d’une année non bissextile : pas de débordement, +1 jour = 1er mars', () => {
    const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: '2021-02-28' }), '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2031-02-28');
    expect(decision.scheduledCryptoShredDateIso).toBe('2031-03-01');
  });

  it('échéance du 29 février : clôture le 28 février d’une année bissextile cible (+1 jour = 29 février)', () => {
    const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: '2018-02-28' }), '2026-11-13');
    expect(decision.retentionEndDateIso).toBe('2028-02-28');
    expect(decision.scheduledCryptoShredDateIso).toBe('2028-02-29');
  });

  it('échec fermé : sans date de clôture, restriction sans échéance, jamais de suppression', () => {
    for (const now of ['2026-11-13', '2099-12-31']) {
      const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: undefined }), now);
      expect(decision.action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
      expect(decision.piiRestrictedFlag).toBe(1);
      expect(decision.retentionEndDateIso).toBeUndefined();
      expect(decision.scheduledCryptoShredDateIso).toBeUndefined();
    }
  });

  it('échec fermé : date de clôture invalide ou impossible, restriction sans échéance', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2021-02-29', '13/11/2026', '', '2026-1-1', '2020-12-31T00:00:00Z', '0000-01-01', '9999-12-31']) {
      const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: bad }), '2099-12-31');
      expect(decision.action).toBe('RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
      expect(decision.piiRestrictedFlag).toBe(1);
      expect(decision.retentionEndDateIso).toBeUndefined();
      expect(decision.scheduledCryptoShredDateIso).toBeUndefined();
    }
  });

  it('refuse une horloge malformée ou impossible (DsarInputError), sans deviner', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '13/11/2026', '', '2026-1-1']) {
      expect(() => evaluateCndpErasureAgainstCgiArt211(record(), bad)).toThrow(DsarInputError);
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

  it('une clôture manquante rend l’enregistrement restreint sans date de shredding dans la demande', () => {
    const result = evaluateCndpErasureRequest([record({ recordId: 'x', fiscalYearClosedDateIso: undefined })], '2099-01-01');
    expect(result.outcome).toBe('FULL_RESTRICTION');
    expect(result.restrictedRecordIds).toEqual(['x']);
    expect(result.nextCryptoShredDateIso).toBeNull();
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
      const decision = evaluateCndpErasureAgainstCgiArt211(record({ fiscalYearClosedDateIso: vector.closed ?? undefined }), vector.now);
      expect(decision.action).toBe(vector.expected);
      expect(decision.retentionEndDateIso ?? null).toBe(vector.retentionEnd);
      expect(decision.scheduledCryptoShredDateIso ?? null).toBe(vector.shred);
    }
  });
});
