import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(5173, '127.0.0.1', resolve));
console.log('Inline static server listening on http://127.0.0.1:5173');

const BASE = 'http://127.0.0.1:5173';
const results = [];

function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ` (${extra})` : ''));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

// ---- محاكاة استجابات /api/verify على مستوى الشبكة (وليس داخل كود
// التطبيق) — الواجهة الأمامية تستخدم LiveAnalysisEngine الحقيقي دائمًا
// وتستدعي '/api/verify' فعليًا؛ هنا فقط نعترض تلك الاستدعاءات
// الشبكية على مستوى المتصفح (كما يفعل أي اختبار واجهة حقيقي لا يريد
// الاعتماد على اتصال إنترنت فعلي) لجعل نتائج الواجهة قابلة للتنبؤ.
// خط الأنابيب الحقيقي نفسه (DNS/HTTP/SSRF) مُختبر بشكل منفصل ومباشر
// في tests/e2e-production-integration.mjs وworker/test/*.
function riskReport(level, score, domain) {
  const titles = { green: 'لم تظهر مؤشرات خطر واضحة', yellow: 'يحتاج إلى تحقق', red: 'خطر محتمل' };
  return {
    level,
    score,
    domain,
    checks: {
      domain: [{ ok: true, label: 'فحص تجريبي للواجهة' }],
      redirects: [{ ok: null, label: 'لا توجد بيانات تحويلات لهذا الاختبار' }],
      phishing: [{ ok: level !== 'red', label: 'مؤشر تجريبي' }],
    },
    reasons: [titles[level]],
    recommendation: ['توصية تجريبية للواجهة'],
  };
}
await page.route('**/api/verify', async (route) => {
  const body = route.request().postDataJSON();
  const input = body?.input || '';
  let payload;
  if (input.includes('127.0.0.1') || input.includes('localhost')) {
    payload = { kind: 'failure', error: { category: 'SSRF_REJECTED', userMessage: 'تمت رفض هذا العنوان لأنه يشير إلى شبكة داخلية أو محلية، ولا يمكن فحصه.', retryable: false, technicalCode: 'SSRF_REJECTED' } };
  } else if (input.includes('paypa1') || input.includes('.tk')) {
    payload = { kind: 'success', result: riskReport('red', 15, 'paypa1-secure-verify.tk') };
  } else if (input.includes('apple.com') || input.includes('google.com')) {
    payload = { kind: 'success', result: riskReport('green', 95, new URL(input).hostname) };
  } else if (input.includes('cancel-test')) {
    // تأخير متعمّد لاختبار مسار الإلغاء أثناء انتظار الشبكة فعليًا
    await new Promise((r) => setTimeout(r, 3000));
    payload = { kind: 'success', result: riskReport('yellow', 50, 'some-cancel-test-domain.com') };
  } else {
    payload = { kind: 'success', result: riskReport('yellow', 50, new URL(input).hostname) };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
});

// 1) Home page loads, no JS errors
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 10000 });
check('index.html loads without uncaught JS errors', consoleErrors.length === 0, consoleErrors.join(' | '));

// 2) Onboarding modal is visible on first load
const onboardingVisible = await page.locator('#onboarding-overlay.active').count();
check('onboarding modal shown on first visit', onboardingVisible === 1);

// 3) Accept button disabled until checkbox checked
const acceptDisabledBefore = await page.locator('#onboarding-accept').isDisabled();
check('accept button disabled before checking consent box', acceptDisabledBefore === true);
await page.check('#onboarding-checkbox');
const acceptDisabledAfter = await page.locator('#onboarding-accept').isDisabled();
check('accept button enabled after checking consent box', acceptDisabledAfter === false);
await page.click('#onboarding-accept');
await page.waitForTimeout(150);
const onboardingHiddenAfter = await page.locator('#onboarding-overlay.active').count();
check('onboarding modal closes after accepting', onboardingHiddenAfter === 0);

// 4) Reload -> onboarding should NOT show again (localStorage persisted)
await page.reload({ waitUntil: 'load', timeout: 10000 });
const onboardingAfterReload = await page.locator('#onboarding-overlay.active').count();
check('onboarding does not reappear after reload (terms persisted in localStorage)', onboardingAfterReload === 0);

// 5) Home screen visible, hero title correct
const heroText = await page.locator('#home-title').textContent();
check('hero title renders correctly', heroText.trim() === 'افحص قبل أن تثق.', heroText);

// 6) Submit a TRUSTED url -> expect GREEN result
await page.fill('#url-input', 'https://www.apple.com/sa');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-result.active', { timeout: 8000 });
const resultBadgeGreen = await page.locator('#result-content .risk-badge').first().textContent();
check('trusted domain produces green "no obvious risk" result', resultBadgeGreen.includes('لم تظهر مؤشرات خطر واضحة'), resultBadgeGreen);
const hasSimulatedBadge = await page.locator('#result-content .badge-simulated').count();
check('NO "Simulated/Demo" badge in production (real LiveAnalysisEngine is active)', hasSimulatedBadge === 0);

// 7) Go home, submit a RED (suspicious) url
await page.locator('#result-content button:has-text("العودة إلى الرئيسية")').click();
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'https://paypa1-secure-verify.tk/login');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-result.active', { timeout: 8000 });
const resultBadgeRed = await page.locator('#result-content .risk-badge').first().textContent();
check('suspicious lookalike url produces "potential risk" (red) result', resultBadgeRed.includes('خطر محتمل'), resultBadgeRed);

// 8) "How did we know" expands check sections
await page.locator('#result-content button:has-text("كيف عرفنا")').click();
const checkSections = await page.locator('#result-content .check-section').count();
check('"how did we know" reveals 3 check sections (domain/redirects/phishing)', checkSections === 3, String(checkSections));

// 9) Go home, submit an SSRF-blocked url -> expect error screen, not a risk score
await page.locator('#result-content button:has-text("العودة إلى الرئيسية")').click();
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'http://127.0.0.1/admin');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-error.active', { timeout: 8000 });
const errorText = await page.locator('#error-content').textContent();
check('SSRF-target url is rejected as an error, not analyzed as a risk score', errorText.includes('شبكة داخلية') || errorText.includes('محلية'), errorText.slice(0, 80));

// 10) History screen shows the trusted + red scans (2 entries; SSRF rejection not saved)
await page.locator('#error-content button:has-text("العودة إلى الرئيسية")').click();
await page.waitForSelector('#screen-home.active');
await page.click('#open-history-btn');
await page.waitForSelector('#screen-history.active');
const historyRows = await page.locator('#history-list .history-row').count();
check('history contains exactly 2 entries (SSRF-rejected attempt correctly excluded)', historyRows === 2, String(historyRows));

// 11) Open a history entry -> detail screen shows summary, and verify no raw URL leaked into the page HTML
await page.locator('#history-list .history-row').first().click();
await page.waitForSelector('#screen-history-detail.active');
const detailHtml = await page.locator('#history-detail-content').innerHTML();
check('history detail screen renders without containing the raw scanned URL text', !detailHtml.includes('paypa1') && !detailHtml.includes('apple.com'), 'leak-check');

// 12) Delete single entry
await page.click('#history-detail-back-btn');
await page.waitForSelector('#screen-history.active');
await page.locator('#history-list .history-row').first().locator('[aria-label="حذف العملية"]').click();
await page.waitForTimeout(150);
const historyRowsAfterDelete = await page.locator('#history-list .history-row').count();
check('deleting a single history entry reduces count by exactly 1', historyRowsAfterDelete === 1, String(historyRowsAfterDelete));

// 13) Delete all history via confirm modal
await page.click('#history-delete-all-btn');
await page.waitForSelector('#confirm-modal.active');
await page.click('#confirm-modal .modal-confirm-btn');
await page.waitForTimeout(150);
const emptyStateVisible = await page.locator('#history-list .empty-state').count();
check('deleting all history shows the empty state', emptyStateVisible === 1);

// 14) Cancellation flow: start analysis, cancel mid-flight
await page.click('#history-back-btn');
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'https://some-cancel-test-domain.com');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-analyzing.active');
await page.click('#cancel-analysis-btn');
await page.waitForTimeout(200);
const backOnHomeAfterCancel = await page.locator('#screen-home.active').count();
check('cancelling analysis returns to home screen', backOnHomeAfterCancel === 1);

// 15) Settings screen: offline simulation toggle + engine mode badge text
await page.click('#open-settings-btn');
await page.waitForSelector('#screen-settings.active');
const engineInfoText = await page.locator('#settings-engine-info').textContent();
check('settings screen clearly shows the real Live engine (not simulated)', engineInfoText.includes('محرك حقيقي') && engineInfoText.includes('live-worker-v1'), engineInfoText);
await page.check('#offline-simulation-toggle');
await page.click('#settings-back-btn');
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'https://www.google.com');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-error.active', { timeout: 8000 });
const offlineErrorText = await page.locator('#error-content').textContent();
check(
  'real Live engine correctly BLOCKS on simulated offline (never silently succeeds without network)',
  offlineErrorText.includes('الإنترنت') || offlineErrorText.includes('تعذر'),
  offlineErrorText.slice(0, 60)
);
// أعد إيقاف المحاكاة حتى لا تؤثر على الفحوصات التالية (SEO pages إلخ لا تتأثر أصلاً، لكن توضيحًا للنية)
await page.click('#error-content button:has-text("العودة إلى الرئيسية")');
await page.waitForSelector('#screen-home.active');
await page.click('#open-settings-btn');
await page.waitForSelector('#screen-settings.active');
await page.uncheck('#offline-simulation-toggle');
await page.click('#settings-back-btn');

// 16) Static SEO pages load correctly
for (const p of ['about.html', 'privacy.html', 'terms.html', 'security.html']) {
  const resp = await page.goto(BASE + '/' + p, { waitUntil: 'load', timeout: 10000 });
  check(`${p} returns HTTP 200`, resp.status() === 200);
  const h1 = await page.locator('h1').first().textContent();
  check(`${p} has a non-empty <h1>`, !!h1 && h1.trim().length > 0, h1);
}

// 17) manifest + service worker + robots + sitemap reachable
for (const p of ['manifest.webmanifest', 'service-worker.js', 'robots.txt', 'sitemap.xml']) {
  const resp = await page.goto(BASE + '/' + p);
  check(`${p} returns HTTP 200`, resp.status() === 200);
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log('\n=== SUMMARY ===');
console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
if (failed.length) {
  console.log('FAILED CHECKS:', failed.map((f) => f.name));
  process.exit(1);
}
process.exit(0);
