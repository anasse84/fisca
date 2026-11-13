import type { APIRoute } from 'astro';
import { handleSitemapXml } from '../seo/handlers.ts';

export const GET: APIRoute = () => handleSitemapXml();
