// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FiscalAmount, FiscalStatusBadge, FiscalTerm } from '../src/FiscalPrimitives.tsx';

afterEach(cleanup);

describe('FiscalAmount', () => {
  it('affiche 123456 centimes en « 1 234,56 MAD » avec tabular-nums et dir=ltr', () => {
    render(<FiscalAmount amountCents={123456} />);
    const node = screen.getByText('1 234,56 MAD');
    expect(node.getAttribute('dir')).toBe('ltr');
    expect(node.classList.contains('tabular-nums')).toBe(true);
    expect(node.classList.contains('fisca-tabular-num')).toBe(true);
  });

  it('accepte un bigint et un négatif', () => {
    render(<FiscalAmount amountCents={-900719925474099312345n} />);
    expect(screen.getByText('-9 007 199 254 740 993 123,45 MAD')).toBeTruthy();
  });

  it('garde dir=ltr dans un contexte RTL', () => {
    render(
      <div dir="rtl" lang="ar">
        <FiscalAmount amountCents={5} />
      </div>,
    );
    const node = screen.getByText('0,05 MAD');
    expect(node.getAttribute('dir')).toBe('ltr');
    expect(node.closest('[dir="rtl"]')).not.toBe(node);
  });

  it('marque le négatif seulement si emphasizeSign', () => {
    const { rerender } = render(<FiscalAmount amountCents={-100} />);
    expect(screen.getByText('-1,00 MAD').className).not.toContain('status-danger');
    rerender(<FiscalAmount amountCents={-100} emphasizeSign />);
    expect(screen.getByText('-1,00 MAD').className).toContain('status-danger');
  });

  it('refuse un montant non entier', () => {
    expect(() => render(<FiscalAmount amountCents={12.5} />)).toThrow(/UI_FLOAT_FORBIDDEN/);
  });
});

describe('FiscalTerm', () => {
  const props = { label: 'TVA', acronym: 'TVA', officialAr: 'الضريبة على القيمة المضافة', officialFr: 'Taxe sur la valeur ajoutée' } as const;

  it('en zgh-Tfng expose l’infobulle fr — ar et la rend accessible', () => {
    render(<FiscalTerm locale="zgh-Tfng" label="ⵜⵡⴰ" acronym="TVA" officialAr={props.officialAr} officialFr={props.officialFr} />);
    const term = screen.getByText('ⵜⵡⴰ').parentElement;
    expect(term?.getAttribute('title')).toBe(`${props.officialFr} — ${props.officialAr}`);
    expect(term?.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('(TVA)').getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('(TVA)').tagName).toBe('ABBR');
  });

  it('hors zgh-Tfng, pas d’infobulle', () => {
    render(<FiscalTerm locale="fr" {...props} label="Taxe" />);
    expect(screen.getByText('Taxe').parentElement?.hasAttribute('title')).toBe(false);
  });

  it('sans sigle, pas d’abréviation', () => {
    render(<FiscalTerm locale="fr" label="Facture" officialAr="فاتورة" officialFr="Facture" />);
    expect(document.querySelector('abbr')).toBeNull();
  });
});

describe('FiscalStatusBadge', () => {
  it('affiche « Validation simulée » pour cleared, sans mot interdit', () => {
    render(<FiscalStatusBadge status="cleared" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Validation simulée');
    expect(badge.className).toContain('status-cleared');
    expect(document.body.textContent ?? '').not.toMatch(/conforme|homologu|certifi|xhub|DGI/i);
  });
});
