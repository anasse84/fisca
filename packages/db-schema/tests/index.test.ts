import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import * as controlPlane from '../src/control-plane.ts';
import * as drizzleSchema from '../src/control-plane-drizzle.ts';

describe('@fisca/db-schema', () => {
  it('exporte son nom de paquet', () => {
    expect(pkg.PACKAGE_NAME).toBe('@fisca/db-schema');
  });

  it('index.ts réexporte tout le DDL du plan de contrôle et le schéma Drizzle', () => {
    for (const key of Object.keys(controlPlane)) {
      expect(Object.keys(pkg), key).toContain(key);
    }
    for (const key of Object.keys(drizzleSchema)) {
      expect(Object.keys(pkg), key).toContain(key);
    }
  });
});
