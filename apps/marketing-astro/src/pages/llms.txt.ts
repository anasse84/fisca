import type { APIRoute } from 'astro';
import { handleLlmsTxt } from '../seo/handlers.ts';

export const GET: APIRoute = () => handleLlmsTxt();
