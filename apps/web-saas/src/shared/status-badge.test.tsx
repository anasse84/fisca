// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FISCA_LOCALES, translate } from '@fisca/i18n';
import { FiscaClearedBadge } from './status-badge.tsx';

afterEach(cleanup);

describe('FiscaClearedBadge : libellé issu de states.cleared', () => {
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : texte = clé states.cleared de la langue`, () => {
      render(<FiscaClearedBadge locale={locale} />);
      expect(screen.getByRole('status').textContent).toBe(translate(locale, 'common', 'states.cleared'));
      cleanup();
    });
  }
});
