export const PACKAGE_NAME = '@fisca/pos-pwa' as const;

export {
  CLOCK_SKEW_TOLERANCE_MS,
  OFFLINE_WINDOW_HOURS,
  OFFLINE_WINDOW_MS,
  OfflineSalesRefusedError,
  assertSalesAllowed,
  evaluateOfflineWindow,
  splitCountdown,
} from './offline/offline-window.ts';
export type { Countdown, OfflineWindowInput, OfflineWindowState, OfflineWindowStatus } from './offline/offline-window.ts';
export { createConnectivityMonitor } from './offline/connectivity.ts';
export type { ConnectivityTarget } from './offline/connectivity.ts';
export { buildOfflineIndicatorModel, mountOfflineIndicator } from './offline/offline-indicator.ts';
export type { IndicatorInput, IndicatorLabels, IndicatorPart, IndicatorTarget, IndicatorTone, OfflineIndicatorModel } from './offline/offline-indicator.ts';
export { loadSyncSnapshot, markSynced, markTicketsSynced } from './offline/sync-state.ts';
export type { SyncSnapshot } from './offline/sync-state.ts';

export {
  API_PATH_PREFIX,
  CACHED_AT_HEADER,
  SW_CACHE_PREFIX,
  buildCacheNames,
  decideCacheStrategy,
  isCacheEntryExpired,
  isCacheableResponse,
  planCacheCleanup,
} from './sw/cache-policy.ts';
export type { CacheNames, CacheStrategy, PolicyContext, RequestFacts } from './sw/cache-policy.ts';
export { handleActivate, handleFetch, handleInstall, installServiceWorker } from './sw/sw-runtime.ts';
export type { FetchOutcome, SwConfig, SwDeps, SwScope } from './sw/sw-runtime.ts';
export { buildServiceWorkerUrl, registerPosServiceWorker } from './sw/register.ts';
export type { RegisterOptions, RegisterResult, ServiceWorkerContainerLike } from './sw/register.ts';

export type { PosStorage, SqlRow, SqlStatement, SqlValue } from './storage/ports.ts';
export { createMemoryStorage } from './storage/memory-storage.ts';
export { OPFS_DB_FILENAME, OPFS_SAHPOOL_DIRECTORY, OpfsUnavailableError, openOpfsStorage } from './storage/opfs-sahpool-storage.ts';
export { createRpcClient, serveStorage } from './storage/rpc.ts';
export { connectOpfsWorker } from './storage/opfs-client.ts';
export { LOCAL_MIGRATIONS, LocalMigrationError, runLocalMigrations } from './storage/migrations.ts';

export { PAIRING_CODE_PATTERN, formatTicketNumber, loadTerminalIdentity, normalizePairingCode, pairTerminal } from './pairing/pairing-flow.ts';
export type { PairingGateway, PairingGatewayResult, PairingOutcome, PairingRefusal, TerminalIdentity } from './pairing/pairing-flow.ts';
export { assertCounterAt, buildConsumeStatements, consumeTicketNumber, reserveNextTicketNumber } from './pairing/ticket-sequencer.ts';
export type { TicketReservation } from './pairing/ticket-sequencer.ts';
export { listPairedPeripherals, pairPeripheral } from './pairing/peripherals.ts';
export type { PeripheralConnection, PeripheralDescriptor, PeripheralKind, PeripheralTransport } from './pairing/peripherals.ts';

export { POS_CHAIN_GENESIS, POS_TICKET_LABEL, buildTicketTuple, canonicalJsonTuple, computeTicketSha256, sha256HexOfText } from './ticketing/ticket-hash.ts';
export type { CanonicalValue, TicketHashFields } from './ticketing/ticket-hash.ts';
export { computeCashStampCents, resolveCashStampRule } from './ticketing/cash-stamp.ts';
export type { CashStampRule, CashStampRulePort } from './ticketing/cash-stamp.ts';
export {
  createIndexedDbSigningKeyStore,
  createMemorySigningKeyStore,
  exportPublicKeySpkiB64,
  generateSigningKeyPair,
  importPublicKeySpkiB64,
  loadOrCreateSigningKeyPair,
  signTicketHash,
  verifyTicketSignature,
} from './ticketing/ticket-signing.ts';
export type { SigningKeyStore } from './ticketing/ticket-signing.ts';
export { TicketIssuanceError, issueSignedTicket, sequenceFromTicketNumber, verifyTicketChain } from './ticketing/ticket-issuer.ts';
export type { ChainVerification, IssuedTicket, TicketInput, TicketIssuanceErrorCode, TicketIssuerDeps, TicketLinesInput, TicketPaymentsInput } from './ticketing/ticket-issuer.ts';
