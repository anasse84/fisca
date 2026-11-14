/** Îlot du lien « Démarrer l'essai gratuit 14 jours » : sans ICE, simple lien ; avec ICE, lien signé émis par le Worker. */
import { APP_ORIGIN, HANDOFF_ENDPOINT_PATH } from '../../edge/handoff-contract.ts';
import type { HandoffCopy } from '../copy/handoff.ts';
import { prepareHandoffIce } from '../handoff-ice.ts';
import { mustQuery, readJsonAttr, setError, setStatus } from './dom.ts';

async function requestSignedUrl(ice: string): Promise<string | null> {
  const response = await fetch(HANDOFF_ENDPOINT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ice }),
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  const url = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['url'] : undefined;
  return typeof url === 'string' && url.startsWith(`${APP_ORIGIN}/`) ? url : null;
}

export function mountHandoff(root: HTMLElement): void {
  const copy = readJsonAttr<HandoffCopy>(root, 'data-copy');
  const input = mustQuery<HTMLInputElement>(root, '[data-role="ice"]');
  const link = mustQuery<HTMLAnchorElement>(root, '[data-role="trial"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="error"]');
  const status = mustQuery<HTMLElement>(root, '[data-role="status"]');

  link.addEventListener('click', (event) => {
    setError(errorBox, null);
    if (input.value.trim() === '') return;
    event.preventDefault();
    const ice = prepareHandoffIce(input.value);
    if (ice === null) {
      setError(errorBox, copy.invalidIce);
      return;
    }
    setStatus(status, copy.opening);
    void requestSignedUrl(ice)
      .catch(() => null)
      .then((url) => {
        if (url === null) setStatus(status, copy.fallback);
        window.location.assign(url ?? `${APP_ORIGIN}/`);
      });
  });
}
