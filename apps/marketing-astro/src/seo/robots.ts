import { MCP_MANIFEST_PATH, NON_INDEXABLE_HOSTS } from '../content/identity.ts';
import { SITE_ORIGIN } from '../i18n/hreflang.ts';

/** Doc_18 S03 : bots IA explicitement autorisés. */
export const AI_BOTS_ALLOWED: readonly string[] = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
];

/**
 * robots.txt de fisca.ma. Un robots.txt ne vaut que pour son hôte : l'interdiction d'indexer
 * app., pos. et api.fisca.ma ne peut pas s'exprimer ici ; chacun doit servir `buildHostDisallowAllRobotsTxt()`.
 */
export function buildRobotsTxt(): string {
  const blocks = AI_BOTS_ALLOWED.map((bot) => `User-agent: ${bot}\nAllow: /\n`);
  blocks.push('User-agent: *\nAllow: /\n');
  const note = [
    `# Ce fichier ne couvre que fisca.ma. ${NON_INDEXABLE_HOSTS.join(', ')} servent leur propre robots.txt (Disallow: /).`,
    `# Découverte agentique : /llms.txt, /llms-full.txt, ${MCP_MANIFEST_PATH}`,
    '',
  ].join('\n');
  return `${note}${blocks.join('\n')}\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

/** Contenu du robots.txt des sous-domaines app., pos. et api. */
export function buildHostDisallowAllRobotsTxt(): string {
  return 'User-agent: *\nDisallow: /\n';
}
