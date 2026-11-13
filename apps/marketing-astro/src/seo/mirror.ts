import { canonicalUrlOf } from '../content/pages.ts';
import type { EditorialPage } from '../content/pages.ts';
import { buildMultilingualAlternates } from '../i18n/hreflang.ts';

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/** Miroir Markdown pur d'une page éditoriale : aucune balise HTML (Doc_18 S03 et S12). */
export function renderPageMarkdown(page: EditorialPage): string {
  const lines: string[] = [`# ${page.heading}`, '', `> ${page.description}`, '', page.lead, ''];
  for (const section of page.sections) {
    lines.push(`## ${section.heading}`, '', section.body, '');
  }
  lines.push('## Versions', '', `- Source canonique : ${canonicalUrlOf(page)}`);
  for (const alt of buildMultilingualAlternates(page.slug)) {
    lines.push(`- ${alt.hreflang} : ${alt.href}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function markdownResponse(page: EditorialPage, method: string): Response {
  const body = renderPageMarkdown(page);
  const robots: Record<string, string> = page.noindex === true ? { 'X-Robots-Tag': 'noindex, follow' } : {};
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      ...robots,
      'Content-Type': MARKDOWN_CONTENT_TYPE,
      'Content-Language': page.contentLanguage,
      Vary: 'Accept',
      Link: `<${canonicalUrlOf(page)}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
