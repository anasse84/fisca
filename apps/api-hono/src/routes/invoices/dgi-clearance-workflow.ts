/**
 * Colle Cloudflare Workflows de la clearance xHub (CTR-BND-08 DGI_CLEARANCE_WORKFLOW, Doc_02 § 02, Doc_17 § 07).
 * Aucune logique métier : le moteur (décisions, backoff, FSM, soumission idempotente) vit dans `@fisca/ubl-xades` (clearance/).
 *
 * Signature vérifiée dans la documentation Cloudflare Workflows (workers-api, sleeping-and-retrying) : `run(event, step)`,
 * `step.do(name, config?, callback)`, `step.sleep(name, duration)` (durée en ms ou texte), `WorkflowStepConfig.retries`
 * `{ limit, delay, backoff }` et `timeout`. Les types ci-dessous sont structurels (le dépôt n'embarque pas
 * `@cloudflare/workers-types`, comme pour les Durable Objects du socle).
 *
 * Choix de conception : les réessais de la PASSERELLE ne reposent pas sur `retries` de `step.do` (dont la formule exacte
 * d'« exponential » n'est pas figée) mais sur une boucle `step.do` + `step.sleep` pilotée par `computeClearanceBackoffSchedule()` :
 * barème exact, 8 réessais, somme ≤ 21 600 s, testable avec un faux `step`. `retries` de `step.do` ne couvre que les pannes
 * d'infrastructure (base indisponible).
 *
 * « Sans trou DO » : ce Workflow ne reçoit que des factures DÉJÀ numérotées ; il n'appelle jamais l'allocation du séquenceur
 * et un échec définitif laisse facture et numéro intacts (voir `finalizeClearance`).
 */
import {
  ClearanceEngineError,
  attemptClearanceSubmission,
  computeClearanceBackoffSchedule,
  decideNextAction,
  displayStateOfGateway,
  finalizeClearance,
  prepareClearance,
  type AttemptOutcome,
  type ClearancePorts,
} from '@fisca/ubl-xades/clearance';
import { DgiClearanceWorkflowPayloadSchema, type DgiClearanceWorkflowPayload, type DgiClearanceWorkflowResult } from './events.ts';

export interface WorkflowStepConfigLike {
  readonly retries?: { readonly limit: number; readonly delay: string | number; readonly backoff?: 'constant' | 'linear' | 'exponential' };
  readonly timeout?: string | number;
}

export interface WorkflowStepLike {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfigLike, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: number | string): Promise<void>;
}

export interface WorkflowEventLike<TPayload> {
  readonly payload: Readonly<TPayload>;
  readonly timestamp: Date;
}

/** Pannes d'infrastructure seulement (hypothèse de réglage : 3 réessais exponentiels dès 10 s ; délai d'une étape 30 s, supérieur au délai HTTP xHub de 12 s de Doc_17 § 09). */
export const INFRA_STEP_CONFIG: WorkflowStepConfigLike = { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '30 seconds' };

/** Résolution des ports d'une société (base, passerelle, archive, horloge) : jonction du pilote (ouverture D1 par société, P4-C). */
export type ClearancePortsResolver = (companyId: string) => Promise<ClearancePorts>;

export interface DgiClearanceWorkflowEnv {
  readonly resolveClearancePorts: ClearancePortsResolver;
}

type StepResult = AttemptOutcome | { readonly kind: 'ABORTED'; readonly code: string };

async function guarded<T>(action: () => Promise<T>): Promise<T | { readonly kind: 'ABORTED'; readonly code: string }> {
  try {
    return await action();
  } catch (error) {
    // Erreur métier non retentable : on ne la relance pas (aucun état écrit) ; code constant, jamais de donnée de facture.
    if (error instanceof ClearanceEngineError) return { kind: 'ABORTED', code: error.code };
    throw error;
  }
}

export async function runDgiClearanceWorkflow(
  resolvePorts: ClearancePortsResolver,
  event: WorkflowEventLike<DgiClearanceWorkflowPayload>,
  step: WorkflowStepLike,
): Promise<DgiClearanceWorkflowResult> {
  const payload = DgiClearanceWorkflowPayloadSchema.parse(event.payload);
  const input = { invoiceId: payload.invoiceId, xmlSha256: payload.xmlSha256 };
  const portsOf = async (): Promise<ClearancePorts> => {
    const ports = await resolvePorts(payload.companyId);
    if (ports.db.tenantId !== payload.companyId) throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_FOUND');
    return ports;
  };

  const start = await step.do('load-invoice', INFRA_STEP_CONFIG, () =>
    guarded(async () => {
      const ports = await portsOf();
      const invoice = await prepareClearance(ports, input);
      return { kind: 'LOADED' as const, clearanceState: invoice.clearanceState, xhubUuid: invoice.xhubUuid, displayState: displayStateOfGateway(ports.gateway.mode) };
    }),
  );
  if (start.kind === 'ABORTED') return { status: 'ABORTED', code: start.code };
  if (start.clearanceState === 'DEPOSEE_CERTIFIEE_DGI' && start.xhubUuid !== null) {
    return { status: 'DEPOSEE_CERTIFIEE_DGI', xhubUuid: start.xhubUuid, displayState: start.displayState };
  }
  if (start.clearanceState === 'REJETEE_XHUB') return { status: 'REJETEE_XHUB', code: 'ALREADY_REJECTED', displayState: start.displayState };

  const schedule = computeClearanceBackoffSchedule();
  let retryIndex = 0;
  let last: AttemptOutcome;
  for (;;) {
    const current: StepResult = await step.do(`submit-${retryIndex}`, INFRA_STEP_CONFIG, () => guarded(async () => attemptClearanceSubmission(await portsOf(), input)));
    if (current.kind === 'ABORTED') return { status: 'ABORTED', code: current.code };
    last = current;
    const next = decideNextAction(current, retryIndex, schedule);
    if (next.action !== 'SLEEP_THEN_RETRY') break;
    retryIndex += 1;
    await step.sleep(`backoff-${retryIndex}`, next.sleepSeconds * 1000);
  }

  const decided = last;
  const final = await step.do('record-outcome', INFRA_STEP_CONFIG, () =>
    guarded(async () => {
      const ports = await portsOf();
      const result = await finalizeClearance(ports, input, decided.kind === 'TRANSIENT' ? { kind: 'EXHAUSTED' } : decided);
      return { kind: 'FINALIZED' as const, result, displayState: displayStateOfGateway(ports.gateway.mode) };
    }),
  );
  if (final.kind === 'ABORTED') return { status: 'ABORTED', code: final.code };
  const { result, displayState } = final;
  if (result.status === 'DEPOSEE_CERTIFIEE_DGI') return { status: result.status, xhubUuid: result.xhubUuid, displayState };
  if (result.status === 'REJETEE_XHUB') return { status: result.status, code: result.code, displayState };
  return { status: 'CLEARANCE_EXHAUSTED', displayState };
}

/**
 * Classe Workflow `DgiClearanceWorkflow` (binding DGI_CLEARANCE_WORKFLOW). Structurelle : le runtime Cloudflare exige une
 * classe dérivée de `WorkflowEntrypoint` (module `cloudflare:workers`), non importable ici ; voir SEAM_REQUEST du rapport :
 * le pilote l'enveloppe dans `src/index.ts` ou fournit la base. `run` est celui de WorkflowEntrypoint.
 */
export class DgiClearanceWorkflow {
  constructor(
    readonly ctx: unknown,
    readonly env: DgiClearanceWorkflowEnv,
  ) {}

  run(event: WorkflowEventLike<DgiClearanceWorkflowPayload>, step: WorkflowStepLike): Promise<DgiClearanceWorkflowResult> {
    return runDgiClearanceWorkflow(this.env.resolveClearancePorts, event, step);
  }
}
