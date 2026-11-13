/** Identité publique de l'éditeur (AGENTS.md ; Doc_18 S03, S04 et S11). */
export const PUBLISHER = {
  legalName: 'SYNAPTIC SYSTEMS SARL AU',
  brand: 'Fisca',
  locality: 'Rabat',
  region: 'Rabat-Salé-Kénitra',
  countryIso2: 'MA',
  dpoEmail: 'dpo@fisca.ma',
  summaryFr:
    'Fisca est une plateforme de facturation et de comptabilité CGNC pour les entreprises marocaines, éditée par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc).',
} as const;

export const MCP_SERVER_URL = 'https://mcp.fisca.ma/mcp';
export const OAUTH_PROTOCOL_LABEL = 'OAuth 2.1';
export const MCP_MANIFEST_PATH = '/.well-known/mcp.json';

/** Sous-domaines non indexables (Doc_18 S03) : leur robots.txt est servi par leur propre hôte. */
export const NON_INDEXABLE_HOSTS: readonly string[] = ['app.fisca.ma', 'pos.fisca.ma', 'api.fisca.ma'];
