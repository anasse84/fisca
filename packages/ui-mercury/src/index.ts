export const PACKAGE_NAME = '@fisca/ui-mercury' as const;
export { contrastRatio, parseHexColor, relativeLuminance } from './contrast.ts';
export type { Rgb } from './contrast.ts';
export { ALLOW_PHYSICAL_MARKER, lintLogicalCss } from './logical-css-lint.ts';
export type { LogicalCssViolation } from './logical-css-lint.ts';
export {
  DENSITY_TOKENS,
  SEMANTIC_TOKEN_NAMES,
  THEME_TOKENS,
  parseTokenDeclarations,
} from './tokens.ts';
export type { SemanticTokenName, ThemeName, ThemeTokens } from './tokens.ts';
export { formatCentimesMad } from './format-centimes.ts';
export { FiscalAmount, FiscalStatusBadge, FiscalTerm } from './FiscalPrimitives.tsx';
export type { FiscaLocale, FiscalAmountProps, FiscalStatus, FiscalStatusBadgeProps, FiscalTermProps } from './FiscalPrimitives.tsx';
export { AiCrafterAmountField, AiCrafterCard, AiCrafterConfidence } from './AiCrafterCards.tsx';
export type { AiCrafterAmountFieldProps, AiCrafterCardProps, AiCrafterConfidenceProps, AiCrafterDecision } from './AiCrafterCards.tsx';
