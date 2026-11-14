import type { APIRoute } from 'astro';
import { handleMirrorRequest } from '../../seo/handlers.ts';

export const GET: APIRoute = ({ request, locals }) => handleMirrorRequest(request, locals.dateModifiedIso) ?? new Response(null, { status: 404 });
