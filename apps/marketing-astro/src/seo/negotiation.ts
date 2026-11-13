interface MediaRange {
  readonly type: string;
  readonly subtype: string;
  readonly q: number;
}

/** q-value en millièmes (entiers) : aucun flottant. */
function parseQMilli(raw: string | undefined): number {
  if (raw === undefined) return 1000;
  const m = /^(\d)(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (m === null) return 0;
  const whole = Number(m[1]) * 1000;
  const frac = Number((m[2] ?? '').padEnd(3, '0'));
  return Math.min(1000, whole + frac);
}

function parseAccept(header: string): readonly MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of header.split(',')) {
    const [mediaRaw, ...params] = part.split(';');
    const media = (mediaRaw ?? '').trim().toLowerCase();
    const slash = media.indexOf('/');
    if (slash <= 0) continue;
    let qRaw: string | undefined;
    for (const p of params) {
      const [k, v] = p.split('=');
      if (k !== undefined && v !== undefined && k.trim().toLowerCase() === 'q') qRaw = v;
    }
    ranges.push({ type: media.slice(0, slash), subtype: media.slice(slash + 1), q: parseQMilli(qRaw) });
  }
  return ranges;
}

function qualityFor(ranges: readonly MediaRange[], type: string, subtype: string): number {
  const exact = ranges.find((r) => r.type === type && r.subtype === subtype);
  if (exact !== undefined) return exact.q;
  const typeWild = ranges.find((r) => r.type === type && r.subtype === '*');
  if (typeWild !== undefined) return typeWild.q;
  const wildcard = ranges.find((r) => r.type === '*' && r.subtype === '*');
  return wildcard === undefined ? 0 : wildcard.q;
}

/**
 * Négociation de contenu (Doc_18 S03) : Markdown seulement s'il est cité explicitement et que sa qualité
 * égale ou dépasse celle du HTML. Le joker générique, les navigateurs et l’absence d'en-tête gardent le HTML.
 */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (acceptHeader === null || acceptHeader.trim() === '') return false;
  const ranges = parseAccept(acceptHeader);
  const explicit = ranges.find((r) => r.type === 'text' && r.subtype === 'markdown');
  if (explicit === undefined || explicit.q === 0) return false;
  return explicit.q >= qualityFor(ranges, 'text', 'html');
}
