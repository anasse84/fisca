import { describe, expect, it } from 'vitest';
import { buildMcpManifest } from '../src/seo/mcp-manifest.ts';
import { buildRobotsTxt, buildHostDisallowAllRobotsTxt, AI_BOTS_ALLOWED } from '../src/seo/robots.ts';
import { handleMcpManifest, handleRobotsTxt } from '../src/seo/handlers.ts';

describe('/.well-known/mcp.json', () => {
  const manifest = buildMcpManifest();

  it('expose l’URL publique du serveur MCP et OAuth 2.1, rien d’autre', () => {
    expect(manifest.server.url).toBe('https://mcp.fisca.ma/mcp');
    expect(manifest.authorization.protocol).toBe('OAuth 2.1');
    expect(manifest.publisher.name).toBe('SYNAPTIC SYSTEMS SARL AU');
  });

  it('n’invente aucun scope (la spec n’en liste pas)', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/scope/i);
  });

  it('aucune formulation interdite', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/conforme|homologu|certifi/i);
  });

  it('handler : JSON UTF-8 valide, sans cookie', async () => {
    const res = handleMcpManifest();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(await res.text())).toEqual(JSON.parse(JSON.stringify(manifest)));
  });
});

describe('/robots.txt', () => {
  const robots = buildRobotsTxt();

  it('autorise explicitement les 7 bots IA', () => {
    expect(AI_BOTS_ALLOWED).toEqual([
      'GPTBot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'ClaudeBot',
      'Google-Extended',
      'Applebot-Extended',
    ]);
    for (const bot of AI_BOTS_ALLOWED) {
      expect(robots).toContain(`User-agent: ${bot}\nAllow: /`);
    }
  });

  it('n’interdit rien sur fisca.ma et documente la limite d’hôte', () => {
    expect(robots).not.toMatch(/^Disallow: \/\S/m);
    expect(robots).toMatch(/app\.fisca\.ma/);
    expect(robots).toMatch(/pos\.fisca\.ma/);
    expect(robots).toMatch(/api\.fisca\.ma/);
  });

  it('fournit le texte Disallow-all à servir sur les sous-domaines', () => {
    expect(buildHostDisallowAllRobotsTxt()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('handler : text/plain UTF-8', async () => {
    const res = handleRobotsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe(robots);
  });
});
