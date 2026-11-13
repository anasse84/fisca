export const PACKAGE_NAME = '@fisca/compliance-cndp' as const;

export {
  HOSTILE_SCORE_THRESHOLD,
  MAX_INJECTION_SCORE,
  SPOTLIGHT_DELIMITER_NAME,
  sanitizeUntrustedText,
  spotlightUntrusted,
} from './prompt-injection-filter.ts';
export type {
  InjectionSignal,
  InjectionSignalCategory,
  InjectionSignalCode,
  InjectionVerdict,
  SanitizationResult,
  SpotlightMode,
  SpotlightOptions,
  SpotlightedContent,
} from './prompt-injection-filter.ts';
