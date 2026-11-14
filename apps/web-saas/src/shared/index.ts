export { FiscaAiCrafterCard, FiscaCommandPalette, FiscaReviewDrawer, resolveAiCrafterCardLabels, resolveCommandReviewLabels, translateStrict } from './command-review.tsx';
export type {
  CommandReviewLabels,
  FiscaAiCrafterCardProps,
  FiscaCommandPaletteProps,
  FiscaReviewDrawerProps,
  TranslateStrict,
} from './command-review.tsx';
export { FiscaClearedBadge } from './status-badge.tsx';
export type { FiscaClearedBadgeProps } from './status-badge.tsx';
export { AuthFlow, detectPasskeyCredentials } from './auth/AuthFlow.tsx';
export type { AuthFlowProps, AuthenticatedSession } from './auth/AuthFlow.tsx';
export { IceOnboarding } from './auth/IceOnboarding.tsx';
export type { IceOnboardingProps } from './auth/IceOnboarding.tsx';
export { createAuthApi } from './auth/api-client.ts';
export type { ApiProblem, ApiResult, AuthApi, AuthApiOptions, FetchLike, IceDossier, LoginOutcome, SecondFactorMethod, SessionTokens } from './auth/api-client.ts';
export { authFlowReducer, initialAuthFlow } from './auth/auth-flow-machine.ts';
export type { AuthFlowEvent, AuthFlowState, AuthStep } from './auth/auth-flow-machine.ts';
export { ICE_ONBOARDING_BUDGET_MS, elapsedMs, iceOnboardingReducer, initialIceOnboarding, isOverBudget } from './auth/ice-onboarding-machine.ts';
export type { IceOnboardingEvent, IceOnboardingState } from './auth/ice-onboarding-machine.ts';
export { assessPasswordStrength } from './auth/password-strength.ts';
export { isIceShapeValid, normalizeIceInput } from './auth/ice.ts';
export { authenticateWithPasskey } from './auth/passkey.ts';
export type { CredentialsLike, PasskeyOutcome } from './auth/passkey.ts';
export { AUTH_LABEL_KEYS, resolveAuthLabels } from './auth/labels.ts';
