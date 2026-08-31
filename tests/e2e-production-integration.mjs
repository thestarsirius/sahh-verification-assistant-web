// ============================================================
// e2e-production-integration.mjs
// اختبار تكامل حقيقي: الواجهة الأمامية الفعلية (index.html + main.js)
// + Cloudflare Pages Function الفعلية (functions/api/verify.js) —
// متصلان عبر HTTP حقيقي بينهما، بالضبط كما سيحدث بعد النشر الفعلي.
//
// القيد الوحيد والموثّق بأمانة: هذه البيئة (Sandbox) لا تملك اتصال
// إنترنت خارجي، لذلك لا يمكن إجراء استعلام DNS-over-HTTPS حقيقي نحو
// cloudflare-dns.com أو طلب HTTP حقيقي نحو مواقع الإنترنت الفعلية.
// لذلك — ولهذا فقط — نُموّه (mock) طبقة fetch() الخارجية على مستوى
// عملية Node هذه فقط، بينما يبقى الاتصال بين المتصفح والخادم المحلي،
// وبين الخادم المحلي ومعالج /api/verify الحقيقي، اتصالات HTTP حقيقية
// تمامًا بلا أي تمويه. هذا هو أقصى تكامل حقيقي يمكن إثباته دون شبكة.
// ============================================================
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from '../functions/api/verify.js';
import { onRequestGet as healthGet } from '../functions/api/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
};

// ---- الشبكة الخارجية فقط (DNS-over-HTTPS + مواقع الإنترنت الفعلية) مُموَّهة ----
// خرائط اختبار واقعية: نطاقات موثوقة، نطاق مشبوه، ونطاق SSRF.
const DNS_MAP = {
  'apple.com': '17.253.144.10',
  'paypa1-secure-verify.tk': '203.0.113.77',
};
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname === 'cloudflare-dns.com') {
    const name = u.searchParams.get('name');
    const type = u.searchParams.get('type');
    const ip = DNS_MAP[name];
    if (type === 'A' && ip) return new Response(JSON.stringify({ Answer: [{ type: 1, data: ip }] }), { status: 200 });
    return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
  }
  // أي "زيارة فعلية" لموقع الإنترنت الحقيقي (بعد اجتياز فحص SSRF) —
  // نُحاكي استجابة 200 عادية، تمامًا كما لو أن الموقع الحقيقي استجاب.
  return new Response('<html>mock external site body</html>', { status: 200 });
};

// ---- خادم محلي حقيقي: يخدم الواجهة الثابتة + يوجّه /api/* إلى الدوال الحقيقية ----
const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/api/verify' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request('http://127.0.0.1' + req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks),
    });
    const response = await onRequestPost({ request }); // ← الدالة الحقيقية الفعلية
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(await response.text());
    return;
  }
  if (urlPath === '/api/health' && req.method === 'GET') {
    const response = await healthGet();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(await response.text());
    return;
  }

  let filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(filePath, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(5176, '127.0.0.1', resolve));
console.log('Real frontend + real Pages Function integration server listening on http://127.0.0.1:5176');

const BASE = 'http://127.0.0.1:5176';
const results = [];
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ` (${extra})` : ''));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 10000 });
check('page loads with no uncaught JS errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await page.check('#onboarding-checkbox');
await page.click('#onboarding-accept');
await page.waitForTimeout(150);

// ---- المسار الكامل الحقيقي: مدخل → LiveAnalysisEngine → fetch('/api/verify') حقيقي → Pages Function حقيقية → DNS حقيقي (مموّه فقط لعدم توفر إنترنت) → RiskEngine → نتيجة ----
await page.fill('#url-input', 'https://apple.com/sa');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-result.active', { timeout: 10000 });
const greenBadge = await page.locator('#result-content .risk-badge').first().textContent();
check(
  'trusted URL through the REAL frontend→Worker→DNS→HTTP pipeline produces GREEN',
  greenBadge.includes('لم تظهر مؤشرات خطر واضحة'),
  greenBadge
);

// تأكيد: شارة "Simulated/Demo" يجب ألا تظهر إطلاقًا الآن (المحرك الحقيقي isSimulated=false)
const simulatedBadgeCount = await page.locator('#result-content .badge-simulated').count();
check('NO "Simulated/Demo" badge appears when using the real production engine', simulatedBadgeCount === 0);

// نطاق مشبوه عبر نفس المسار الحقيقي بالكامل
await page.locator('#result-content button:has-text("العودة إلى الرئيسية")').click();
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'https://paypa1-secure-verify.tk/login');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-result.active', { timeout: 10000 });
const redBadge = await page.locator('#result-content .risk-badge').first().textContent();
check('suspicious URL through the REAL pipeline produces RED', redBadge.includes('خطر محتمل'), redBadge);

// رابط SSRF عبر المسار الحقيقي بالكامل → يجب أن يُرفض دون أي محاولة زيارة فعلية
await page.locator('#result-content button:has-text("العودة إلى الرئيسية")').click();
await page.waitForSelector('#screen-home.active');
await page.fill('#url-input', 'http://127.0.0.1/admin');
await page.click('#url-form button[type=submit]');
await page.waitForSelector('#screen-error.active', { timeout: 10000 });
const errorText = await page.locator('#error-content').textContent();
check('SSRF target through the REAL pipeline is rejected as an error via the real backend', errorText.includes('شبكة داخلية') || errorText.includes('محلية'), errorText.slice(0, 60));

// التحقق من صحة /api/health عبر المتصفح فعليًا
const healthResp = await page.goto(BASE + '/api/health');
const healthBody = await healthResp.json();
check('/api/health reachable through real HTTP from the browser', healthBody.status === 'ok', JSON.stringify(healthBody));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log('\n=== PRODUCTION INTEGRATION SUMMARY ===');
console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name));
  process.exit(1);
}
process.exit(0);
