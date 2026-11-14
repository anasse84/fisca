import { describe, expect, it } from 'vitest';
import { layoutReceipt, renderReceiptEscPos, shortFingerprint } from '../src/printing/receipt-layout.ts';
import type { ReceiptData, ReceiptLabelSet, ReceiptElement } from '../src/printing/receipt-layout.ts';
import { PRINTER_PROFILE_58_CP858, PRINTER_PROFILE_80_CP864 } from '../src/printing/escpos.ts';

const fr: ReceiptLabelSet = {
  title: 'Ticket de caisse', number: 'Ticket n°', date: 'Date', totalHt: 'Total HT', vat: (rate) => `TVA ${rate} %`, totalTtc: 'Total TTC',
  stamp: 'Droit de timbre', cash: 'Espèces', card: 'Carte TPE', delivery: 'Appli livraison', change: 'Rendu', hash: 'Empreinte',
  qrCaption: 'Facture B2B : scannez ce QR', thanks: 'Merci',
};
const ar: ReceiptLabelSet = { ...fr, title: 'تذكرة الصندوق', totalTtc: 'المجموع TTC' };

const data: ReceiptData = {
  ticketNumber: 'POS-M01-C01-2026-000001',
  issuedAtIso: '2026-11-14T08:00:00.000Z',
  lines: [
    { name: 'Café', quantityMilli: 2000, lineTotalTtcCents: 2500 },
    { name: 'Farine', quantityMilli: 250, lineTotalTtcCents: 200 },
  ],
  vat: [
    { vatRateBps: 2000, htCents: 2083, vatCents: 417 },
    { vatRateBps: 0, htCents: 200, vatCents: 0 },
  ],
  stampDutyCents: 7,
  totalTtcCents: 2707,
  paidCashCents: 2707,
  paidCardTpeCents: 0,
  paidDeliveryAppCents: 0,
  changeCents: 293,
  ticketSha256: 'a9677d45f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbcc',
  qrPayload: 'https://b2b.test/convert/qr-token-1',
};

const texts = (elements: readonly ReceiptElement[]): string[] =>
  elements.flatMap((e) => (e.kind === 'text' ? [e.text] : e.kind === 'columns' ? [`${e.left}|${e.right}`] : []));

describe('mise en page du ticket (gabarit 58 / 80 mm)', () => {
  it('empreinte courte : 16 premiers caractères', () => {
    expect(shortFingerprint(data.ticketSha256)).toBe('a9677d45f1e2d3c4');
  });

  it('contient numéro, lignes, totaux, timbre, empreinte courte et QR', () => {
    const doc = layoutReceipt(data, { columns: 32, labels: fr, conversionCaption: true });
    const all = texts(doc).join('\n');
    expect(all).toContain('POS-M01-C01-2026-000001');
    expect(all).toContain('2 x Café|25,00 MAD');
    expect(all).toContain('0,25 x Farine|2,00 MAD');
    expect(all).toContain('Total HT|22,83 MAD');
    expect(all).toContain('TVA 20 %|4,17 MAD');
    expect(all).toContain('Droit de timbre|0,07 MAD');
    expect(all).toContain('Total TTC|27,07 MAD');
    expect(all).toContain('Empreinte a9677d45f1e2d3c4');
    expect(doc.find((e) => e.kind === 'qr')).toEqual({ kind: 'qr', data: 'https://b2b.test/convert/qr-token-1' });
  });

  it('timbre et rendu monnaie absents quand ils sont nuls ; TVA à 0 % non listée', () => {
    const doc = layoutReceipt({ ...data, stampDutyCents: 0, changeCents: 0, totalTtcCents: 2700, paidCashCents: 2700 }, { columns: 32, labels: fr, conversionCaption: true });
    const all = texts(doc).join('\n');
    expect(all).not.toContain('Droit de timbre');
    expect(all).not.toContain('Rendu');
    expect(all).not.toContain('TVA 0 %');
  });

  it('une ligne ne dépasse jamais la largeur du gabarit (nom tronqué, montant préservé)', () => {
    const long: ReceiptData = { ...data, lines: [{ name: 'Article au nom extrêmement long pour le test', quantityMilli: 1000, lineTotalTtcCents: 123456 }] };
    for (const columns of [32, 48]) {
      const doc = layoutReceipt(long, { columns, labels: fr, conversionCaption: true });
      for (const e of doc) {
        if (e.kind === 'columns') expect(e.left.length + 1 + e.right.length).toBeLessThanOrEqual(columns);
      }
      expect(texts(doc).join('\n')).toContain('1 234,56 MAD');
    }
  });

  it('bilingue : le jeu secondaire ajoute une ligne alignée à droite sous chaque libellé', () => {
    const doc = layoutReceipt(data, { columns: 48, labels: fr, secondaryLabels: ar, conversionCaption: true });
    const all = texts(doc);
    expect(all).toContain('تذكرة الصندوق');
    expect(all).toContain('المجموع TTC');
  });

  it('rendu ESC/POS : init, QR natif, coupe, tiroir en tête sur demande ; octets encodés selon le profil', () => {
    const doc = layoutReceipt(data, { columns: 32, labels: fr, conversionCaption: true });
    const bytes = renderReceiptEscPos(doc, PRINTER_PROFILE_58_CP858, { openDrawer: true });
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex.startsWith('1b 40 1b 74 13 1b 70 00 19 fa')).toBe(true);
    expect(hex).toContain('1d 28 6b 04 00 31 41 32 00');
    expect(hex.endsWith('1d 56 42 00')).toBe(true);
    const noDrawer = renderReceiptEscPos(doc, PRINTER_PROFILE_58_CP858, { openDrawer: false });
    expect(Array.from(noDrawer, (b) => b.toString(16).padStart(2, '0')).join(' ')).not.toContain('1b 70 00');
  });

  it('rendu 80 mm en CP864 : le jeu arabe est encodé sans erreur', () => {
    const doc = layoutReceipt(data, { columns: 48, labels: fr, secondaryLabels: ar, conversionCaption: true });
    expect(renderReceiptEscPos(doc, PRINTER_PROFILE_80_CP864, { openDrawer: false }).length).toBeGreaterThan(100);
  });
});
