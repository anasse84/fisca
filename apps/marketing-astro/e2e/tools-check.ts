/**
 * Contrôle navigateur des outils publics (T-P2C-06 et T-P2C-07) : Chromium réel, vrai dépôt de fichier CSV et .xlsx, fr et ar,
 * 375 et 1440 px, clair et sombre. Usage : `node e2e/tools-check.ts http://localhost:4321` (serveur déjà lancé).
 * Sortie 0 si tout passe. Aucun envoi réseau n'est attendu : toute requête hors origine fait échouer le contrôle.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildXlsxFixture } from '../tests/helpers/zip.ts';

const base = process.argv[2] ?? 'http://localhost:4321';
const outDir = process.argv[3] ?? '/tmp/fisca-e2e';
mkdirSync(outDir, { recursive: true });

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const failures: string[] = [];
const checks: Check[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name} ${detail}`);
}

const CSV = 'Raison sociale;ICE;Ville\r\nAcme;1534290000057;Rabat\r\nBeta;003042032000080;Fès\r\nGamma;001534290000075;Salé\r\nDelta;;Agadir\r\n';
const origin = new URL(base).origin;

const browser = await chromium.launch();
try {
  for (const locale of ['fr', 'ar'] as const) {
    for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
      for (const scheme of ['light', 'dark'] as const) {
        const tag = `${locale}-${String(viewport.width)}-${scheme}`;
        const context = await browser.newContext({ viewport, colorScheme: scheme, acceptDownloads: true });
        const page = await context.newPage();
        const foreign: string[] = [];
        page.on('request', (r) => {
          const url = r.url();
          if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
        });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });

        // ---- Auditeur d'ICE : CSV ----
        await page.goto(`${base}/${locale}/outils/audit-ice-excel`, { waitUntil: 'networkidle' });
        const dir = await page.evaluate(() => document.documentElement.dir);
        check(`${tag} dir`, dir === (locale === 'ar' ? 'rtl' : 'ltr'), dir);
        await page.locator('#ice-file').setInputFiles({ name: 'tiers.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
        await page.locator('[data-role="results"]').waitFor({ state: 'visible', timeout: 5000 });
        const summary = (await page.locator('[data-role="summary"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ice synthèse`, /4/.test(summary) && summary.includes('1'), summary);
        const rows = await page.locator('[data-role="table"] tbody tr').count();
        check(`${tag} ice lignes à relire`, rows === 2, String(rows));
        const status = (await page.locator('[data-role="status"]').innerText()).trim();
        check(`${tag} ice statut annoncé`, status.length > 0, status);
        const cells = await page.locator('[data-role="table"] tbody tr').first().innerText();
        check(`${tag} ice réparé`, cells.includes('1534290000057') && cells.includes('001534290000057'), cells);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} ice pas de défilement horizontal de page`, overflow <= 1, String(overflow));
        const scroller = await page.locator('[data-role="table"]').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, ox: getComputedStyle(n).overflowX }));
        check(`${tag} ice conteneur .table-scroll défilant`, scroller.ox === 'auto' && scroller.sw >= scroller.cw, JSON.stringify(scroller));
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-role="export"]').click()]);
        const path = `${outDir}/${tag}-corrige.csv`;
        await download.saveAs(path);
        const exported = readFileSync(path, 'utf8');
        check(`${tag} ice export`, exported.includes('ICE_corrige') && exported.includes('001534290000057;AUTO_REPAIRED_EXCEL_LEADING_ZEROS'), exported.slice(0, 200));
        // focus clavier visible sur la zone de dépôt
        await page.goto(`${base}/${locale}/outils/audit-ice-excel`, { waitUntil: 'networkidle' });
        await page.keyboard.press('Tab');
        for (let i = 0; i < 40; i += 1) {
          const onInput = await page.evaluate(() => document.activeElement?.id === 'ice-file');
          if (onInput) break;
          await page.keyboard.press('Tab');
        }
        const focusOutline = await page.locator('[data-role="drop"]').evaluate((n) => `${getComputedStyle(n).outlineStyle}|${getComputedStyle(n).outlineWidth}|active=${document.activeElement?.id ?? ''}`);
        check(`${tag} ice focus visible zone de dépôt`, focusOutline.startsWith('solid'), focusOutline);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        check(`${tag} thème`, scheme === 'dark' ? bg !== 'rgb(250, 249, 245)' : bg === 'rgb(250, 249, 245)', bg);
        await page.screenshot({ path: `${outDir}/${tag}-ice.png`, fullPage: true });

        // ---- .xlsx (une seule fois : fr clair) ----
        if (locale === 'fr' && scheme === 'light' && viewport.width === 1440) {
          writeFileSync(`${outDir}/tiers.xlsx`, buildXlsxFixture());
          await page.locator('#ice-file').setInputFiles(`${outDir}/tiers.xlsx`);
          await page.waitForFunction(() => document.querySelector('[data-role="status"]')?.textContent?.includes('tiers.xlsx') === true, null, { timeout: 5000 });
          const xr = await page.locator('[data-role="table"] tbody').innerText();
          check('xlsx ICE numérique réparé', xr.includes('001534290000057'), xr);
          check('xlsx notation scientifique signalée', /scientifique/.test(xr), xr);
          // fichier non pris en charge : message d'erreur annoncé
          await page.locator('#ice-file').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
          await page.locator('[data-role="error"]').waitFor({ state: 'visible', timeout: 3000 });
          check('erreur format', (await page.locator('[data-role="error"]').innerText()).length > 5);
        }

        // ---- Loi 69-21 ----
        await page.goto(`${base}/${locale}/outils/simulateur-loi-69-21`, { waitUntil: 'networkidle' });
        await page.locator('#loi-amount').fill('12345');
        await page.locator('#loi-delivery').fill('2026-06-01');
        await page.locator('#loi-payment').fill('2026-09-15');
        await page.locator('button[type="submit"]').click();
        await page.locator('[data-role="results"]').waitFor({ state: 'visible', timeout: 3000 });
        const loi = (await page.locator('[data-role="list"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} loi 44 500 centimes = 445,00 MAD`, loi.includes('445,00 MAD') && loi.includes('2026-07-31') && loi.includes('360 bps'), loi);
        check(`${tag} loi 46 jours, 2 mois`, loi.includes('46') && /\b2\b/.test(loi), loi);
        const loiRules = (await page.locator('[data-role="rules"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} loi règle datée affichée`, loiRules.includes('2026-11-13') && loiRules.includes('NON RECOUPÉ'), loiRules);
        const loiOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} loi pas de défilement horizontal`, loiOverflow <= 1, String(loiOverflow));
        await page.screenshot({ path: `${outDir}/${tag}-loi.png`, fullPage: true });

        // ---- RAS-TVA et espèces ----
        await page.goto(`${base}/${locale}/outils/ras-tva-especes`, { waitUntil: 'networkidle' });
        await page.locator('#ras-ht').fill('10000');
        await page.locator('#ras-payment-date').fill('2026-11-15');
        await page.locator('#ras-attestation').fill('2026-07-01');
        await page.locator('[data-role="ras-form"] button[type="submit"]').click();
        await page.locator('[data-role="ras-results"]').waitFor({ state: 'visible', timeout: 3000 });
        const ras = (await page.locator('[data-role="ras-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ras 1 500,00 et net 10 500,00`, ras.includes('1 500,00 MAD') && ras.includes('10 500,00 MAD'), ras);
        await page.locator('#ras-attestation').fill('2026-04-01');
        await page.locator('[data-role="ras-form"] button[type="submit"]').click();
        const ras2 = (await page.locator('[data-role="ras-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ras expirée 2 000,00`, ras2.includes('2 000,00 MAD') && ras2.includes('10 000,00 MAD'), ras2);
        await page.locator('[data-role="load-example"]').click();
        await page.locator('[data-role="cash-form"] button[type="submit"]').click();
        await page.locator('[data-role="cash-results"]').waitFor({ state: 'visible', timeout: 3000 });
        const cash = (await page.locator('[data-role="cash-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} espèces D-20 excédent 2 800,00`, cash.includes('2 800,00 MAD') && cash.includes('2 333,33 MAD') && cash.includes('466,67 MAD'), cash.slice(0, 300));
        const entryRows = await page.locator('[data-role="cash-entry"] tbody tr').count();
        check(`${tag} écriture présentée`, entryRows >= 4, String(entryRows));
        const cashScroll = await page.locator('[data-role="cash-table"] .table-scroll').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, ox: getComputedStyle(n).overflowX }));
        check(`${tag} espèces tableau défilant`, cashScroll.ox === 'auto', JSON.stringify(cashScroll));
        const rasOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} ras pas de défilement horizontal`, rasOverflow <= 1, String(rasOverflow));
        await page.screenshot({ path: `${outDir}/${tag}-ras.png`, fullPage: true });

        // ---- Auto-entrepreneur : IR trimestriel, comparaison, seuil par client (VEC-CGI-04) ----
        await page.goto(`${base}/${locale}/outils/simulateur-auto-entrepreneur`, { waitUntil: 'networkidle' });
        await page.locator('#ae-revenue').fill('50000');
        await page.locator('[data-role="ir-form"] button[type="submit"]').click();
        await page.locator('[data-role="ir-results"]').waitFor({ state: 'visible', timeout: 3000 });
        const aeIr = (await page.locator('[data-role="ir-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ae IR 0,5 % de 50 000 = 250,00`, aeIr.includes('250,00 MAD') && aeIr.includes('1 000,00 MAD'), aeIr.slice(0, 300));
        check(`${tag} ae règle datée et état affichés`, aeIr.includes('2026-11-13') && aeIr.includes('NON RECOUPÉ'), aeIr.slice(-300));
        await page.selectOption('#ae-rate', 'custom');
        await page.locator('#ae-custom-rate').fill('1,25');
        await page.locator('#ae-costs').fill('6000');
        await page.locator('[data-role="ir-form"] button[type="submit"]').click();
        const aeCustom = (await page.locator('[data-role="ir-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ae taux saisi 1,25 % = 625,00 et marqué non recoupé`, aeCustom.includes('625,00 MAD') && aeCustom.includes('NON RECOUPÉ'), aeCustom.slice(0, 300));
        await page.locator('#ae-prior').fill('75000');
        await page.locator('#ae-invoice').fill('12000');
        await page.locator('[data-role="thr-form"] button[type="submit"]').click();
        await page.locator('[data-role="thr-results"]').waitFor({ state: 'visible', timeout: 3000 });
        const aeThr = (await page.locator('[data-role="thr-results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} ae VEC-CGI-04 surplus 7 000,00, retenue 2 100,00, net 9 900,00`, aeThr.includes('7 000,00 MAD') && aeThr.includes('2 100,00 MAD') && aeThr.includes('9 900,00 MAD'), aeThr.slice(0, 300));
        const aeAlert = await page.locator('[data-role="thr-list"] [role="alert"]').count();
        check(`${tag} ae alerte de retenue annoncée`, aeAlert === 1, String(aeAlert));
        await page.locator('#ae-invoice').fill('0');
        await page.locator('[data-role="thr-form"] button[type="submit"]').click();
        check(`${tag} ae erreur de saisie annoncée`, (await page.locator('[data-role="thr-error"]').innerText()).length > 5);
        const aeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} ae pas de défilement horizontal`, aeOverflow <= 1, String(aeOverflow));
        await page.screenshot({ path: `${outDir}/${tag}-ae.png`, fullPage: true });

        // ---- Mowakaba : éligibilité et reste à charge ----
        await page.goto(`${base}/${locale}/outils/subvention-mowakaba`, { waitUntil: 'networkidle' });
        await page.locator('#mow-revenue').fill('12000000');
        await page.locator('form button[type="submit"]').click();
        await page.locator('[data-role="results"]').waitFor({ state: 'visible', timeout: 3000 });
        const mow = (await page.locator('[data-role="results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} mowakaba TPME 1 800,00 à 3 600,00`, mow.includes('1 800,00 MAD') && mow.includes('3 600,00 MAD'), mow.slice(0, 300));
        check(`${tag} mowakaba règle datée et état affichés`, mow.includes('2026-11-13') && mow.includes('NON RECOUPÉ'), mow.slice(-300));
        await page.selectOption('#mow-pack', { index: 1 });
        await page.locator('form button[type="submit"]').click();
        const mowCab = (await page.locator('[data-role="results"]').innerText()).replace(/\s+/g, ' ');
        check(`${tag} mowakaba Fiduciaire 4 500,00 à 9 000,00`, mowCab.includes('4 500,00 MAD') && mowCab.includes('9 000,00 MAD'), mowCab.slice(0, 300));
        const mowScroll = await page.locator('[data-role="table"] .table-scroll').evaluate((n) => ({ ox: getComputedStyle(n).overflowX }));
        check(`${tag} mowakaba tableau défilant`, mowScroll.ox === 'auto', JSON.stringify(mowScroll));
        await page.locator('#mow-revenue').fill('200000000');
        await page.locator('form button[type="submit"]').click();
        const mowBorder = await page.locator('[data-role="list"] [role="alert"]').count();
        check(`${tag} mowakaba borne 200 M MAD incluse = éligible (pas d’alerte)`, mowBorder === 0, String(mowBorder));
        await page.locator('#mow-revenue').fill('200000000,01');
        await page.locator('form button[type="submit"]').click();
        const mowOver = await page.locator('[data-role="list"] [role="alert"]').count();
        check(`${tag} mowakaba 200 M MAD + 1 centime = non éligible (alerte)`, mowOver === 1, String(mowOver));
        const mowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} mowakaba pas de défilement horizontal`, mowOverflow <= 1, String(mowOverflow));
        await page.screenshot({ path: `${outDir}/${tag}-mowakaba.png`, fullPage: true });

        check(`${tag} aucune requête hors origine`, foreign.length === 0, foreign.join(', '));
        check(`${tag} aucune erreur console`, errors.length === 0, errors.join(' | '));
        const cookies = await context.cookies();
        check(`${tag} aucun cookie`, cookies.length === 0, JSON.stringify(cookies));
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

for (const c of checks) process.stdout.write(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.ok ? '' : ` :: ${c.detail}`}\n`);
process.stdout.write(`\n${String(checks.length - failures.length)}/${String(checks.length)} contrôles passés\n`);
process.exit(failures.length === 0 ? 0 : 1);
