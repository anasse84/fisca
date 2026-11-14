/**
 * Moteur PUR de POST /api/v1/public/pos-qr/:qrToken/convert-b2b (CTR-API-17) : conversion d'un ticket B2C en facture B2B SANS double
 * imposition (Doc_02 § 13, FSM 10 ; skill fisca-pos-offline-sce § 4).
 *
 * - le jeton QR (`qr_conversion_token`) retrouve le ticket : aucun identifiant interne n'apparaît dans l'URL ;
 * - avant la clôture Z de la session : CONVERTI_B2B_AVANT_Z (le ticket sort de l'assiette B2C du Ticket Z, rien à extourner) ;
 * - après la clôture Z : CONVERTI_B2B_POST_Z_NEUTRALISE, et dans UNE SEULE transaction (executeBatchAtomically) : brouillon de facture
 *   B2B (UNIQUE(pos_ticket_id)), écriture d'extourne B2C liée par `reversal_of_entry_id` (jamais d'UPDATE d'une pièce POSTED, loi 3),
 *   marquage monotone `converted_invoice_id`. Échec à mi-parcours : rien n'est écrit ;
 * - fenêtre de conversion après Z : `conversionWindowDays` (Doc_02 § 13 : « J+1..J+30 ») est un PARAMÈTRE, pas une constante ;
 *   hors fenêtre, le jeton est traité comme inconnu (404 uniforme) ;
 * - la facture B2B reste un BROUILLON : la certification (numérotation, XAdES, xHub) suit par l'orchestrateur `certify`, hors transaction
 *   (`PosCertificationStarter`, optionnel et reprenable). Aucun ICE ni raison sociale n'est journalisé.
 */
import { isValidIceChecksum, type SqlStatementParams } from '@fisca/shared-types';
import { PosError } from './errors.ts';
import type { PosB2bInvoicePort, PosCertificationStarter, PosClock, PosConversionState, PosConversionStore, PosReversalPort, PosTicketForConversion } from './ports.ts';

export interface PosConversionPorts {
  readonly store: PosConversionStore;
  readonly invoices: PosB2bInvoicePort;
  readonly reversal: PosReversalPort;
  readonly clock: PosClock;
  readonly ids: { newId(): string };
  readonly certification?: PosCertificationStarter;
}

export interface PosConversionConfig {
  /** Nombre de jours après la clôture Z pendant lesquels le QR convertit (paramètre de déploiement, jamais codé en dur). */
  readonly conversionWindowDays: number;
}

export interface PosConversionInput {
  readonly qrToken: string;
  readonly clientIce: string;
  readonly clientLegalName: string | null;
}

export interface PosConversionResult {
  readonly invoiceId: string;
  readonly state: Exclude<PosConversionState, 'NONE'>;
  readonly reversalApplied: boolean;
  readonly certificationPending: boolean;
}

const MS_PER_DAY = 86_400_000n;

function daysBetween(fromDate: string, toDate: string): bigint {
  return (BigInt(Date.parse(`${toDate}T00:00:00.000Z`)) - BigInt(Date.parse(`${fromDate}T00:00:00.000Z`))) / MS_PER_DAY;
}

export async function convertPosTicketToB2b(ports: PosConversionPorts, config: PosConversionConfig, input: PosConversionInput): Promise<PosConversionResult> {
  if (!Number.isSafeInteger(config.conversionWindowDays) || config.conversionWindowDays < 0) throw new PosError('POS_CONVERSION_FAILED');
  if (!/^\d{15}$/.test(input.clientIce) || !isValidIceChecksum(input.clientIce)) throw new PosError('POS_CLIENT_ICE_INVALID', [{ path: 'clientIce', code: 'invalid' }]);

  const ticket = await ports.store.findByQrToken(input.qrToken);
  if (ticket === null) throw new PosError('POS_TOKEN_UNKNOWN');
  const nowIso = ports.clock.nowIso();
  if (ticket.closure !== null && daysBetween(ticket.closure.businessDate, nowIso.slice(0, 10)) > BigInt(config.conversionWindowDays)) throw new PosError('POS_TOKEN_UNKNOWN');
  if (ticket.ticketKind !== 'SALE_B2C') throw new PosError('POS_TICKET_NOT_CONVERTIBLE');
  if (ticket.conversionState !== 'NONE' || ticket.convertedInvoiceId !== null) throw new PosError('POS_TICKET_ALREADY_CONVERTED');

  const postZ = ticket.closure !== null;
  if (ticket.closure !== null && ticket.closure.glJournalEntryId === null) throw new PosError('POS_Z_ENTRY_PENDING');
  const state: Exclude<PosConversionState, 'NONE'> = postZ ? 'CONVERTI_B2B_POST_Z_NEUTRALISE' : 'CONVERTI_B2B_AVANT_Z';
  const invoiceId = ports.ids.newId();

  const statements: SqlStatementParams[] = [...(await ports.invoices.buildDraftStatements({ invoiceId, ticket, clientIce: input.clientIce, clientLegalName: input.clientLegalName, nowIso }))];
  if (ticket.closure !== null && ticket.closure.glJournalEntryId !== null) {
    statements.push(
      ...(await ports.reversal.buildReversalStatements({
        ticket,
        closureId: ticket.closure.closureId,
        glJournalEntryId: ticket.closure.glJournalEntryId,
        businessDate: ticket.closure.businessDate,
        invoiceId,
        nowIso,
      })),
    );
  }
  statements.push({
    sql: "UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = ? AND b2b_conversion_state = 'NONE' AND converted_invoice_id IS NULL",
    params: [state, invoiceId, ticket.ticketId],
  });

  try {
    await ports.store.execute(statements);
  } catch {
    const current: PosTicketForConversion | null = await ports.store.findByQrToken(input.qrToken).catch(() => null);
    if (current !== null && (current.conversionState !== 'NONE' || current.convertedInvoiceId !== null)) throw new PosError('POS_TICKET_ALREADY_CONVERTED');
    throw new PosError('POS_CONVERSION_FAILED');
  }

  let certificationPending = false;
  if (ports.certification !== undefined) {
    try {
      await ports.certification.start(invoiceId);
    } catch {
      certificationPending = true;
    }
  }
  return { invoiceId, state, reversalApplied: postZ, certificationPending };
}
