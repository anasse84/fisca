import type { APIRoute } from 'astro';
import { handleRobotsTxt } from '../seo/handlers.ts';

export const GET: APIRoute = () => handleRobotsTxt();
