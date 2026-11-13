import { defineMiddleware } from 'astro:middleware';
import { isEditorialHtmlPath, negotiateMarkdown } from './seo/handlers.ts';

/** Négociation Accept: text/markdown sur les URL éditoriales HTML (Doc_18 S03). Aucun cookie. */
export const onRequest = defineMiddleware(async (context, next) => {
  const markdown = negotiateMarkdown(context.request);
  if (markdown !== undefined) return markdown;

  const response = await next();
  if (!isEditorialHtmlPath(context.url.pathname)) return response;

  const varied = new Response(response.body, response);
  varied.headers.append('Vary', 'Accept');
  return varied;
});
