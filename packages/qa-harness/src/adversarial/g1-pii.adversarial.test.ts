import { describe, expect, it } from 'vitest';
import { EphemeralRamPiiScrubber } from '../../../crypto-e2ee/src/index.ts';

/** Tests adverses de l'auditeur, barrière G1 : zéro fuite d'un ICE (15 chiffres) quelle que soit sa mise en forme (Doc_10, ERRATA D-12, R2-C5). */
describe('G1 adverse — anonymiseur : ICE mis en forme', () => {
  const forms = ['001234567000089', '0012 3456 7000 089', '001 234 567 000 089', '001234567 000089', '001-234-567-000-089', '001.234.567.000.089'];
  for (const ice of forms) {
    it(`masque l'ICE « ${ice} »`, () => {
      const out = new EphemeralRamPiiScrubber().scrubText(`ICE ${ice} du client`, []);
      const leftover = (out.replace(/\[[A-Za-z0-9_]+\]/g, '').match(/\d/g) ?? []).length;
      expect(leftover, `chiffres restants : ${out}`).toBeLessThan(6);
    });
  }
});
