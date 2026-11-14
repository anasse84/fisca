import type { APIRoute } from 'astro';
import { handleLlmsFullTxt } from '../seo/handlers.ts';

export const GET: APIRoute = () => handleLlmsFullTxt();
