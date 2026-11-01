// Lighthouse on the public pages, as a phone (Lighthouse's default: a mid-range phone on a slow 4G
// connection). Run against a local production build:
//   pnpm build && pnpm start     (one terminal)
//   pnpm lighthouse              (another)
// Fails if any page scores under 90 for performance, accessibility, best practices or SEO.
// Scores from `next start` on one laptop are a guide: the real check is the same run against the
// deployed site (BASE_URL=https://... pnpm lighthouse) before launch.
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const MIN_SCORE = Number(process.env.LIGHTHOUSE_MIN ?? 90);
const PORT = 9222;
const PAGES = ['/', '/services', '/branches', '/branches/branch-one', '/offers', '/book', '/privacy', '/terms'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

// Locally use the Chrome that is already installed; CI installs Playwright's own Chromium.
const browser = await chromium.launch({
  args: [`--remote-debugging-port=${PORT}`],
  ...(process.env.CI ? {} : { channel: 'chrome' }),
});

const rows = [];
try {
  for (const path of PAGES) {
    const run = await lighthouse(`${BASE}${path}`, {
      port: PORT,
      output: 'json',
      logLevel: 'error',
      onlyCategories: CATEGORIES,
    });
    const { categories, audits } = run.lhr;
    rows.push({
      path,
      scores: Object.fromEntries(CATEGORIES.map((c) => [c, Math.round((categories[c].score ?? 0) * 100)])),
      lcp: Math.round(audits['largest-contentful-paint'].numericValue),
      cls: Number(audits['cumulative-layout-shift'].numericValue.toFixed(3)),
      tbt: Math.round(audits['total-blocking-time'].numericValue),
    });
  }
} finally {
  await browser.close();
}

console.log(`\n${'page'.padEnd(24)}perf  a11y  best  seo   LCP(ms)  CLS    TBT(ms)`);
let failed = 0;
for (const r of rows) {
  const s = r.scores;
  console.log(
    `${r.path.padEnd(24)}${String(s.performance).padEnd(6)}${String(s.accessibility).padEnd(6)}` +
      `${String(s['best-practices']).padEnd(6)}${String(s.seo).padEnd(6)}${String(r.lcp).padEnd(9)}${String(r.cls).padEnd(7)}${r.tbt}`,
  );
  for (const [category, score] of Object.entries(s)) {
    if (score < MIN_SCORE) {
      failed += 1;
      console.log(`  FAIL ${r.path}: ${category} ${score} is under ${MIN_SCORE}`);
    }
  }
}
console.log(failed === 0 ? `\nEvery page scores ${MIN_SCORE}+ in every category.` : `\n${failed} score(s) under ${MIN_SCORE}.`);
process.exit(failed === 0 ? 0 : 1);
