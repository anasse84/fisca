import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, routeManifest } from '../src/index.ts';

describe('@fisca/api-hono', () => {
  it('exporte son nom de paquet', () => {
    expect(PACKAGE_NAME).toBe('@fisca/api-hono');
  });

  it('expose le manifeste de routes généré', () => {
    expect(Array.isArray(routeManifest)).toBe(true);
  });
});
