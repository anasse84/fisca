import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFileSpec {
  readonly name: string;
  readonly content: string;
  /** 8 = deflate (défaut), 0 = stocké. */
  readonly method?: 0 | 8;
}

/** Construit un ZIP minimal (suffisant pour un .xlsx de test) : en-têtes locaux, répertoire central, fin de répertoire. */
export function buildZip(files: readonly ZipFileSpec[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const method = file.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBuffer, end]));
}

export const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tiers" sheetId="1" r:id="rId7"/></sheets></workbook>';
export const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

/** Classeur de test : en-tête texte (chaînes partagées) puis ICE en cellules NUMÉRIQUES, comme Excel les écrit. */
export function buildXlsxFixture(): Uint8Array {
  const shared =
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Raison sociale</t></si><si><t>ICE</t></si><si><r><t>Société </t></r><r><t>A &amp; B</t></r></si><si><t xml:space="preserve">Société C</t></si></sst>';
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1534290000057</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="inlineStr"><is><t>003042032000080</t></is></c></row>' +
    '<row r="5"><c r="B5"><v>1.53429E+12</v></c><c r="D5" s="2"/></row>' +
    '</sheetData></worksheet>';
  return buildZip([
    { name: 'xl/workbook.xml', content: WORKBOOK_XML },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS_XML },
    { name: 'xl/sharedStrings.xml', content: shared, method: 0 },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);
}
