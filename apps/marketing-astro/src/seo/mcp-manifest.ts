import { MCP_SERVER_URL, OAUTH_PROTOCOL_LABEL, PUBLISHER } from '../content/identity.ts';
import { SITE_ORIGIN } from '../i18n/hreflang.ts';

export interface McpManifest {
  readonly name: string;
  readonly description: string;
  readonly publisher: { readonly name: string; readonly url: string };
  readonly server: { readonly url: string };
  readonly authorization: { readonly protocol: string };
}

/**
 * Métadonnées publiques du connecteur Fisca (Doc_18 S03). La spec pose l'URL du serveur et OAuth 2.1
 * mais ne liste aucune portée : aucune portée n'est exposée ici.
 */
export function buildMcpManifest(): McpManifest {
  return {
    name: PUBLISHER.brand,
    description: PUBLISHER.summaryFr,
    publisher: { name: PUBLISHER.legalName, url: SITE_ORIGIN },
    server: { url: MCP_SERVER_URL },
    authorization: { protocol: OAUTH_PROTOCOL_LABEL },
  };
}
