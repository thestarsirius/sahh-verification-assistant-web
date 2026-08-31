// ============================================================
// service-worker.js
// يخزّن مؤقتاً "قشرة التطبيق" الثابتة فقط (HTML/CSS/JS/الأيقونات)
// لتحسين سرعة التحميل والعمل شبه-دون-اتصال. لا يخزّن أبداً:
//   - الروابط التي يُدخلها المستخدم (لا توجد طلبات شبكة لها أصلاً)
//   - محتوى QR الممسوح
//   - أي استجابة من fetch لا تنتمي لقائمة الملفات الثابتة أدناه
// ============================================================
const CACHE_NAME = 'sahh-app-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './about.html',
  './privacy.html',
  './terms.html',
  './security.html',
  './css/styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/core/models.js',
  './js/core/analysis-error.js',
  './js/core/cache.js',
  './js/core/logger.js',
  './js/core/connectivity.js',
  './js/core/storage.js',
  './js/core/config.js',
  './js/core/feature-gate.js',
  './js/domain/cancellation-token.js',
  './js/domain/i-analysis-engine.js',
  './js/url/validator.js',
  './js/url/normalizer.js',
  './js/url/canonicalizer.js',
  './js/url/ssrf-guard.js',
  './js/engine/risk-engine.js',
  './js/engine/mock-engine.js',
  './js/engine/live-engine.js',
  './js/net/threat-intelligence-provider.js',
  './js/net/redirect-resolver.js',
  './js/app/analysis-controller.js',
  './js/ui/render.js',
  './js/ui/qr-scanner.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// استراتيجية Cache-first للملفات الثابتة المعروفة فقط (نفس الأصل GET).
// أي طلب آخر (بما يشمل أي محاولة مستقبلية لتحليل حقيقي عبر الشبكة)
// يمر مباشرة إلى الشبكة دون أي محاولة تخزين مؤقت له هنا.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => cached);
    })
  );
});
