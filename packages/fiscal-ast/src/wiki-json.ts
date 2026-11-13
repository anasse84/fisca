import { WikiCompilerError } from './wiki-compiler-errors.ts';

/** Valeur JSON sans flottant : les nombres sont des entiers sûrs (ADR-03). */
export type StrictJsonValue = null | boolean | number | string | readonly StrictJsonValue[] | { readonly [key: string]: StrictJsonValue };

const MAX_DEPTH = 32;

/**
 * Analyseur JSON strict : refuse les clés dupliquées (JSON.parse garde silencieusement la dernière),
 * les nombres à virgule ou à exposant, les entiers hors des entiers sûrs et tout texte après la valeur.
 */
export function parseStrictJson(text: string): StrictJsonValue {
  let position = 0;

  const fail = (code: 'WIKI_SOURCE_MALFORMED' | 'WIKI_SOURCE_DUPLICATE_FIELD' | 'WIKI_AMOUNT_NOT_INTEGER', detail: string): never => {
    throw new WikiCompilerError(code, `${detail} (position ${position}).`);
  };

  const skipSpaces = (): void => {
    while (position < text.length && (text[position] === ' ' || text[position] === '\n' || text[position] === '\r' || text[position] === '\t')) {
      position += 1;
    }
  };

  const parseString = (): string => {
    const start = position;
    position += 1;
    while (position < text.length) {
      const char = text[position];
      if (char === '\\') {
        position += 2;
        continue;
      }
      if (char === '"') {
        position += 1;
        try {
          const value: unknown = JSON.parse(text.slice(start, position));
          if (typeof value === 'string') {
            return value;
          }
        } catch {
          return fail('WIKI_SOURCE_MALFORMED', 'chaîne invalide');
        }
        return fail('WIKI_SOURCE_MALFORMED', 'chaîne invalide');
      }
      position += 1;
    }
    return fail('WIKI_SOURCE_MALFORMED', 'chaîne non terminée');
  };

  const parseNumber = (): number => {
    const match = /^-?(0|[1-9][0-9]*)/.exec(text.slice(position));
    if (match === null) {
      return fail('WIKI_SOURCE_MALFORMED', 'nombre illisible');
    }
    const literal = match[0];
    position += literal.length;
    const next = text[position];
    if (next === '.' || next === 'e' || next === 'E') {
      return fail('WIKI_AMOUNT_NOT_INTEGER', 'nombre non entier (virgule ou exposant) interdit');
    }
    const value = Number(literal);
    if (!Number.isSafeInteger(value)) {
      return fail('WIKI_AMOUNT_NOT_INTEGER', `entier hors des entiers sûrs : ${literal}`);
    }
    return value;
  };

  const parseValue = (depth: number): StrictJsonValue => {
    if (depth > MAX_DEPTH) {
      return fail('WIKI_SOURCE_MALFORMED', 'imbrication trop profonde');
    }
    skipSpaces();
    const char = text[position];
    if (char === '{') {
      position += 1;
      const entries: [string, StrictJsonValue][] = [];
      const seen = new Set<string>();
      skipSpaces();
      if (text[position] === '}') {
        position += 1;
        return {};
      }
      for (;;) {
        skipSpaces();
        if (text[position] !== '"') {
          return fail('WIKI_SOURCE_MALFORMED', 'clé d\'objet attendue');
        }
        const key = parseString();
        if (seen.has(key)) {
          return fail('WIKI_SOURCE_DUPLICATE_FIELD', `clé « ${key} » répétée`);
        }
        seen.add(key);
        skipSpaces();
        if (text[position] !== ':') {
          return fail('WIKI_SOURCE_MALFORMED', '« : » attendu');
        }
        position += 1;
        entries.push([key, parseValue(depth + 1)]);
        skipSpaces();
        if (text[position] === ',') {
          position += 1;
          continue;
        }
        if (text[position] === '}') {
          position += 1;
          return Object.fromEntries(entries);
        }
        return fail('WIKI_SOURCE_MALFORMED', '« , » ou « } » attendu');
      }
    }
    if (char === '[') {
      position += 1;
      const items: StrictJsonValue[] = [];
      skipSpaces();
      if (text[position] === ']') {
        position += 1;
        return items;
      }
      for (;;) {
        items.push(parseValue(depth + 1));
        skipSpaces();
        if (text[position] === ',') {
          position += 1;
          continue;
        }
        if (text[position] === ']') {
          position += 1;
          return items;
        }
        return fail('WIKI_SOURCE_MALFORMED', '« , » ou « ] » attendu');
      }
    }
    if (char === '"') {
      return parseString();
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return value;
      }
    }
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      return parseNumber();
    }
    return fail('WIKI_SOURCE_MALFORMED', 'valeur JSON attendue');
  };

  const value = parseValue(0);
  skipSpaces();
  if (position !== text.length) {
    fail('WIKI_SOURCE_MALFORMED', 'texte superflu après la valeur');
  }
  return value;
}

/** JSON canonique : clés triées par unités de code, aucun espace, entiers sûrs uniquement. */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new WikiCompilerError('WIKI_AMOUNT_NOT_INTEGER', `JSON canonique : ${String(value)} n'est pas un entier sûr.`);
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new WikiCompilerError('WIKI_SOURCE_MALFORMED', `JSON canonique : valeur de type ${typeof value} non sérialisable.`);
}

/** SHA-256 hexadécimal (minuscules) des octets UTF-8 du texte (WebCrypto, aucune dépendance). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
