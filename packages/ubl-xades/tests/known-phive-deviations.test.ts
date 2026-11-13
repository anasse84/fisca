import { describe, expect, it } from 'vitest';
import { KNOWN_PHIVE_DEVIATIONS, KNOWN_PHIVE_DEVIATION_RULE_IDS, KNOWN_PROFILE_LIMITATIONS } from '../src/index.ts';

describe('KNOWN_PHIVE_DEVIATIONS (profil provisoire, écarts PHIVE connus)', () => {
  it('contient exactement BR-CL-10, BR-CL-11, BR-CO-09 et BR-CL-24', () => {
    expect(KNOWN_PHIVE_DEVIATIONS.map((deviation) => deviation.ruleId)).toEqual(['BR-CL-10', 'BR-CL-11', 'BR-CO-09', 'BR-CL-24']);
    expect([...KNOWN_PHIVE_DEVIATION_RULE_IDS]).toEqual(['BR-CL-10', 'BR-CL-11', 'BR-CL-24', 'BR-CO-09']);
  });

  it('chaque écart porte une raison et une origine', () => {
    for (const deviation of KNOWN_PHIVE_DEVIATIONS) {
      expect(deviation.reason.length).toBeGreaterThan(20);
      expect(deviation.origin).toMatch(/T-P2A-0[23]/);
    }
  });
});

describe('KNOWN_PROFILE_LIMITATIONS (limites du profil de signature, hors règles PHIVE)', () => {
  it('liste exactement les quatre limites du correctif documentaire T-P2A-05', () => {
    expect(KNOWN_PROFILE_LIMITATIONS.map((limitation) => limitation.id)).toEqual([
      'SIGNING_CERTIFICATE_V2_REFUSED_BY_XSD',
      'SERIAL_NUMBER_OVER_24_DIGITS_REFUSED_BY_XMLLINT',
      'PADES_CLASSIC_XREF_ONLY',
      'RFC3161_PARTIAL_CHECK',
    ]);
  });

  it('aucune de ces limites n’est un écart PHIVE (listes disjointes) et chacune porte énoncé et comportement', () => {
    for (const limitation of KNOWN_PROFILE_LIMITATIONS) {
      expect(KNOWN_PHIVE_DEVIATION_RULE_IDS).not.toContain(limitation.id);
      expect(limitation.statement.length).toBeGreaterThan(30);
      expect(limitation.behavior.length).toBeGreaterThan(20);
      expect(`${limitation.statement}${limitation.behavior}`).not.toMatch(/conforme DGI|homologué|certifié/i);
    }
  });

  it('le contrôle RFC 3161 partiel dit ce qui n’est pas évalué et ne parle jamais d’horodatage qualifié', () => {
    const rfc = KNOWN_PROFILE_LIMITATIONS.find((limitation) => limitation.id === 'RFC3161_PARTIAL_CHECK');
    expect(rfc?.statement).toContain('signature de la TSA, chaîne de certification et révocation non évaluées');
    expect(rfc?.statement).not.toMatch(/horodatage qualifi/i);
  });
});
