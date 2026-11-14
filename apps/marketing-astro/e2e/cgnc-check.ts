/**
 * Contrôle navigateur du Silo 3 (T-P2C-05, V2 du jeu) : Chromium réel, hub et fiches 34551, 44558 et 1161 en fr et ar, 375 et 1440 px, clair et sombre.
 * Usage : `node e2e/cgnc-check.ts http://localhost:4321 /tmp/fisca-e2e` (serveur déjà lancé). Sortie 0 si tout passe.
 * Contrôles : statut 200, un seul h1, aucun débordement horizontal de la page, tableaux dans .table-scroll focalisables,
 * numéros et montants en dir="ltr", RTL en arabe, aucune requête hors origine, anneau de focus visible.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4321';
const outDir = process.argv[3] ?? '/tmp/fisca-e2e';
mkdirSync(outDir, { recursive: true });

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures.push(`${name} ${detail}`.trim());
}

const PATHS: readonly string[] = ['dictionnaire-cgnc', 'dictionnaire-cgnc/compte-34551', 'dictionnaire-cgnc/compte-44558', 'dictionnaire-cgnc/compte-1161'];
const LOCALES: readonly string[] = ['fr', 'ar'];
const VIEWPORTS: readonly { readonly name: string; readonly width: number; readonly height: number }[] = [
  { name: '375', width: 375, height: 800 },
  { name: '1440', width: 1440, height: 900 },
];
const SCHEMES: readonly ('light' | 'dark')[] = ['light', 'dark'];

const browser = await chromium.launch();
let pages = 0;
try {
  for (const scheme of SCHEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme });
      for (const locale of LOCALES) {
        for (const path of PATHS) {
          const page = await context.newPage();
          const foreign: string[] = [];
          page.on('request', (req) => {
            if (!req.url().startsWith(base) && !req.url().startsWith('data:')) foreign.push(req.url());
          });
          const id = `${locale}/${path} ${viewport.name} ${scheme}`;
          const response = await page.goto(`${base}/${locale}/${path}`, { waitUntil: 'networkidle' });
          pages += 1;
          check(`${id} statut`, response?.status() === 200, String(response?.status()));
          check(`${id} un h1`, (await page.locator('main h1').count()) === 1);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          check(`${id} pas de débordement horizontal`, overflow <= 0, `${String(overflow)} px`);
          check(`${id} dir`, (await page.locator('html').getAttribute('dir')) === (locale === 'ar' ? 'rtl' : 'ltr'));
          check(`${id} requêtes hors origine`, foreign.length === 0, foreign.join(','));
          const tables = await page.locator('table').count();
          const scrolls = await page.locator('.table-scroll table').count();
          check(`${id} tableaux dans .table-scroll`, tables === scrolls, `${String(scrolls)}/${String(tables)}`);
          const badAmounts = await page.evaluate(() =>
            [...document.querySelectorAll('main .fisca-tabular-num')].filter((el) => el.closest('[dir="ltr"]') === null && el.getAttribute('dir') !== 'ltr').length,
          );
          check(`${id} montants et numéros en ltr`, badAmounts === 0, String(badAmounts));
          if (path.endsWith('compte-44558')) {
            const note = await page.locator('main .cgnc-analytic').innerText();
            check(`${id} mention analytique`, note.includes('4455') && !/officiel|official|رسمي/i.test(note), note);
          }
          if (path.endsWith('compte-34551')) {
            check(`${id} 34551 sur immobilisations`, /immobilisations|fixed assets|التثبيتات/.test(await page.locator('main #verdict').locator('..').innerText()));
          }
          if (path.includes('compte-')) {
            check(`${id} deux tableaux`, tables === 2, String(tables));
            await page.keyboard.press('Tab');
            let focusedRing = false;
            for (let i = 0; i < 40 && !focusedRing; i += 1) {
              await page.keyboard.press('Tab');
              focusedRing = await page.evaluate(() => {
                const el = document.activeElement;
                if (el === null || !el.classList.contains('table-scroll')) return false;
                const style = getComputedStyle(el);
                return style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
              });
            }
            check(`${id} focus visible sur le tableau`, focusedRing);
          }
          if (locale === 'ar' || viewport.name === '375') await page.screenshot({ path: `${outDir}/${locale}-${path.replaceAll('/', '_')}-${viewport.name}-${scheme}.png`, fullPage: true });
          await page.close();
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
process.stdout.write(`${String(pages)} pages contrôlées, ${String(failures.length)} échec(s)\n`);
for (const f of failures) process.stdout.write(`ECHEC ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
