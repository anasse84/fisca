/**
 * JSON canonique déterministe, dans l'esprit de RFC 8785 (JCS) : clés triées par unités de code UTF-16, aucun espace,
 * chaînes sérialisées comme JSON.stringify. Écart assumé : seuls les ENTIERS SÛRS sont admis comme nombres (aucun flottant,
 * loi 1) ; toute autre valeur numérique est refusée. Les propriétés `undefined` sont omises.
 */
export type CanonicalJsonValue = null | boolean | string | number | readonly CanonicalJsonValue[] | { readonly [key: string]: CanonicalJsonValue | undefined };

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('JSON canonique : seuls les entiers sûrs sont admis.');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item as CanonicalJsonValue)).join(',')}]`;
  const record = value as { readonly [key: string]: CanonicalJsonValue | undefined };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item !== undefined) parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}
