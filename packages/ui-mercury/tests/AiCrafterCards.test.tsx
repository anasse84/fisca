// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCrafterAmountField, AiCrafterCard, AiCrafterConfidence } from '../src/AiCrafterCards.tsx';

afterEach(cleanup);

const base = { id: 'det-1', title: 'Facture fournisseur F-2026-001', summary: 'TTC extrait du scan', amountCents: 123456 } as const;

describe('AiCrafterCard', () => {
  it('porte le badge « Point à examiner » et jamais « Anomalie confirmée » avant visa', () => {
    render(<AiCrafterCard {...base} confidenceBps={8750} onValidate={() => undefined} onReject={() => undefined} />);
    expect(screen.getByText('Point à examiner')).toBeTruthy();
    expect(screen.getByText('IA')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/Anomalie confirmée/);
    expect(document.body.textContent ?? '').not.toMatch(/conforme|homologu|certifi|xhub/i);
  });

  it('expose la région nommée, le montant en ltr et la confiance lisible', () => {
    render(<AiCrafterCard {...base} confidenceBps={8750} onValidate={() => undefined} onReject={() => undefined} />);
    const region = screen.getByRole('article', { name: /Facture fournisseur F-2026-001/ });
    expect(region).toBeTruthy();
    expect(screen.getByText('1 234,56 MAD').getAttribute('dir')).toBe('ltr');
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('87');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.getAttribute('aria-label')).toBe('Confiance de l’IA');
    expect(screen.getByText('87 %')).toBeTruthy();
  });

  it('rappelle l’approbation humaine sur le bouton de validation', () => {
    render(<AiCrafterCard {...base} confidenceBps={5000} onValidate={() => undefined} onReject={() => undefined} />);
    const button = screen.getByRole('button', { name: /Valider.*approbation humaine/i });
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: /Rejeter/ })).toBeTruthy();
  });

  it('n’appelle jamais onValidate ni onReject sans clic, même à confiance maximale', () => {
    const onValidate = vi.fn();
    const onReject = vi.fn();
    render(<AiCrafterCard {...base} confidenceBps={10000} onValidate={onValidate} onReject={onReject} />);
    expect(onValidate).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('transmet l’identifiant au clic', () => {
    const onValidate = vi.fn();
    const onReject = vi.fn();
    render(<AiCrafterCard {...base} confidenceBps={9000} onValidate={onValidate} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    expect(onValidate).toHaveBeenCalledExactlyOnceWith('det-1');
    fireEvent.click(screen.getByRole('button', { name: /Rejeter/ }));
    expect(onReject).toHaveBeenCalledExactlyOnceWith('det-1');
  });

  it('un montant illisible reste vide, sans chiffre deviné, avec bordure ambre', () => {
    render(<AiCrafterCard {...base} amountCents={null} confidenceBps={2000} onValidate={() => undefined} onReject={() => undefined} />);
    const field = screen.getByRole('group', { name: /Montant illisible/ });
    expect(field.className).toContain('status-warning');
    expect(field.className).toContain('fisca-ai-illegible');
    expect(field.textContent ?? '').not.toMatch(/\d/);
    expect(field.textContent).toContain('Montant illisible — à saisir par un humain');
    expect(screen.queryByText(/MAD/)).toBeNull();
  });

  it('désactive la validation tant que le montant est illisible', () => {
    const onValidate = vi.fn();
    render(<AiCrafterCard {...base} amountCents={null} confidenceBps={2000} onValidate={onValidate} onReject={() => undefined} />);
    const button = screen.getByRole('button', { name: /Valider/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onValidate).not.toHaveBeenCalled();
  });

  it('une fois décidée, la carte affiche l’état et retire les boutons', () => {
    const { rerender } = render(<AiCrafterCard {...base} confidenceBps={9000} decision="validated" onValidate={() => undefined} onReject={() => undefined} />);
    expect(screen.getByText('Validé par un humain')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<AiCrafterCard {...base} confidenceBps={9000} decision="rejected" onValidate={() => undefined} onReject={() => undefined} />);
    expect(screen.getByText('Rejeté par un humain')).toBeTruthy();
  });

  it('refuse une confiance hors 0..10000 ou non entière', () => {
    for (const bad of [-1, 10001, 50.5]) {
      expect(() => render(<AiCrafterCard {...base} confidenceBps={bad} onValidate={() => undefined} onReject={() => undefined} />)).toThrow(/UI_CONFIDENCE_INVALID/);
    }
  });
});

describe('AiCrafterConfidence', () => {
  it('affiche 0 % et 100 % aux bornes', () => {
    const { rerender } = render(<AiCrafterConfidence confidenceBps={0} />);
    expect(screen.getByText('0 %')).toBeTruthy();
    rerender(<AiCrafterConfidence confidenceBps={10000} />);
    expect(screen.getByText('100 %')).toBeTruthy();
  });
});

describe('AiCrafterAmountField', () => {
  it('accepte un bigint', () => {
    render(<AiCrafterAmountField amountCents={5n} />);
    expect(screen.getByText('0,05 MAD')).toBeTruthy();
  });
});
