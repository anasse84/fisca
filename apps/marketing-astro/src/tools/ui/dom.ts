/** Aides DOM des outils : construction d'éléments sans innerHTML (les valeurs viennent du fichier de l'utilisateur). */
import type { VerificationState } from '../../content/dated-values.ts';

export interface RuleItem {
  readonly key: string;
  readonly label: string;
  readonly display: string;
  /** Valeur entière de la donnée datée (centimes, points de base ou compte). */
  readonly value: number;
  readonly as_of: string;
  readonly state: VerificationState;
  readonly stateLabel: string;
}

export interface RulesPayload {
  readonly asOf: string;
  readonly stateWord: string;
  readonly userValue: string;
  readonly items: readonly RuleItem[];
}

export function mustQuery<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Élément introuvable : ${selector}`);
  return found;
}

export function readJsonAttr<T>(root: HTMLElement, name: string): T {
  const raw = root.getAttribute(name);
  if (raw === null) throw new Error(`Attribut manquant : ${name}`);
  return JSON.parse(raw) as T;
}

export function template(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function el(tag: string, props: Readonly<Record<string, string>> = {}, ...children: readonly (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

/** Montant, ICE, date : chiffres tabulaires et isolation `ltr` (Doc_08 S03 et S08), y compris dans une page RTL. */
export function num(text: string): HTMLElement {
  return el('span', { class: 'fisca-tabular-num', dir: 'ltr' }, text);
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function show(node: HTMLElement, visible: boolean): void {
  node.hidden = !visible;
}

/** Liste des règles réellement utilisées : valeur, date, état de recoupement ; ou « valeur saisie par vous ». */
export function renderRules(target: HTMLElement, heading: string, payload: RulesPayload, used: readonly { readonly key: string; readonly overriddenDisplay?: string }[]): void {
  clear(target);
  target.append(el('h3', {}, heading));
  const list = el('ul', { class: 'dated-list' });
  for (const u of used) {
    const item = payload.items.find((i) => i.key === u.key);
    if (item === undefined) continue;
    const li = el('li', {}, `${item.label} : `);
    if (u.overriddenDisplay !== undefined) {
      li.append(num(u.overriddenDisplay), ' (', payload.userValue, ')');
    } else {
      li.append(num(item.display), ` (${payload.asOf} `, num(item.as_of), `, ${payload.stateWord} `);
      li.append(el('span', { class: item.state === 'RECOUPÉ' ? 'dated-state dated-state-checked' : 'dated-state', dir: 'ltr' }, item.state));
      li.append(` : ${item.stateLabel})`);
    }
    list.append(li);
  }
  target.append(list);
}

/** Paire libellé / valeur d'une liste de résultats (<dl>). */
export function resultRow(label: string, value: Node | string, emphasis = false): HTMLElement {
  const wrapper = el('div', { class: emphasis ? 'result-row result-row-main' : 'result-row' });
  wrapper.append(el('dt', {}, label), el('dd', {}, value));
  return wrapper;
}

export function setStatus(node: HTMLElement, text: string): void {
  node.textContent = text;
}

export function setError(node: HTMLElement, text: string | null): void {
  node.textContent = text ?? '';
  node.hidden = text === null;
}

/** Télécharge un texte en mémoire : aucun envoi réseau. */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
