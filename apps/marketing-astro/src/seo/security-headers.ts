/**
 * En-têtes de sécurité du site vitrine (retouche G2 tour 1). Le site n'exécute que ses propres scripts (fichiers de /_astro/, même origine),
 * n'embarque aucune ressource tierce et ne pose aucun cookie : la politique est donc fermée par défaut.
 * - script-src 'self' : aucun script en ligne exécutable (le JSON-LD est un bloc de données, hors du champ de script-src) ;
 * - style-src 'self' 'unsafe-inline' : Astro insère les feuilles de style courtes en ligne ;
 * - connect-src 'self' : les outils s'exécutent dans le navigateur, les endpoints du site sont de même origine ;
 * - frame-ancestors 'none' : le site ne s'affiche dans aucun cadre ; form-action 'self'. Les liens vers app.fisca.ma sont des navigations, pas des formulaires.
 */
export const CONTENT_SECURITY_POLICY: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Copie la réponse avec les en-têtes de sécurité (écrase une valeur déjà posée : la politique du site prime). */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}
