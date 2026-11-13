import { describe, expect, it } from 'vitest';
import { KNOWN_PHIVE_DEVIATIONS, KNOWN_PHIVE_DEVIATION_RULE_IDS } from '../src/index.ts';

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
