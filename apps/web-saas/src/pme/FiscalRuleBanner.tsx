import type { ReactElement, ReactNode } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount } from '@fisca/ui-mercury';
import { commonText, pmeText, renderTemplate } from './labels.tsx';
import type { FiscalRule, FiscalRuleParam, FiscalRuleSeverity } from './ports.ts';
import './pme.css';

export interface FiscalRuleBannerProps {
  readonly locale: FiscaLocale;
  readonly rule: FiscalRule;
}

/** Icônes distinctes par gravité : la gravité n'est jamais portée par la couleur seule (WCAG 1.4.1). */
function SeverityIcon({ severity }: { readonly severity: FiscalRuleSeverity }): ReactElement {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, className: 'fisca-pme__banner-icon' } as const;
  if (severity === 'danger') {
    return (
      <svg {...common}>
        <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (severity === 'warning') {
    return (
      <svg {...common}>
        <path d="M12 3 2 21h20z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 10v5M12 18v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v6M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function paramNode(param: FiscalRuleParam): ReactNode {
  return param.kind === 'amountCents' ? <FiscalAmount amountCents={param.value} /> : <span dir="auto">{param.value}</span>;
}

/** Bannière d'une règle fournie par le port : message i18n, gravité, code, date d'effet. Aucun seuil ni date n'est écrit ici. */
export function FiscalRuleBanner({ locale, rule }: FiscalRuleBannerProps): ReactElement {
  const template = commonText(locale, rule.messageKey);
  const nodes: Record<string, ReactNode> = {};
  for (const [name, param] of Object.entries(rule.params ?? {})) {
    nodes[name] = paramNode(param);
  }
  const role = rule.severity === 'danger' ? 'alert' : 'status';
  return (
    <div role={role} className="fisca-pme__banner" data-severity={rule.severity} data-rule-code={rule.ruleCode}>
      <SeverityIcon severity={rule.severity} />
      <div className="fisca-pme__banner-body">
        <p className="fisca-pme__banner-title">{pmeText(locale, `severity.${rule.severity}`)}</p>
        <p className="fisca-pme__banner-message">{renderTemplate(template, nodes)}</p>
        <p className="fisca-pme__banner-meta">
          <span>{pmeText(locale, 'banner.rule')} </span>
          <code dir="ltr" className="fisca-tabular-num">
            {rule.ruleCode}
          </code>
          <span> · {pmeText(locale, 'banner.effective')} </span>
          <time dir="ltr" dateTime={rule.effectiveDate} className="fisca-tabular-num">
            {rule.effectiveDate}
          </time>
          {rule.articleRef === undefined ? null : (
            <span>
              {' · '}
              {pmeText(locale, 'banner.reference')} <span dir="auto">{rule.articleRef}</span>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export interface FiscalRuleBannersProps {
  readonly locale: FiscaLocale;
  readonly rules: readonly FiscalRule[];
}

/** Région des bannières contextuelles ; rien n'est rendu sans règle active. */
export function FiscalRuleBanners({ locale, rules }: FiscalRuleBannersProps): ReactElement | null {
  if (rules.length === 0) {
    return null;
  }
  return (
    <section aria-label={pmeText(locale, 'banner.region')} dir={directionOf(locale)} lang={locale} className="fisca-pme__banners">
      {rules.map((rule) => (
        <FiscalRuleBanner key={rule.ruleCode} locale={locale} rule={rule} />
      ))}
    </section>
  );
}

