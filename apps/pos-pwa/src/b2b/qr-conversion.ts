/**
 * Ticket QR B2B. La caisse AFFICHE le QR et suit l'état local de conversion ; elle n'appelle jamais la route de conversion :
 * `POST /api/v1/public/pos-qr/:qrToken/convert-b2b` (CTR-API-17) est appelée par le client B2B depuis son propre appareil.
 *
 * Contenu du QR : une URL construite sur une base injectée, dont le dernier segment est le `qr_conversion_token` du ticket local
 * (jeton aussi affiché en clair). Sans double imposition : un ticket converti (avant Z) sort de l'assiette B2C ; converti après Z,
 * il est neutralisé par l'extourne côté serveur ; dans les deux cas il ne compte jamais deux fois et ne propose plus de QR
 * (UNIQUE(pos_ticket_id) côté facture).
 */

export type B2bConversionState = 'NONE' | 'CONVERTI_B2B_AVANT_Z' | 'CONVERTI_B2B_POST_Z_NEUTRALISE';

export function buildConversionUrl(baseUrl: string, qrToken: string): string {
  if (!/^https?:\/\//u.test(baseUrl)) throw new RangeError('Base de conversion : URL absolue http(s) exigée (injectée par la configuration).');
  if (qrToken.trim() === '') throw new RangeError('Jeton de conversion vide.');
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/${encodeURIComponent(qrToken)}`;
}

/** Retrouve le jeton depuis le contenu d'un QR ; `null` si l'URL n'est pas bâtie sur la base donnée. */
export function parseConversionQrPayload(payload: string, baseUrl: string): string | null {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (!payload.startsWith(`${base}/`)) return null;
  const rest = payload.slice(base.length + 1);
  if (rest === '' || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

export interface ConversionView {
  readonly state: B2bConversionState;
  readonly canShowQr: boolean;
  readonly countsInB2cBase: boolean;
}

/** Un ticket converti (avant Z) sort de l'assiette B2C ; converti après Z, il est neutralisé : jamais compté deux fois. */
export function countsInB2cBase(state: B2bConversionState): boolean {
  return state === 'NONE';
}

export function resolveConversionView(state: B2bConversionState): ConversionView {
  return { state, canShowQr: state === 'NONE', countsInB2cBase: countsInB2cBase(state) };
}

export function expectedConversionState(zClosed: boolean): Exclude<B2bConversionState, 'NONE'> {
  return zClosed ? 'CONVERTI_B2B_POST_Z_NEUTRALISE' : 'CONVERTI_B2B_AVANT_Z';
}

export type ConversionErrorCode = 'ALREADY_CONVERTED' | 'INCONSISTENT_WITH_Z' | 'UNKNOWN_TICKET' | 'INVALID_TRANSITION';

export class ConversionError extends Error {
  readonly code: ConversionErrorCode;
  constructor(code: ConversionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ConversionError';
    this.code = code;
  }
}

export interface ConversionNotice {
  readonly ticketId: string;
  readonly newState: B2bConversionState;
  /** La clôture Z du ticket était-elle scellée au moment de la conversion ? (fournie par la synchronisation) */
  readonly zClosed: boolean;
}

/**
 * États locaux de conversion. `pos_tickets` est immuable (déclencheur) : l'état courant se lit de la ligne à l'émission
 * (`NONE`) puis évolue par les avis de la synchronisation descendante, validés ici.
 */
export class ConversionTracker {
  private readonly states = new Map<string, B2bConversionState>();
  private readonly listeners = new Set<() => void>();

  constructor(initial: readonly { readonly ticketId: string; readonly state: B2bConversionState }[] = []) {
    for (const entry of initial) this.states.set(entry.ticketId, entry.state);
  }

  register(ticketId: string, state: B2bConversionState): void {
    if (!this.states.has(ticketId)) this.states.set(ticketId, state);
    this.emit();
  }

  view(ticketId: string): ConversionView {
    const state = this.states.get(ticketId);
    if (state === undefined) throw new ConversionError('UNKNOWN_TICKET', `Ticket « ${ticketId} » inconnu.`);
    return resolveConversionView(state);
  }

  apply(notice: ConversionNotice): void {
    const current = this.states.get(notice.ticketId);
    if (current === undefined) throw new ConversionError('UNKNOWN_TICKET', `Ticket « ${notice.ticketId} » inconnu.`);
    if (current !== 'NONE') throw new ConversionError('ALREADY_CONVERTED', 'Ticket déjà converti : second avis rejeté.');
    if (notice.newState === 'NONE') throw new ConversionError('INVALID_TRANSITION', 'Un ticket ne revient jamais à NONE.');
    if (notice.newState !== expectedConversionState(notice.zClosed)) {
      throw new ConversionError('INCONSISTENT_WITH_Z', `État ${notice.newState} incohérent avec la clôture Z (scellée : ${String(notice.zClosed)}).`);
    }
    this.states.set(notice.ticketId, notice.newState);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
