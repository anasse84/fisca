import type { APIRoute } from 'astro';
import { handleMcpManifest } from '../../seo/handlers.ts';

export const GET: APIRoute = () => handleMcpManifest();
