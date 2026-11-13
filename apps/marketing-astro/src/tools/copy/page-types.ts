import type { L4 } from '../../content/silos/types.ts';

export interface ToolSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export interface ToolStep {
  readonly name: string;
  readonly text: string;
}

export interface ToolFaq {
  readonly question: string;
  readonly answer: string;
}

/** Texte éditorial d'une page d'outil : source du HTML, du miroir Markdown, de llms.txt et du JSON-LD (HowTo, FAQPage). */
export interface ToolPageCopy {
  readonly title: L4;
  readonly description: L4;
  readonly heading: L4;
  readonly lead: L4;
  readonly summary: L4;
  readonly steps: L4<readonly ToolStep[]>;
  readonly faqs: L4<readonly ToolFaq[]>;
  readonly sections: L4<readonly ToolSection[]>;
  readonly legislation?: { readonly name: string; readonly identifier: string };
}
