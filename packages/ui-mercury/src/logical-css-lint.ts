export interface LogicalCssViolation {
  readonly line: number;
  readonly property: string;
  readonly value: string;
  readonly suggestion: string;
}

/** Marqueur d'exception documentée : `/* mercury-allow-physical: <raison> *\/`. */
export const ALLOW_PHYSICAL_MARKER = 'mercury-allow-physical:';

const PHYSICAL_PROPERTY_SUGGESTIONS: ReadonlyMap<string, string> = new Map([
  ['left', 'inset-inline-start'],
  ['right', 'inset-inline-end'],
  ['margin-left', 'margin-inline-start'],
  ['margin-right', 'margin-inline-end'],
  ['padding-left', 'padding-inline-start'],
  ['padding-right', 'padding-inline-end'],
  ['border-left', 'border-inline-start'],
  ['border-right', 'border-inline-end'],
  ['border-left-width', 'border-inline-start-width'],
  ['border-right-width', 'border-inline-end-width'],
  ['border-left-style', 'border-inline-start-style'],
  ['border-right-style', 'border-inline-end-style'],
  ['border-left-color', 'border-inline-start-color'],
  ['border-right-color', 'border-inline-end-color'],
  ['border-top-left-radius', 'border-start-start-radius'],
  ['border-top-right-radius', 'border-start-end-radius'],
  ['border-bottom-left-radius', 'border-end-start-radius'],
  ['border-bottom-right-radius', 'border-end-end-radius'],
  ['scroll-margin-left', 'scroll-margin-inline-start'],
  ['scroll-margin-right', 'scroll-margin-inline-end'],
  ['scroll-padding-left', 'scroll-padding-inline-start'],
  ['scroll-padding-right', 'scroll-padding-inline-end'],
]);

const PHYSICAL_VALUES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ['text-align', new Map([['left', 'start'], ['right', 'end']])],
  ['float', new Map([['left', 'inline-start'], ['right', 'inline-end']])],
  ['clear', new Map([['left', 'inline-start'], ['right', 'inline-end']])],
]);

interface Sanitized {
  readonly text: string;
  readonly allowedLines: ReadonlySet<number>;
}

/** Remplace commentaires et chaînes par des espaces (retours à la ligne conservés) et relève les exceptions. */
function sanitize(css: string): Sanitized {
  const allowedLines = new Set<number>();
  let out = '';
  let line = 1;
  let i = 0;
  while (i < css.length) {
    const ch = css[i] ?? '';
    const next = css[i + 1] ?? '';
    if (ch === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      const body = css.slice(i + 2, end === -1 ? css.length : end);
      const startLine = line;
      let endLine = line;
      for (const c of css.slice(i, stop)) {
        if (c === '\n') {
          endLine += 1;
          out += '\n';
        } else {
          out += ' ';
        }
      }
      const at = body.indexOf(ALLOW_PHYSICAL_MARKER);
      if (at !== -1 && body.slice(at + ALLOW_PHYSICAL_MARKER.length).trim().length > 0) {
        allowedLines.add(startLine);
        allowedLines.add(endLine + 1);
      }
      line = endLine;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      out += ch;
      i += 1;
      while (i < css.length && css[i] !== ch) {
        if (css[i] === '\\') {
          out += ' ';
          i += 1;
        }
        if (css[i] === '\n') {
          line += 1;
          out += '\n';
        } else {
          out += ' ';
        }
        i += 1;
      }
      if (i < css.length) {
        out += ch;
        i += 1;
      }
    } else {
      if (ch === '\n') line += 1;
      out += ch;
      i += 1;
    }
  }
  return { text: out, allowedLines };
}

/**
 * Rejette les propriétés physiques (left, margin-right, padding-left, border-left…)
 * et les valeurs physiques de text-align/float/clear. Une exception se documente par
 * `/* mercury-allow-physical: <raison> *\/` sur la même ligne ou la ligne précédente.
 */
export function lintLogicalCss(css: string): LogicalCssViolation[] {
  const { text, allowedLines } = sanitize(css);
  const violations: LogicalCssViolation[] = [];
  const declaration = /(?<=^|[\s;{}])([a-zA-Z-]+)[ \t\r\n]*:[ \t\r\n]*([^;{}]*)/g;
  for (const m of text.matchAll(declaration)) {
    const property = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').replace(/!important/i, '').trim();
    const index = m.index ?? 0;
    const line = text.slice(0, index).split('\n').length;
    if (allowedLines.has(line)) continue;
    const propertySuggestion = PHYSICAL_PROPERTY_SUGGESTIONS.get(property);
    if (propertySuggestion !== undefined) {
      violations.push({ line, property, value, suggestion: propertySuggestion });
      continue;
    }
    const valueSuggestion = PHYSICAL_VALUES.get(property)?.get(value.toLowerCase());
    if (valueSuggestion !== undefined) {
      violations.push({ line, property, value, suggestion: valueSuggestion });
    }
  }
  return violations;
}
