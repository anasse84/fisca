/**
 * Contrôle navigateur de la CSP (retouche G2 tour 1) : Chromium réel sur le build de production (wrangler pages dev), 3 pages
 * plus les outils à îlots. Échoue sur la moindre erreur console, violation de CSP, requête hors origine ou en-tête manquant.
 * Usage : `node e2e/csp-check.ts http://127.0.0.1:4400`.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4400';
const pages = ['fr/', 'fr/tarifs', 'en/', 'ar/dictionnaire-cgnc/compte-34551', 'fr/outils/audit-ice-excel', 'fr/outils/validateur-ubl-fec', 'ar/outils/simulateur-loi-69-21'];
const REQUIRED = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'OK ' : 'KO '} ${name}${ok ? '' : ` ${detail}`}\n`);
}

const browser = await chromium.launch();
for (const path of pages) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`hors origine: ${r.url()}`);
  });
  await page.addInitScript(`
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI);
    });
  `);
  const response = await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
  const headers = response?.headers() ?? {};
  check(`${path} statut 200`, response?.status() === 200, String(response?.status()));
  for (const name of REQUIRED) check(`${path} en-tête ${name}`, typeof headers[name] === 'string' && (headers[name] ?? '').length > 0);
  if (path.includes('outils/')) {
    const mounted = await page.evaluate(() => document.querySelectorAll('[data-tool]').length);
    check(`${path} îlot monté`, mounted > 0, String(mounted));
  }
  const violations = (await page.evaluate('window.__cspViolations')) as string[];
  for (const v of violations) problems.push(`CSP violation: ${v}`);
  check(`${path} aucune erreur console, CSP ni requête tierce`, problems.length === 0, problems.join(' | '));
  await context.close();
}
await browser.close();
process.stdout.write(failures === 0 ? 'CSP : tout passe\n' : `CSP : ${String(failures)} échec(s)\n`);
process.exit(failures === 0 ? 0 : 1);
