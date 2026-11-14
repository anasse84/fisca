import { describe, expect, it } from 'vitest';
import {
  formatInvoiceNumber,
  INVOICE_NUMBER_PREFIX_BY_TYPE,
  isValidInvoiceNumber,
  parseInvoiceNumber,
} from '../src/index.ts';

describe('numéro de facture {FAC|AVO|NDB|ACO|AUT}-{YYYY}-{SEQ6}', () => {
  it('associe chaque préfixe à son code de type', () => {
    expect(INVOICE_NUMBER_PREFIX_BY_TYPE).toEqual({ '380': 'FAC', '381': 'AVO', '383': 'NDB', '386': 'ACO', '389': 'AUT' });
  });

  it('accepte les formats valides et en extrait les parties', () => {
    expect(isValidInvoiceNumber('FAC-2026-000001')).toBe(true);
    expect(parseInvoiceNumber('AUT-2027-123456')).toEqual({ prefix: 'AUT', typeCode: '389', year: 2027, sequence: 123456 });
  });

  it.each([
    'FAC-2026-00001',
    'FAC-2026-0000001',
    'fac-2026-000001',
    'ZZZ-2026-000001',
    'FAC-26-000001',
    'FAC-2026-000000',
    'FAC-2026-00000A',
    ' FAC-2026-000001',
    'FAC-2026-000001\n',
    '',
  ])('rejette %j', (value) => {
    expect(isValidInvoiceNumber(value)).toBe(false);
    expect(parseInvoiceNumber(value)).toBeUndefined();
  });

  it('formate un numéro à partir du type, de l’année et du compteur', () => {
    expect(formatInvoiceNumber('381', 2026, 42)).toBe('AVO-2026-000042');
    expect(() => formatInvoiceNumber('381', 2026, 0)).toThrow();
    expect(() => formatInvoiceNumber('381', 2026, 1000000)).toThrow();
    expect(() => formatInvoiceNumber('381', 26, 1)).toThrow();
  });
});
