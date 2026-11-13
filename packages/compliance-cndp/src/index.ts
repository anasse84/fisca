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

export {
  CGI_ART_211_RETENTION_YEARS,
  CNDP_ADEQUATE_ISO2,
  DsarInputError,
  SOVEREIGNTY_POLICIES,
  SUBJECT_RECORD_CATEGORIES,
  SovereignEgressError,
  assertSovereignEgressAllowed,
  evaluateCndpErasureAgainstCgiArt211,
  evaluateCndpErasureRequest,
} from './privacy-sovereignty-engine.ts';
export type {
  DsarErasureAction,
  DsarErasureDecision,
  DsarErasureRequestResult,
  DsarRequestOutcome,
  OutboundServiceTarget,
  SovereignEgressErrorCode,
  SovereigntyPolicy,
  SubjectRecordCategory,
  SubjectRecordDescriptor,
} from './privacy-sovereignty-engine.ts';
