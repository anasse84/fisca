import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse-protocol.ts';

describe('analyseur text/event-stream', () => {
  it('assemble id, event et data (plusieurs lignes data jointes par \\n)', () => {
    const p = createSseParser();
    const out = p.feed('id: 7\nevent: ingestion.queued\ndata: {"a":1}\ndata: x\n\n');
    expect(out).toEqual([{ id: '7', event: 'ingestion.queued', data: '{"a":1}\nx' }]);
  });
  it('gère les fragments coupés au milieu d’une ligne et les fins de ligne CRLF', () => {
    const p = createSseParser();
    expect(p.feed('id: 1\r\nevent: ocr.fie')).toEqual([]);
    expect(p.feed('lds_extracted\r\ndata: {}\r\n\r\nid: 2\ndata: y\n\n')).toEqual([
      { id: '1', event: 'ocr.fields_extracted', data: '{}' },
      { id: '2', event: 'message', data: 'y' },
    ]);
  });
  it('ignore commentaires (battements) et champs inconnus ; l’id persiste jusqu’au suivant', () => {
    const p = createSseParser();
    const out = p.feed(': keep-alive\n\nretry: 5\nid: 9\ndata: a\n\ndata: b\n\n');
    expect(out).toEqual([
      { id: '9', event: 'message', data: 'a' },
      { id: '9', event: 'message', data: 'b' },
    ]);
  });
  it('un bloc sans data n’émet rien', () => {
    expect(createSseParser().feed('event: x\n\n')).toEqual([]);
  });
});
