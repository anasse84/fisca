import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, withSecurityHeaders } from '../src/seo/security-headers.ts';

function directive(name: string): string[] {
  const found = CONTENT_SECURITY_POLICY.split(';').map((d) => d.trim().split(/\s+/)).find((parts) => parts[0] === name);
  return found === undefined ? [] : found.slice(1);
}

describe('en-têtes de sécurité', () => {
  it('CSP fermée par défaut : aucun hôte tiers, aucun eval, aucun script en ligne', () => {
    expect(directive('default-src')).toEqual(["'none'"]);
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*|unsafe-eval|unsafe-hashes/);
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'none'"]);
    expect(directive('connect-src')).toEqual(["'self'"]);
    expect(directive('font-src')).toEqual(["'self'"]);
  });

  it('les quatre en-têtes sont posés avec les valeurs demandées', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
  });

  it('withSecurityHeaders garde le corps, le statut et les autres en-têtes, et écrase une politique déjà posée', async () => {
    const original = new Response('corps', { status: 404, headers: { 'Content-Type': 'text/plain', 'Content-Security-Policy': "default-src *" } });
    const secured = withSecurityHeaders(original);
    expect(secured.status).toBe(404);
    expect(await secured.text()).toBe('corps');
    expect(secured.headers.get('content-type')).toBe('text/plain');
    expect(secured.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(secured.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
