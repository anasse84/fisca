import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, SURFACE_NAMES, surfaceNameFromPath, surfaceModules } from '../src/index.ts';

describe('@fisca/web-saas', () => {
  it('exporte son nom de paquet', () => {
    expect(PACKAGE_NAME).toBe('@fisca/web-saas');
  });

  it('déclare les quatre surfaces chargées par import.meta.glob', () => {
    expect(SURFACE_NAMES).toEqual(['pme', 'fiduciary', 'enterprise', 'shared']);
    expect(typeof surfaceModules).toBe('object');
  });

  it('déduit le nom de surface depuis le chemin du module', () => {
    expect(surfaceNameFromPath('./fiduciary/index.ts')).toBe('fiduciary');
    expect(surfaceNameFromPath('./inconnue/index.ts')).toBeUndefined();
  });
});
