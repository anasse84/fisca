/**
 * Contrôle Lighthouse (ERRATA D-14) : 3 passes par page, médiane de chacune des 4 catégories, exigence au moins 98.
 * Entre 95 et 97 le critère perd des points ; sous 95 : clause éliminatoire. Sortie 0 seulement si toutes les médianes sont >= 98.
 * Usage (build de production sous workerd) :
 *   pnpm build && npx wrangler pages dev dist --port 4400 --ip 127.0.0.1 &
 *   CHROME_PATH=<chrome Playwright> node e2e/lighthouse-check.ts http://127.0.0.1:4400 fr/ fr/tarifs en/
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4400';
const pages = process.argv.length > 3 ? process.argv.slice(3) : ['fr/', 'fr/tarifs', 'en/'];
const PASSES = 3;
const MIN = 98;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
const outDir = '/tmp/fisca-lighthouse';
mkdirSync(outDir, { recursive: true });

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

let failed = false;
for (const page of pages) {
  const scores: Record<string, number[]> = { performance: [], accessibility: [], 'best-practices': [], seo: [] };
  for (let pass = 1; pass <= PASSES; pass += 1) {
    const out = `${outDir}/${page.replace(/\W+/g, '_')}-${pass}.json`;
    execFileSync(
      'npx',
      ['lighthouse', `${base}/${page}`, '--quiet', '--chrome-flags=--headless --no-sandbox', `--only-categories=${CATEGORIES.join(',')}`, '--output=json', `--output-path=${out}`],
      { stdio: 'ignore' },
    );
    const report = JSON.parse(readFileSync(out, 'utf8')) as { categories: Record<string, { score: number }> };
    for (const category of CATEGORIES) scores[category]?.push(Math.round((report.categories[category]?.score ?? 0) * 100));
  }
  const medians = CATEGORIES.map((category) => `${category} ${median(scores[category] ?? [])}`);
  const ok = CATEGORIES.every((category) => median(scores[category] ?? []) >= MIN);
  if (!ok) failed = true;
  process.stdout.write(`${ok ? "OK " : "KO "} ${page} : ${medians.join(", ")}\n`);
}
process.exit(failed ? 1 : 0);
