import type { APIRoute } from 'astro';
import { handleMirrorRequest } from '../../seo/handlers.ts';

export const GET: APIRoute = ({ request }) => handleMirrorRequest(request) ?? new Response(null, { status: 404 });
