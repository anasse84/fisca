import { describe, expect, it } from 'vitest';
import {
  ConversionError,
  ConversionTracker,
  buildConversionUrl,
  countsInB2cBase,
  expectedConversionState,
  parseConversionQrPayload,
  resolveConversionView,
} from '../src/b2b/qr-conversion.ts';

describe('ticket QR B2B : URL construite depuis une base injectée', () => {
  it('base + jeton encodé en dernier segment ; aucune route de caisse', () => {
    expect(buildConversionUrl('https://b2b.test/convert', 'qr-token-1')).toBe('https://b2b.test/convert/qr-token-1');
    expect(buildConversionUrl('https://b2b.test/convert/', 'qr token/é')).toBe('https://b2b.test/convert/qr%20token%2F%C3%A9');
  });

  it('refuse une base vide ou non absolue, et un jeton vide', () => {
    expect(() => buildConversionUrl('', 't')).toThrow();
    expect(() => buildConversionUrl('/relatif', 't')).toThrow();
    expect(() => buildConversionUrl('https://b2b.test', '')).toThrow();
  });

  it('parseConversionQrPayload : retrouve le jeton depuis l’URL', () => {
    const url = buildConversionUrl('https://b2b.test/convert', 'abc-123');
    expect(parseConversionQrPayload(url, 'https://b2b.test/convert')).toBe('abc-123');
    expect(parseConversionQrPayload('https://autre.test/x/abc', 'https://b2b.test/convert')).toBeNull();
  });
});

describe('état local de conversion sans double imposition', () => {
  it('seul un ticket NONE propose le QR', () => {
    expect(resolveConversionView('NONE')).toMatchObject({ canShowQr: true, countsInB2cBase: true });
    expect(resolveConversionView('CONVERTI_B2B_AVANT_Z')).toMatchObject({ canShowQr: false, countsInB2cBase: false });
    expect(resolveConversionView('CONVERTI_B2B_POST_Z_NEUTRALISE')).toMatchObject({ canShowQr: false, countsInB2cBase: false });
  });

  it('assiette B2C : un ticket converti (avant Z) ou neutralisé (après Z) n’est jamais compté deux fois', () => {
    expect(countsInB2cBase('NONE')).toBe(true);
    expect(countsInB2cBase('CONVERTI_B2B_AVANT_Z')).toBe(false);
    expect(countsInB2cBase('CONVERTI_B2B_POST_Z_NEUTRALISE')).toBe(false);
  });

  it('l’état attendu dépend de la clôture Z', () => {
    expect(expectedConversionState(false)).toBe('CONVERTI_B2B_AVANT_Z');
    expect(expectedConversionState(true)).toBe('CONVERTI_B2B_POST_Z_NEUTRALISE');
  });

  it('transition NONE → converti acceptée si elle respecte la clôture Z ; un second avis est rejeté (UNIQUE pos_ticket_id)', () => {
    const tracker = new ConversionTracker([{ ticketId: 't1', state: 'NONE' }]);
    tracker.apply({ ticketId: 't1', newState: 'CONVERTI_B2B_AVANT_Z', zClosed: false });
    expect(tracker.view('t1').canShowQr).toBe(false);
    expect(() => tracker.apply({ ticketId: 't1', newState: 'CONVERTI_B2B_AVANT_Z', zClosed: false })).toThrowError(ConversionError);
    try {
      tracker.apply({ ticketId: 't1', newState: 'CONVERTI_B2B_POST_Z_NEUTRALISE', zClosed: true });
    } catch (error) {
      expect((error as ConversionError).code).toBe('ALREADY_CONVERTED');
    }
  });

  it('avis incohérent avec la clôture Z : rejeté, l’état local ne change pas', () => {
    const tracker = new ConversionTracker([{ ticketId: 't1', state: 'NONE' }]);
    expect(() => tracker.apply({ ticketId: 't1', newState: 'CONVERTI_B2B_POST_Z_NEUTRALISE', zClosed: false })).toThrowError(/INCONSISTENT/);
    expect(tracker.view('t1').state).toBe('NONE');
  });

  it('ticket inconnu : UNKNOWN_TICKET ; notification aux observateurs', () => {
    const tracker = new ConversionTracker([{ ticketId: 't1', state: 'NONE' }]);
    expect(() => tracker.view('zz')).toThrowError(ConversionError);
    let calls = 0;
    tracker.subscribe(() => { calls += 1; });
    tracker.apply({ ticketId: 't1', newState: 'CONVERTI_B2B_POST_Z_NEUTRALISE', zClosed: true });
    expect(calls).toBe(1);
  });
});
