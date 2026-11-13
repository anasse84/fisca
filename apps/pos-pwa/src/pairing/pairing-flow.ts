import { sha256Hex } from '../storage/migrations.ts';
import type { PosStorage } from '../storage/ports.ts';

/**
 * Appairage d'un terminal de caisse : saisie d'un code d'appairage à usage unique, échange avec le serveur par un port
 * injectable, puis stockage local de l'identité du terminal et initialisation du séquenceur de tickets.
 *
 * Le registre des contrats (fisca_contracts_registry) ne contient AUCUNE route d'appairage de terminal : la route est
 * volontairement absente de ce module. `PairingGateway` est le point d'injection ; l'implémentation HTTP s'écrira quand
 * la route sera inscrite au registre.
 */

/** Contrôle de saisie côté client (caractères autorisés et longueur) ; la validité réelle du code est jugée par le serveur. */
export const PAIRING_CODE_PATTERN = /^[A-Z0-9]{8,32}$/;
/** Codes magasin et terminal : alphanumériques majuscules, sans tiret (le numéro de ticket se découpe sur « - »). */
const IDENTIFIER_PATTERN = /^[A-Z0-9]+$/;

export type NormalizedPairingCode = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly reason: 'EMPTY' | 'INVALID_FORMAT' };

export function normalizePairingCode(raw: string): NormalizedPairingCode {
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (code.length === 0) return { ok: false, reason: 'EMPTY' };
  if (!PAIRING_CODE_PATTERN.test(code)) return { ok: false, reason: 'INVALID_FORMAT' };
  return { ok: true, code };
}

export interface TicketNumberParts {
  readonly storeCode: string;
  readonly terminalCode: string;
  readonly year: number;
  readonly sequence: number;
}

/** `POS-{MAG}-{TERM}-{AAAA}-{séquence sur 6 chiffres}` (skill fisca-pos-offline-sce § 1). */
export function formatTicketNumber(parts: TicketNumberParts): string {
  if (!Number.isSafeInteger(parts.sequence) || parts.sequence < 1) {
    throw new Error(`Séquence de ticket invalide : ${parts.sequence}.`);
  }
  if (!Number.isInteger(parts.year) || parts.year < 1000 || parts.year > 9999) {
    throw new Error(`Année de ticket invalide : ${parts.year}.`);
  }
  return `POS-${parts.storeCode}-${parts.terminalCode}-${parts.year}-${String(parts.sequence).padStart(6, '0')}`;
}

export interface PairingRequest {
  readonly pairingCode: string;
  readonly deviceFingerprint: string;
}

export interface PairedTerminalPayload {
  readonly terminalId: string;
  readonly storeCode: string;
  readonly terminalCode: string;
  /** Dernière séquence déjà émise par ce terminal côté serveur (0 pour un terminal neuf). */
  readonly lastIssuedSequence: number;
}

export type PairingGatewayResult =
  | { readonly ok: true; readonly terminal: PairedTerminalPayload }
  | { readonly ok: false; readonly reason: 'INVALID_CODE' | 'CODE_ALREADY_USED' | 'CODE_EXPIRED' };

export interface PairingGateway {
  /** Échange le code contre l'identité du terminal. Lève une erreur réseau si le serveur est injoignable. */
  redeemPairingCode(request: PairingRequest): Promise<PairingGatewayResult>;
}

export interface TerminalIdentity {
  readonly terminalId: string;
  readonly storeCode: string;
  readonly terminalCode: string;
  readonly deviceFingerprint: string;
  readonly pairedAt: string;
}

export type PairingRefusal =
  | 'EMPTY'
  | 'INVALID_FORMAT'
  | 'ALREADY_PAIRED'
  | 'CODE_REUSED_LOCALLY'
  | 'GATEWAY_UNREACHABLE'
  | 'RESPONSE_INVALID'
  | 'INVALID_CODE'
  | 'CODE_ALREADY_USED'
  | 'CODE_EXPIRED';

export type PairingOutcome =
  | { readonly status: 'PAIRED'; readonly identity: TerminalIdentity }
  | { readonly status: 'REFUSED'; readonly reason: PairingRefusal };

export async function loadTerminalIdentity(storage: PosStorage): Promise<TerminalIdentity | null> {
  const rows = await storage.all('SELECT terminal_id, store_code, terminal_code, device_fingerprint, paired_at FROM pos_terminal_identity WHERE id = 1');
  const row = rows[0];
  if (row === undefined) return null;
  return {
    terminalId: String(row['terminal_id']),
    storeCode: String(row['store_code']),
    terminalCode: String(row['terminal_code']),
    deviceFingerprint: String(row['device_fingerprint']),
    pairedAt: String(row['paired_at']),
  };
}

function isValidPayload(payload: PairedTerminalPayload): boolean {
  return (
    payload.terminalId.length > 0 &&
    IDENTIFIER_PATTERN.test(payload.storeCode) &&
    IDENTIFIER_PATTERN.test(payload.terminalCode) &&
    Number.isSafeInteger(payload.lastIssuedSequence) &&
    payload.lastIssuedSequence >= 0
  );
}

export interface PairTerminalInput {
  readonly storage: PosStorage;
  readonly gateway: PairingGateway;
  readonly rawCode: string;
  readonly deviceFingerprint: string;
  readonly nowIso: string;
}

/**
 * Flux complet. Le code d'appairage n'est jamais stocké en clair : seule son empreinte SHA-256 sert à refuser
 * localement un code déjà consommé (usage unique). Un code refusé comme invalide ou expiré reste ressaisissable ;
 * une panne réseau ne consomme rien.
 */
export async function pairTerminal(input: PairTerminalInput): Promise<PairingOutcome> {
  const normalized = normalizePairingCode(input.rawCode);
  if (!normalized.ok) return { status: 'REFUSED', reason: normalized.reason };
  const { storage, gateway, nowIso } = input;

  if ((await loadTerminalIdentity(storage)) !== null) return { status: 'REFUSED', reason: 'ALREADY_PAIRED' };

  const codeHash = await sha256Hex(normalized.code);
  const known = await storage.all('SELECT outcome FROM pos_pairing_attempts WHERE code_sha256 = ?', [codeHash]);
  if (known.length > 0) return { status: 'REFUSED', reason: 'CODE_REUSED_LOCALLY' };

  let result: PairingGatewayResult;
  try {
    result = await gateway.redeemPairingCode({ pairingCode: normalized.code, deviceFingerprint: input.deviceFingerprint });
  } catch {
    return { status: 'REFUSED', reason: 'GATEWAY_UNREACHABLE' };
  }

  if (!result.ok) {
    if (result.reason === 'CODE_ALREADY_USED') {
      await storage.run('INSERT INTO pos_pairing_attempts (code_sha256, outcome, attempted_at) VALUES (?, ?, ?)', [codeHash, 'CODE_ALREADY_USED', nowIso]);
    }
    return { status: 'REFUSED', reason: result.reason };
  }

  const terminal = result.terminal;
  if (!isValidPayload(terminal)) return { status: 'REFUSED', reason: 'RESPONSE_INVALID' };

  await storage.batch([
    {
      sql: 'INSERT INTO pos_terminal_identity (id, terminal_id, store_code, terminal_code, device_fingerprint, paired_at) VALUES (1, ?, ?, ?, ?, ?)',
      params: [terminal.terminalId, terminal.storeCode, terminal.terminalCode, input.deviceFingerprint, nowIso],
    },
    { sql: 'INSERT INTO pos_sequence_counters (terminal_id, last_issued_seq) VALUES (?, ?)', params: [terminal.terminalId, terminal.lastIssuedSequence] },
    { sql: 'INSERT INTO pos_pairing_attempts (code_sha256, outcome, attempted_at) VALUES (?, ?, ?)', params: [codeHash, 'PAIRED', nowIso] },
    {
      sql: 'INSERT INTO pos_sync_state (id, last_sync_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at',
      params: [nowIso],
    },
  ]);

  return {
    status: 'PAIRED',
    identity: {
      terminalId: terminal.terminalId,
      storeCode: terminal.storeCode,
      terminalCode: terminal.terminalCode,
      deviceFingerprint: input.deviceFingerprint,
      pairedAt: nowIso,
    },
  };
}
