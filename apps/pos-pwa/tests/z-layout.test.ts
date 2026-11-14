import { describe, expect, it } from 'vitest';
import { layoutZTicket } from '../src/closing/z-layout.ts';
import type { ZLabelSet, ZTicketData } from '../src/closing/z-layout.ts';
import { PRINTER_PROFILE_58_CP858 } from '../src/printing/escpos.ts';
import { renderReceiptEscPos } from '../src/printing/receipt-layout.ts';
import { receiptLabelSetOf } from '../src/ui/labels.ts';

const labels: ZLabelSet = {
  title: 'T-Z', closureNumber: (n) => `N ${n}`, businessDate: 'D', ticketCount: (c) => `${c} t`, ht: (r) => `HT ${r}`, vat: (r) => `V ${r}`,
  stamp: 'S', tpeGross: 'TPE', hash: 'H', prevHash: 'P', thanks: 'fin',
};
const data: ZTicketData = {
  terminalId: 'POS-M01-C01', closureNumber: 3, businessDate: '2026-11-13', ticketCount: 3,
  rates: [{ vatRateBps: 2000, htCents: 10000, vatCents: 2000 }, { vatRateBps: 1000, htCents: 5000, vatCents: 500 }, { vatRateBps: 0, htCents: 3000, vatCents: 0 }],
  stampDutyCents: 30, tpeGrossCents: 5500, zSha256: 'a'.repeat(64), prevZSha256: '0'.repeat(64),
};

describe('mise en page du Ticket Z (même document pour l’aperçu et l’impression)', () => {
  it('montre un bloc par taux avec montants en centimes formatés, timbre, TPE et empreintes', () => {
    const doc = layoutZTicket(data, { columns: 32, labels });
    const text = JSON.stringify(doc);
    expect(text).toContain('100,00 MAD');
    expect(text).toContain('20,00 MAD');
    expect(text).toContain('55,00 MAD');
    expect(text).toContain('0,30 MAD');
    expect(text).toContain('aaaaaaaaaaaaaaaa');
  });

  it('ne contient aucun montant d’espèces attendu ni d’écart (comptage aveugle)', () => {
    const text = JSON.stringify(layoutZTicket(data, { columns: 32, labels }));
    expect(text).not.toMatch(/attendu|expected|ecart|variance/i);
  });

  it('se rend en octets ESC/POS avec le moteur existant', () => {
    const bytes = renderReceiptEscPos(layoutZTicket(data, { columns: 32, labels }), PRINTER_PROFILE_58_CP858, { openDrawer: false });
    expect(bytes.length).toBeGreaterThan(50);
    expect(receiptLabelSetOf('fr').title.length).toBeGreaterThan(0);
  });
});
