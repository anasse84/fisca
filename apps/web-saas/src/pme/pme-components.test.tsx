// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FISCA_LOCALES, directionOf, translate } from '@fisca/i18n';
import { FiscalRuleBanner, FiscalRuleBanners } from './FiscalRuleBanner.tsx';
import { InvoiceEditor } from './InvoiceEditor.tsx';
import { InvoicePreview } from './InvoicePreview.tsx';
import { TreasuryChart } from './TreasuryChart.tsx';
import { TreasuryDashboard } from './TreasuryDashboard.tsx';
import { computeInvoiceTotals } from './invoice-totals.ts';
import { ISSUER, RATES, RULES, makeForecast, recordingSink } from './test-kit.ts';

afterEach(cleanup);

const BANNED = /conforme|homologu|certifi|معتمد|مصادق|مطابق|certified|compliant|homologated/iu;

describe('FiscalRuleBanner : tout vient de l’objet de règle', () => {
  it('affiche message i18n, code, gravité, date de règle et montant formaté sans seuil en dur', () => {
    const rule = RULES[0];
    if (rule === undefined) throw new Error('fixture');
    render(<FiscalRuleBanner locale="fr" rule={rule} />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('5 000,00 MAD');
    expect(banner.textContent).toContain('CASH_CEILING');
    expect(banner.textContent).toContain('2026-01-01');
    expect(banner.textContent).toContain('réf. fournie par la table');
    expect(banner.getAttribute('data-severity')).toBe('warning');
  });
  it('un autre seuil du port change le texte : aucune valeur codée', () => {
    render(<FiscalRuleBanner locale="fr" rule={{ ...(RULES[0] ?? (() => { throw new Error('x'); })()), params: { threshold: { kind: 'amountCents', value: 123456 } } }} />);
    expect(screen.getByRole('status').textContent).toContain('1 234,56 MAD');
  });
  it('gravité danger = role=alert ; la gravité n’est jamais portée par la couleur seule (icône + libellé)', () => {
    const rule = RULES[1];
    if (rule === undefined) throw new Error('fixture');
    render(<FiscalRuleBanner locale="fr" rule={rule} />);
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(alert.textContent).toContain(translate('fr', 'common', 'ui.pme.severity.danger'));
  });
  it('clé de message absente d’une langue = erreur explicite, jamais de clé brute affichée', () => {
    expect(() => render(<FiscalRuleBanner locale="fr" rule={{ ruleCode: 'X', messageKey: 'ui.pme.rule.inexistante', severity: 'info', effectiveDate: '2026-01-01' }} />)).toThrow(/I18N_KEY_MISSING/);
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : sens ${directionOf(locale)}, date et code en LTR isolé, pas de mot interdit`, () => {
      render(<FiscalRuleBanners locale={locale} rules={RULES} />);
      const region = screen.getByRole('region');
      expect(region.getAttribute('dir')).toBe(directionOf(locale));
      expect(region.querySelector('time[dir="ltr"]')).not.toBeNull();
      expect(region.textContent ?? '').not.toMatch(BANNED);
      expect(region.textContent ?? '').not.toContain('ui.pme.');
    });
  }
  it('aucune règle : rien n’est rendu', () => {
    const { container } = render(<FiscalRuleBanners locale="fr" rules={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('TreasuryChart : graphique SVG accessible + alternative tabulaire', () => {
  it('role=img nommé, description chiffrée, légende avec trait plein et pointillé, jamais de flottant', () => {
    const { container } = render(<TreasuryChart locale="fr" forecast={makeForecast(90)} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-labelledby')).toBeTruthy();
    expect(container.querySelector('path[data-series="settled"]')?.getAttribute('stroke-dasharray')).toBeNull();
    expect(container.querySelector('path[data-series="forecast"]')?.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(container.querySelector('path[data-series="vat"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|\d\.\d{3,}/);
    expect(screen.getByText(translate('fr', 'common', 'ui.pme.chart.settledLegend'))).toBeTruthy();
  });
  it('tableau alternatif : 90 lignes de données, en-têtes de colonnes, montants par FiscalAmount', () => {
    const { container } = render(<TreasuryChart locale="fr" forecast={makeForecast(90)} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tbody tr').length).toBe(90);
    expect(table?.querySelectorAll('thead th[scope="col"]').length).toBe(4);
    expect(table?.querySelector('caption')?.textContent).toBe(translate('fr', 'common', 'ui.pme.chart.table.caption'));
    expect(table?.querySelectorAll('td span[dir="ltr"].fisca-tabular-num').length).toBeGreaterThan(90);
  });
  it('curseur clavier : un champ range nommé met à jour la valeur lue (aria-valuetext)', () => {
    render(<TreasuryChart locale="fr" forecast={makeForecast(90)} />);
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('max')).toBe('89');
    fireEvent.change(slider, { target: { value: '10' } });
    expect(slider.getAttribute('aria-valuetext')).toContain('2027-01-11');
    expect(screen.getByTestId('chart-readout').textContent).toContain('2027-01-11');
  });
  it('échéances de TVA fournies par le port, avec date et montant', () => {
    render(<TreasuryChart locale="fr" forecast={makeForecast(90)} />);
    const list = screen.getByRole('list', { name: translate('fr', 'common', 'ui.pme.vatDue.title') });
    expect(within(list).getByText('2027-02-20')).toBeTruthy();
    expect(list.textContent).toContain('384,00 MAD');
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : libellés traduits, sens ${directionOf(locale)}, graphe en LTR`, () => {
      const { container } = render(<TreasuryChart locale={locale} forecast={makeForecast(90)} />);
      const root = container.firstElementChild;
      expect(root?.getAttribute('dir')).toBe(directionOf(locale));
      expect(container.querySelector('svg[role="img"]')?.closest('[dir="ltr"]')).not.toBeNull();
      expect(container.textContent ?? '').not.toContain('ui.pme.');
      expect(container.textContent ?? '').not.toMatch(BANNED);
    });
  }
});

describe('TreasuryDashboard : états chargement / erreur / vide / données', () => {
  const rulesSource = { loadActiveRules: async () => RULES };
  it('charge par le port avec l’horizon de 90 jours puis affiche courbe et bannières', async () => {
    const asked: number[] = [];
    const source = { loadForecast: async (h: number) => { asked.push(h); return makeForecast(90); } };
    render(<TreasuryDashboard locale="fr" source={source} rulesSource={rulesSource} />);
    expect(screen.getByRole('status').textContent).toContain(translate('fr', 'common', 'states.loading'));
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
    expect(asked).toEqual([90]);
    expect(screen.getAllByRole('status').some((n) => n.textContent?.includes('CASH_CEILING'))).toBe(true);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(translate('fr', 'common', 'ui.pme.dashboard.title'));
  });
  it('erreur : message role=alert et bouton Réessayer qui relance le chargement', async () => {
    let n = 0;
    const source = { loadForecast: async () => { n += 1; if (n === 1) throw new Error('boom'); return makeForecast(90); } };
    render(<TreasuryDashboard locale="fr" source={source} rulesSource={rulesSource} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(translate('fr', 'common', 'states.error'));
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'actions.retry') }));
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
  });
  it('aucune donnée : état vide traduit', async () => {
    const source = { loadForecast: async () => ({ ...makeForecast(0), points: [] }) };
    render(<TreasuryDashboard locale="fr" source={source} rulesSource={rulesSource} />);
    await screen.findByText(translate('fr', 'common', 'states.empty'));
  });
});

function fill(label: string | RegExp, value: string, index = 0): void {
  fireEvent.change(screen.getAllByLabelText(label)[index] as HTMLElement, { target: { value } });
}

describe('InvoiceEditor : saisie des lignes, totaux, aperçu bilingue, garde-fou', () => {
  const L = (key: string): string => translate('fr', 'common', `ui.pme.invoice.${key}`);
  function setup(outcome: { ok: true; invoiceId: string } | { ok: false; reason: 'network' | 'rejected' } = { ok: true, invoiceId: 'brouillon-1' }) {
    const sink = recordingSink(outcome);
    render(<InvoiceEditor locale="fr" invoiceDate="2027-01-15" rates={RATES} issuer={ISSUER} sink={sink} rules={RULES.slice(0, 1)} />);
    return sink;
  }

  it('les taux viennent du port : le <select> n’offre que ses valeurs (+ invite)', () => {
    setup();
    const select = screen.getAllByLabelText(L('line.vatRate'))[0] as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', '2000', '1000', '0']);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([L('ratePlaceholder'), '20 %', '10 %', '0 %']);
  });

  it('calcule le total de ligne et les totaux avec divRoundHalfUpBigInt (entiers) et les affiche', () => {
    setup();
    fill(L('line.designationFr'), 'Prestation');
    fill(L('line.quantity'), '2,5');
    fill(L('line.unitPrice'), '100');
    fill(L('line.vatRate'), '2000');
    const expected = computeInvoiceTotals([{ quantityMilli: 2500, unitPriceCents: 10000, vatRateBps: 2000 }]);
    expect(expected.totalTtcCents).toBe(30000);
    const totals = screen.getByRole('group', { name: L('totals.title') });
    expect(totals.textContent).toContain('250,00 MAD');
    expect(totals.textContent).toContain('50,00 MAD');
    expect(totals.textContent).toContain('300,00 MAD');
  });

  it('ajoute et supprime des lignes, nom accessible numéroté', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: L('addLine') }));
    expect(screen.getAllByRole('group', { name: /^Ligne \d/ }).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la ligne 2' }));
    expect(screen.getAllByRole('group', { name: /^Ligne \d/ }).length).toBe(1);
  });

  it('refuse l’enregistrement d’un brouillon invalide : erreurs liées aux champs (aria-invalid, aria-describedby), sink non appelé', async () => {
    const sink = setup();
    fireEvent.click(screen.getByRole('button', { name: L('saveDraft') }));
    const qty = screen.getAllByLabelText(L('line.quantity'))[0] as HTMLInputElement;
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    const describedBy = qty.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(L('errors.quantity'));
    expect(sink.calls.length).toBe(0);
  });

  it('enregistre un brouillon complet en entiers vers le port InvoiceDraftSink', async () => {
    const sink = setup();
    fill(L('customerNameFr'), 'Client SA');
    fill(L('customerIce'), '001234567000089');
    fill(L('line.designationFr'), 'Prestation');
    fill(L('line.designationAr'), 'خدمة');
    fill(L('line.quantity'), '2,5');
    fill(L('line.unitPrice'), '100');
    fill(L('line.vatRate'), '2000');
    fireEvent.click(screen.getByRole('button', { name: L('saveDraft') }));
    await waitFor(() => expect(sink.calls.length).toBe(1));
    const draft = sink.calls[0];
    expect(draft?.invoiceDate).toBe('2027-01-15');
    expect(draft?.lines[0]).toEqual({ designationFr: 'Prestation', designationAr: 'خدمة', quantityMilli: 2500, unitPriceCents: 10000, vatRateBps: 2000, lineHtCents: 25000 });
    expect(draft?.totalTtcCents).toBe(30000);
    expect(draft?.customer.nameFr).toBe('Client SA');
    await screen.findByText(L('saved'));
  });

  it('échec du port : message traduit en role=alert', async () => {
    setup({ ok: false, reason: 'network' });
    fill(L('line.designationFr'), 'P');
    fill(L('line.quantity'), '1');
    fill(L('line.unitPrice'), '1');
    fill(L('line.vatRate'), '0');
    fireEvent.click(screen.getByRole('button', { name: L('saveDraft') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(L('saveFailed'));
  });

  it('ICE : contrôle de forme seulement (15 chiffres)', () => {
    setup();
    fill(L('customerIce'), '123');
    fireEvent.click(screen.getByRole('button', { name: L('saveDraft') }));
    expect((screen.getByLabelText(L('customerIce')) as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('bannières contextuelles de la règle fournie visibles dans l’éditeur', () => {
    setup();
    expect(screen.getAllByRole('status').some((n) => n.textContent?.includes('CASH_CEILING'))).toBe(true);
  });

  it('garde-fou : état Brouillon + mention de validation simulée, jamais « certifié »', () => {
    setup();
    expect(screen.getAllByText(translate('fr', 'common', 'notice.simulated')).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? '').not.toMatch(BANNED);
  });
});

describe('InvoicePreview : gabarit bilingue de la Section 09', () => {
  const totals = computeInvoiceTotals([
    { quantityMilli: 1000, unitPriceCents: 120000000 - 1, vatRateBps: 0 },
  ]);
  const lines = [{ designationFr: 'Licence', designationAr: 'رخصة', quantityMilli: 1000, unitPriceCents: 120000000 - 1, vatRateBps: 0 }];
  const customer = { ...ISSUER, nameFr: 'Client SA', nameAr: 'الزبون ش.م', ice: null };

  function renderPreview(clearance: 'draft' | 'cleared', locale: 'fr' | 'ar' | 'zgh-Tfng' = 'fr') {
    return render(<InvoicePreview locale={locale} invoiceDate="2027-01-15" invoiceNumber={null} issuer={ISSUER} customer={customer} lines={lines} totals={totals} rates={RATES} clearance={clearance} />);
  }

  it('deux colonnes : FR en LTR à gauche, AR en RTL à droite, feuille toujours isolée en LTR', () => {
    const { container } = renderPreview('draft');
    const sheet = container.querySelector('[data-testid="invoice-sheet"]');
    expect(sheet?.getAttribute('dir')).toBe('ltr');
    const fr = container.querySelector('[data-col="fr"]');
    const ar = container.querySelector('[data-col="ar"]');
    expect(fr?.getAttribute('dir')).toBe('ltr');
    expect(fr?.getAttribute('lang')).toBe('fr');
    expect(ar?.getAttribute('dir')).toBe('rtl');
    expect(ar?.getAttribute('lang')).toBe('ar');
    expect(fr?.textContent).toContain('Atlas Services SARL');
    expect(ar?.textContent).toContain('أطلس للخدمات ش.م.م');
    const frHeader = container.querySelector('[data-col="fr"]') as HTMLElement;
    const arHeader = container.querySelector('[data-col="ar"]') as HTMLElement;
    expect(frHeader.compareDocumentPosition(arHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ICE, IF, montants isolés en dir=ltr + tabular-nums', () => {
    const { container } = renderPreview('draft');
    const ice = container.querySelector('[data-field="ice"][data-col="fr"] [dir="ltr"]');
    expect(ice?.textContent).toBe('001234567000089');
    expect(container.querySelectorAll('.fisca-tabular-num[dir="ltr"]').length).toBeGreaterThan(5);
  });

  it('arrêté en lettres : français et arabe, issus du total TTC exact en centimes', () => {
    const { container } = renderPreview('draft');
    const fr = container.querySelector('[data-testid="arrete-fr"]')?.textContent ?? '';
    const ar = container.querySelector('[data-testid="arrete-ar"]')?.textContent ?? '';
    expect(fr).toContain(translate('fr', 'common', 'ui.pme.preview.arrete'));
    expect(fr).toContain('un million cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf dirhams et quatre-vingt-dix-neuf centimes');
    expect(ar).toContain('مليون ومائة وتسعة وتسعون ألف وتسعمائة وتسعة وتسعون درهم وتسعة وتسعون سنتيم');
    expect(ar).toContain(translate('ar', 'common', 'ui.pme.preview.arrete'));
    expect(container.querySelector('[data-testid="arrete-ar"]')?.getAttribute('dir')).toBe('rtl');
  });

  it('état brouillon : « Brouillon » + avertissement de validation simulée ; état cleared : « Validation simulée »', () => {
    const draft = renderPreview('draft');
    expect(draft.container.textContent).toContain(translate('fr', 'common', 'states.draft'));
    expect(draft.container.textContent).toContain(translate('fr', 'common', 'notice.simulated'));
    expect(draft.container.querySelector('[data-status="cleared"]')).toBeNull();
    cleanup();
    const cleared = renderPreview('cleared');
    expect(cleared.container.querySelector('[data-status="cleared"]')?.textContent).toBe('Validation simulée');
    expect(cleared.container.textContent ?? '').not.toMatch(/certifi|homologu|conforme/iu);
  });

  it('numéro absent : libellé « attribué à la validation », jamais un numéro inventé', () => {
    const { container } = renderPreview('draft');
    expect(container.textContent).toContain(translate('fr', 'common', 'ui.pme.preview.numberPending'));
  });

  it('le gabarit reste bilingue quelle que soit la langue de l’interface (zgh-Tfng)', () => {
    const { container } = renderPreview('draft', 'zgh-Tfng');
    expect(container.querySelector('[data-col="fr"]')?.textContent).toContain(translate('fr', 'common', 'ui.pme.preview.seller'));
    expect(container.querySelector('[data-col="ar"]')?.textContent).toContain(translate('ar', 'common', 'ui.pme.preview.seller'));
  });
});
