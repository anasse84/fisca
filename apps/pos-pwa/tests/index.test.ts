import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.ts';

describe('@fisca/pos-pwa', () => {
  it('exporte son nom de paquet', () => {
    expect(PACKAGE_NAME).toBe('@fisca/pos-pwa');
  });
});
