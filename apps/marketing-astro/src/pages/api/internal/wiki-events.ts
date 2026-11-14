import type { APIRoute } from 'astro';
import { handleWikiEvent } from '../../../edge/wiki-sync.ts';
import { wikiSyncDepsOf } from '../../../edge/runtime.ts';

/** Contrat PROVISIONAL (voir src/edge/wiki-sync.ts). Interne : jamais au sitemap, jamais en lien. */
export const POST: APIRoute = ({ request, locals }) => handleWikiEvent(request, wikiSyncDepsOf(locals.runtime));
export const ALL: APIRoute = ({ request, locals }) => handleWikiEvent(request, wikiSyncDepsOf(locals.runtime));
