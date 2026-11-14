export const SEMANTIC_TOKEN_NAMES = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-subtle',
  '--text-primary',
  '--text-secondary',
  '--line-border',
  '--brand-emerald',
  '--brand-indigo',
  '--status-cleared-bg',
  '--status-cleared-text',
  '--status-warning-bg',
  '--status-warning-text',
  '--status-danger-bg',
  '--status-danger-text',
] as const;

export type SemanticTokenName = (typeof SEMANTIC_TOKEN_NAMES)[number];
export type ThemeName = 'light' | 'dark';
export type ThemeTokens = Readonly<Record<SemanticTokenName, string>>;

export const THEME_TOKENS: Readonly<Record<ThemeName, ThemeTokens>> = {
  light: {
    '--bg-canvas': '#FAF9F5',
    '--bg-surface': '#FFFFFF',
    '--bg-subtle': '#F2EFE9',
    '--text-primary': '#141413',
    '--text-secondary': '#5C5A54',
    '--line-border': '#E4E1D8',
    '--brand-emerald': '#0F5338',
    '--brand-indigo': '#4F46E5',
    '--status-cleared-bg': '#E3F2E9',
    '--status-cleared-text': '#0B4F32',
    '--status-warning-bg': '#F8EEDB',
    '--status-warning-text': '#8A5300',
    '--status-danger-bg': '#FCE8E6',
    '--status-danger-text': '#A51D24',
  },
  dark: {
    '--bg-canvas': '#0B0E14',
    '--bg-surface': '#121722',
    '--bg-subtle': '#181F2E',
    '--text-primary': '#F3F4F6',
    '--text-secondary': '#9CA3AF',
    '--line-border': '#222B3A',
    '--brand-emerald': '#10B981',
    '--brand-indigo': '#6366F1',
    '--status-cleared-bg': '#092E20',
    '--status-cleared-text': '#34D399',
    '--status-warning-bg': '#2E210B',
    '--status-warning-text': '#FBBF24',
    '--status-danger-bg': '#311114',
    '--status-danger-text': '#F87171',
  },
};

export const DENSITY_TOKENS = { comfortable: '44px', compact: '28px' } as const;

/** Extrait les déclarations `--nom: valeur;` d'un corps de bloc CSS. */
export function parseTokenDeclarations(blockBody: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of blockBody.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return out;
}
