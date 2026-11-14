import { CNDP_REFERENCES, CONTROLLER_PROCESSINGS, DATA_CONTROLLER, SUB_PROCESSORS, hasCndpNumber } from './cndp.ts';
import type { CndpFormId, HostingRegion, ProcessingId, SubProcessorId } from './cndp.ts';
import { getPrivacyCopy } from '../i18n/privacy-copy.ts';
import type { PrivacyCopy } from '../i18n/privacy-copy.ts';
import type { MarketingLocale } from '../i18n/locales.ts';

export interface ProcessingRowView {
  readonly id: ProcessingId;
  readonly purpose: string;
  readonly data: string;
  readonly retention: string;
}

export interface CndpReferenceView {
  readonly form: CndpFormId;
  readonly label: string;
  /** Numéro saisi par le propriétaire, ou `null` : la page affiche alors « à renseigner par le propriétaire ». */
  readonly number: string | null;
}

export interface SubProcessorRowView {
  readonly id: SubProcessorId;
  readonly name: string;
  readonly role: string;
  readonly region: HostingRegion;
  readonly regionLabel: string;
}

export interface PrivacyView {
  readonly locale: MarketingLocale;
  readonly copy: PrivacyCopy;
  readonly controllerName: string;
  readonly contactEmail: string;
  readonly processings: readonly ProcessingRowView[];
  readonly references: readonly CndpReferenceView[];
  readonly subProcessors: readonly SubProcessorRowView[];
}

export function buildPrivacyView(locale: MarketingLocale): PrivacyView {
  const copy = getPrivacyCopy(locale);
  return {
    locale,
    copy,
    controllerName: DATA_CONTROLLER.legalName,
    contactEmail: DATA_CONTROLLER.contactEmail,
    processings: CONTROLLER_PROCESSINGS.map((p) => ({
      id: p.id,
      purpose: copy.purposes.byProcessing[p.id],
      data: p.dataCategories.map((c) => copy.purposes.categories[c]).join(' ; '),
      retention: copy.retention.render(p.retention),
    })),
    references: CNDP_REFERENCES.map((r) => ({
      form: r.form,
      label: copy.cndp.forms[r.form],
      number: hasCndpNumber(r) ? r.number : null,
    })),
    subProcessors: SUB_PROCESSORS.map((s) => ({
      id: s.id,
      name: s.name,
      role: copy.hosting.roles[s.id],
      region: s.region,
      regionLabel: copy.hosting.regions[s.region],
    })),
  };
}

export interface PrivacyMarkdownSection {
  readonly heading: string;
  readonly body: string;
}

/** Sections Markdown du miroir /<langue>/confidentialite.md. */
export function privacyMarkdownSections(view: PrivacyView): PrivacyMarkdownSection[] {
  const { copy } = view;
  return [
    {
      heading: copy.controller.heading,
      body: [
        copy.controller.body,
        '',
        `- ${copy.controller.addressLabel} : ${copy.controller.address}`,
        `- ${copy.controller.contactLabel} : ${view.contactEmail}`,
      ].join('\n'),
    },
    { heading: copy.roles.heading, body: copy.roles.items.map((i) => `- ${i}`).join('\n') },
    {
      heading: copy.purposes.heading,
      body: [
        copy.purposes.intro,
        '',
        `| ${copy.purposes.columns.join(' | ')} |`,
        '| --- | --- | --- | --- |',
        ...view.processings.map((p) => `| ${p.id} | ${p.purpose} | ${p.data} | ${p.retention} |`),
        '',
        copy.purposes.noCardData,
      ].join('\n'),
    },
    {
      heading: copy.retention.heading,
      body: [`- ${copy.retention.fiscal}`, `- ${copy.retention.nonAccounting}`].join('\n'),
    },
    {
      heading: copy.rights.heading,
      body: [
        copy.rights.intro,
        '',
        ...copy.rights.items.map((i) => `- **${i.title}** : ${i.body}`),
        '',
        `${copy.rights.howTo} ${view.contactEmail}`,
        '',
        copy.rights.delay,
        '',
        copy.rights.fiscalLimit,
      ].join('\n'),
    },
    {
      heading: copy.cndp.heading,
      body: [
        copy.cndp.intro,
        '',
        copy.cndp.registering,
        '',
        ...view.references.map((r) => (r.number === null ? `- ${r.label}` : `- ${r.label} — ${copy.cndp.numberLabel} : ${r.number}`)),
      ].join('\n'),
    },
    {
      heading: copy.hosting.heading,
      body: [
        copy.hosting.intro,
        '',
        `| ${copy.hosting.columns.join(' | ')} |`,
        '| --- | --- | --- |',
        ...view.subProcessors.map((s) => `| ${s.name} | ${s.role} | ${s.regionLabel} |`),
        '',
        copy.hosting.legalBasis,
      ].join('\n'),
    },
    { heading: copy.cookies.heading, body: copy.cookies.items.map((i) => `- ${i}`).join('\n') },
  ];
}
