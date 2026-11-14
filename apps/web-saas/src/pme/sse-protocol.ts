/** Analyseur `text/event-stream` (WHATWG HTML § 9.2) : fragments arbitraires en entrée, événements complets en sortie. */
export interface SseMessage {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
}

export interface SseParser {
  feed(chunk: string): SseMessage[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let lastId: string | null = null;
  let eventType = '';
  let data: string[] = [];

  const flush = (): SseMessage[] => {
    if (data.length === 0) {
      eventType = '';
      return [];
    }
    const message: SseMessage = { id: lastId, event: eventType === '' ? 'message' : eventType, data: data.join('\n') };
    eventType = '';
    data = [];
    return [message];
  };

  const handleLine = (line: string): SseMessage[] => {
    if (line === '') return flush();
    if (line.startsWith(':')) return [];
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventType = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) lastId = value;
    return [];
  };

  return {
    feed(chunk: string): SseMessage[] {
      buffer += chunk;
      const out: SseMessage[] = [];
      for (;;) {
        const match = /\r\n|\n|\r/.exec(buffer);
        if (match === null) break;
        const end = match.index + match[0].length;
        if (match[0] === '\r' && end === buffer.length) break;
        out.push(...handleLine(buffer.slice(0, match.index)));
        buffer = buffer.slice(end);
      }
      return out;
    },
  };
}
