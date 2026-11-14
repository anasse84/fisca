import type { APIRoute } from 'astro';
import { handleHandoffRequest } from '../../edge/handoff-endpoint.ts';
import { handoffDepsOf } from '../../edge/runtime.ts';

/** Contrat PROVISIONAL (voir src/edge/handoff.ts) : émet le lien signé vers app.fisca.ma. */
export const POST: APIRoute = ({ request, locals }) => handleHandoffRequest(request, handoffDepsOf(locals.runtime));
export const ALL: APIRoute = ({ request, locals }) => handleHandoffRequest(request, handoffDepsOf(locals.runtime));
