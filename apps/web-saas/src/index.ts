export const PACKAGE_NAME = '@fisca/web-saas' as const;

export const SURFACE_NAMES = ['pme', 'fiduciary', 'enterprise', 'shared'] as const;

export type SurfaceName = (typeof SURFACE_NAMES)[number];

/** Les surfaces sont chargées à la demande : chaque dossier expose un index.ts. */
export const surfaceModules: Record<string, () => Promise<unknown>> = import.meta.glob(
  './{pme,fiduciary,enterprise,shared}/index.ts',
);

export function surfaceNameFromPath(modulePath: string): SurfaceName | undefined {
  const segment = modulePath.split('/')[1];
  return SURFACE_NAMES.find((name) => name === segment);
}
