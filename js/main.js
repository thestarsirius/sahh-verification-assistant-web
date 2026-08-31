// ============================================================
// main.js
// نقطة الدخول للمتصفح (Composition Root للواجهة). يُنشئ
// AnalysisController مرة واحدة هنا فقط، ويربط كل عناصر DOM بأحداثها.
// لا يحتوي هذا الملف على أي منطق تحليل أو حساب مخاطر — فقط عرض وربط.
// ============================================================
import { AppConfig } from './core/config.js';
import { StorageService } from './core/storage.js';
import { TemporaryCache } from './core/cache.js';
import { BrowserConnectivityChecker, DebugOverridableConnectivityChecker } from './core/connectivity.js';
import { FeatureGate, PlanTier } from './core/feature-gate.js';
import { AnalysisController } from './app/analysis-controller.js';
import { CancellationToken } from './domain/cancellation-token.js';
import { isEngineSuccess } from './domain/i-analysis-engine.js';
import { QrScanner } from './ui/qr-scanner.js';
import {
  el,
  renderBadge,
  renderSimulatedBadge,
  renderScoreRing,
  renderInfoSection,
  renderCheckSection,
  renderHistoryRow,
  showToast,
} from './ui/render.js';

/* ---------------- Composition root ---------------- */
const storageService = new StorageService();
const connectivity = new DebugOverridableConnectivityChecker(new BrowserConnectivityChecker());
const featureGate = new FeatureGate({ tier: PlanTier.FREE });
const controller = new AnalysisController({
  engine: AppConfig.buildDefaultEngine(),
  storageService,
  cache: new TemporaryCache(),
  connectivity,
  featureGate,
});

/* ---------------- DOM refs ---------------- */
const screens = Object.fromEntries(
  ['home', 'qr', 'analyzing', 'result', 'error', 'history', 'history-detail', 'settings'].map((id) => [
    id,
    document.getElementById(`screen-${id}`),
  ])
);
const announcer = document.getElementById('a11y-announcer');
const onboardingOverlay = document.getElementById('onboarding-overlay');
const onboardingAccept = document.getElementById('onboarding-accept');
const onboardingCheckbox = document.getElementById('onboarding-checkbox');
const confirmModal = document.getElementById('confirm-modal');

let currentCancelToken = null;
let lastAttempt = null; // { rawInput, sourceType } — لإعادة المحاولة فقط، غير مُخزَّن أبداً

function announce(text) {
  if (announcer) announcer.textContent = text;
}

function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) {
    if (!node) continue;
    node.classList.toggle('active', key === name);
  }
  const heading = screens[name]?.querySelector('h1, h2, .screen-title');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Onboarding ---------------- */
function initOnboarding() {
  if (storageService.getTermsAccepted()) {
    onboardingOverlay.classList.remove('active');
    return;
  }
  onboardingOverlay.classList.add('active');
}
onboardingCheckbox?.addEventListener('change', () => {
  onboardingAccept.disabled = !onboardingCheckbox.checked;
});
onboardingAccept?.addEventListener('click', () => {
  storageService.setTermsAccepted(true);
  onboardingOverlay.classList.remove('active');
  announce('تم قبول الشروط. يمكنك الآن استخدام التطبيق.');
});

/* ---------------- Analysis flow (shared by URL + QR) ---------------- */
async function runAnalysisFlow(rawInput, sourceType) {
  lastAttempt = { rawInput, sourceType };
  const token = new CancellationToken();
  currentCancelToken = token;
  showScreen('analyzing');
  announce('جاري التحليل، الرجاء الانتظار');
  animateAnalyzingSteps();

  const outcome = await controller.runAnalysis({ rawInput, sourceType, cancelToken: token });

  // إذا أُلغيت هذه العملية تحديدًا، يكون المستخدم قد غادر الشاشة بالفعل
  // (زر الإلغاء نقله للرئيسية فوراً) — لا نفرض أي انتقال شاشة متأخر هنا.
  if (token.isCancelled) return;

  if (isEngineSuccess(outcome)) {
    renderResultScreen(outcome.result);
    showScreen('result');
    announce('اكتمل التحليل. ' + outcome.result.level);
  } else {
    renderErrorScreen(outcome.error);
    showScreen('error');
    announce('تعذر إتمام الفحص: ' + outcome.error.userMessage);
  }
}

const ANALYZING_STEPS = ['التحقق من المدخل', 'تحليل الرابط', 'التحقق من الوجهة', 'تحليل مؤشرات الخطر', 'إعداد النتيجة'];
let analyzingTimer = null;
function animateAnalyzingSteps() {
  const list = document.getElementById('analyzing-steps-list');
  if (!list) return;
  list.innerHTML = '';
  ANALYZING_STEPS.forEach((s) => list.appendChild(el('div', {}, [s])));
  let i = 0;
  clearInterval(analyzingTimer);
  analyzingTimer = setInterval(() => {
    const rows = list.children;
    if (i < rows.length) rows[i].classList.add('done');
    i++;
    if (i >= rows.length) clearInterval(analyzingTimer);
  }, 400);
}

document.getElementById('cancel-analysis-btn')?.addEventListener('click', () => {
  currentCancelToken?.cancel();
  clearInterval(analyzingTimer);
  showScreen('home');
  showToast('تم إلغاء التحليل');
});

/* ---------------- URL form (home) ---------------- */
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
urlForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = urlInput.value.trim();
  if (!value) return;
  runAnalysisFlow(value, 'url');
});

/* ---------------- QR scanning ---------------- */
const qrVideo = document.getElementById('qr-video');
const qrFallback = document.getElementById('qr-fallback');
const qrPlaceholder = document.getElementById('qr-placeholder');
let scanner = null;

document.getElementById('open-qr-btn')?.addEventListener('click', () => startQrScreen());
document.getElementById('qr-manual-entry-btn')?.addEventListener('click', () => {
  stopQrScreen();
  showScreen('home');
  urlInput?.focus();
});
document.getElementById('qr-back-btn')?.addEventListener('click', () => {
  stopQrScreen();
  showScreen('home');
});

async function startQrScreen() {
  showScreen('qr');
  qrFallback.hidden = true;
  qrPlaceholder.hidden = false;
  qrVideo.hidden = true;

  if (!QrScanner.isSupported()) {
    showQrFallback('camera-unsupported');
    return;
  }

  scanner = new QrScanner(qrVideo);
  await scanner.start({
    onDetected: (text) => {
      stopQrScreen();
      runAnalysisFlow(text, 'qr');
    },
    onUnavailable: (reason) => showQrFallback(reason),
  });
  if (scanner) {
    qrPlaceholder.hidden = true;
    qrVideo.hidden = false;
  }
}

function showQrFallback(reason) {
  const messages = {
    'camera-unsupported': 'متصفحك لا يدعم الوصول إلى الكاميرا لمسح رموز QR.',
    'barcode-detector-unsupported': 'متصفحك لا يدعم قراءة رموز QR تلقائياً حالياً.',
    'permission-denied': 'تم رفض إذن الوصول إلى الكاميرا.',
  };
  qrPlaceholder.hidden = true;
  qrVideo.hidden = true;
  qrFallback.hidden = false;
  qrFallback.querySelector('.qr-fallback-message').textContent =
    messages[reason] || 'تعذّر تشغيل الكاميرا على هذا الجهاز.';
}

function stopQrScreen() {
  scanner?.stop();
  scanner = null;
}

/* ---------------- Result screen rendering ---------------- */
function renderResultScreen(report) {
  const root = document.getElementById('result-content');
  root.innerHTML = '';
  const wrap = el('div', { class: 'result-wrap' });

  if (controller.isSimulatedMode) wrap.appendChild(renderSimulatedBadge());
  wrap.appendChild(renderBadge(report.level));
  wrap.appendChild(renderScoreRing(report.score, report.level));
  if (report.domain) wrap.appendChild(el('div', { class: 'domain-chip' }, [report.domain]));

  wrap.appendChild(renderInfoSection('لماذا ظهرت هذه النتيجة؟', report.reasons));
  wrap.appendChild(renderInfoSection('ماذا أنصحك؟', report.recommendation));

  const howBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, ['كيف عرفنا؟ عرض تفاصيل التحليل']);
  const howDetails = el(
    'div',
    { hidden: 'hidden', style: 'display:flex;flex-direction:column;gap:12px;width:100%;margin-top:10px;' },
    [
      renderCheckSection('تحليل النطاق', '🌐', report.checks.domain || []),
      renderCheckSection('التحويلات', '🔁', report.checks.redirects || []),
      renderCheckSection('مؤشرات التصيّد', '🎣', report.checks.phishing || []),
    ]
  );
  howBtn.addEventListener('click', () => {
    howDetails.hidden = !howDetails.hidden;
    howBtn.textContent = howDetails.hidden ? 'كيف عرفنا؟ عرض تفاصيل التحليل' : 'إخفاء التفاصيل';
  });
  wrap.appendChild(howBtn);
  wrap.appendChild(howDetails);

  wrap.appendChild(
    el('div', { class: 'result-disclaimer' }, [
      'ℹ️ ',
      controller.isSimulatedMode
        ? 'هذه نتيجة تحليل محاكاة (Mock) لأغراض العرض، وليست فحصاً أمنياً حقيقياً عبر خدمة تهديدات فعلية.'
        : 'هذا التطبيق أداة مساعدة، ولا يشكل حكماً نهائياً على أمان الرابط.',
    ])
  );

  const homeBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, ['العودة إلى الرئيسية']);
  homeBtn.addEventListener('click', () => showScreen('home'));
  wrap.appendChild(homeBtn);

  root.appendChild(wrap);
}

/* ---------------- Error screen rendering ---------------- */
const ERROR_ICONS = {
  EMPTY_INPUT: '✏️',
  INVALID_URL: '🔗',
  UNSUPPORTED_SCHEME: '🔗',
  URL_TOO_LONG: '🔗',
  SSRF_REJECTED: '🚫',
  OFFLINE: '📡',
  TIMEOUT: '⏱️',
  NETWORK_FAILURE: '📡',
  BACKEND_MISCONFIGURED: '🛠️',
  PROVIDER_UNAVAILABLE: '🛠️',
  CANCELLED: '✋',
  DAILY_LIMIT_REACHED: '📊',
};

function renderErrorScreen(error) {
  const root = document.getElementById('error-content');
  root.innerHTML = '';
  const wrap = el('div', { class: 'result-wrap' });
  wrap.appendChild(el('div', { style: 'font-size:40px;' }, [ERROR_ICONS[error.category] || '⚪']));
  wrap.appendChild(el('h2', { class: 'screen-title' }, ['تعذر الفحص']));
  wrap.appendChild(
    el('p', { style: 'color:var(--text-dim);font-size:13.5px;line-height:1.8;white-space:pre-line;' }, [error.userMessage])
  );

  if (error.retryable) {
    const retryBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, ['إعادة المحاولة']);
    retryBtn.addEventListener('click', () => {
      if (lastAttempt) runAnalysisFlow(lastAttempt.rawInput, lastAttempt.sourceType);
    });
    wrap.appendChild(retryBtn);
  }
  const homeBtn = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, ['العودة إلى الرئيسية']);
  homeBtn.addEventListener('click', () => showScreen('home'));
  wrap.appendChild(homeBtn);

  root.appendChild(wrap);
}

/* ---------------- History ---------------- */
document.getElementById('open-history-btn')?.addEventListener('click', () => {
  renderHistoryList();
  showScreen('history');
});
document.getElementById('history-back-btn')?.addEventListener('click', () => showScreen('home'));
document.getElementById('history-detail-back-btn')?.addEventListener('click', () => showScreen('history'));

function renderHistoryList() {
  const listEl = document.getElementById('history-list');
  const deleteAllBtn = document.getElementById('history-delete-all-btn');
  const items = storageService.getHistory();
  listEl.innerHTML = '';

  if (items.length === 0) {
    deleteAllBtn.hidden = true;
    listEl.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { style: 'font-size:30px;' }, ['🕘']),
        el('p', {}, ['لا توجد عمليات تحقق بعد']),
        el('span', {}, ['ستظهر هنا نتائج فحوصاتك بشكل مختصر — دون أي روابط أو صور خام']),
      ])
    );
    return;
  }

  deleteAllBtn.hidden = false;
  for (const entry of items) {
    listEl.appendChild(
      renderHistoryRow(entry, {
        onOpen: (e) => openHistoryDetail(e),
        onDelete: (id) => {
          storageService.deleteEntry(id);
          renderHistoryList();
          showToast('تم حذف العملية');
        },
      })
    );
  }
}

function openHistoryDetail(entry) {
  const root = document.getElementById('history-detail-content');
  root.innerHTML = '';
  const wrap = el('div', { class: 'result-wrap' });
  wrap.appendChild(renderBadge(entry.level));
  wrap.appendChild(renderScoreRing(entry.score, entry.level));
  const date = new Date(entry.timestamp);
  wrap.appendChild(
    el('span', { class: 'history-date' }, [
      `${date.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' })} · ${entry.type === 'qr' ? 'مسح QR' : 'فحص رابط'}`,
    ])
  );
  wrap.appendChild(renderInfoSection('لماذا ظهرت هذه النتيجة؟', entry.reasons));
  wrap.appendChild(renderInfoSection('ماذا أنصحك؟', entry.recommendation));
  wrap.appendChild(renderCheckSection('تحليل النطاق', '🌐', entry.checks.domain || []));
  wrap.appendChild(renderCheckSection('التحويلات', '🔁', entry.checks.redirects || []));
  wrap.appendChild(renderCheckSection('مؤشرات التصيّد', '🎣', entry.checks.phishing || []));
  wrap.appendChild(
    el('div', { class: 'privacy-note' }, ['🔒 لا يتم حفظ الرابط أو الصورة الأصلية ضمن هذا السجل — فقط ملخص نتيجة التحليل.'])
  );
  root.appendChild(wrap);
  showScreen('history-detail');
}

document.getElementById('history-delete-all-btn')?.addEventListener('click', () => {
  openConfirmModal({
    title: 'حذف كامل السجل؟',
    message: 'سيتم حذف جميع نتائج الفحص المحفوظة محلياً على جهازك. لا يمكن التراجع عن هذا الإجراء.',
    confirmLabel: 'حذف الكل',
    onConfirm: () => {
      storageService.deleteAllHistory();
      renderHistoryList();
      refreshSettingsUsage();
      showToast('تم حذف كامل السجل');
    },
  });
});

/* ---------------- Settings ---------------- */
document.getElementById('open-settings-btn')?.addEventListener('click', () => {
  refreshSettingsUsage();
  showScreen('settings');
});
document.getElementById('settings-back-btn')?.addEventListener('click', () => showScreen('home'));
document.getElementById('settings-history-row')?.addEventListener('click', () => {
  renderHistoryList();
  showScreen('history');
});
document.getElementById('settings-delete-all-row')?.addEventListener('click', () => {
  document.getElementById('history-delete-all-btn')?.click();
});

function refreshSettingsUsage() {
  const engineInfo = document.getElementById('settings-engine-info');
  const usageInfo = document.getElementById('settings-usage-info');
  if (engineInfo) {
    engineInfo.textContent = controller.isSimulatedMode
      ? `🧪 وضع تجريبي (Development/Demo) — Simulated · ${controller.engine.engineId}`
      : `محرك حقيقي (Live) · ${controller.engine.engineId}`;
  }
  if (usageInfo) {
    const used = featureGate.getTodayUsage();
    const limit = featureGate.limits.dailyScanLimit;
    usageInfo.textContent = `الخطة: مجانية (Free) — ${used}/${limit === Infinity ? '∞' : limit} فحص اليوم`;
  }
}

const offlineToggle = document.getElementById('offline-simulation-toggle');
offlineToggle?.addEventListener('change', () => {
  connectivity.forceOffline = offlineToggle.checked;
  showToast(offlineToggle.checked ? 'تم تفعيل محاكاة عدم الاتصال' : 'تم إيقاف محاكاة عدم الاتصال');
});

/* ---------------- Confirm modal (shared) ---------------- */
function openConfirmModal({ title, message, confirmLabel, onConfirm }) {
  confirmModal.querySelector('.modal-title').textContent = title;
  confirmModal.querySelector('.modal-message').textContent = message;
  const confirmBtn = confirmModal.querySelector('.modal-confirm-btn');
  confirmBtn.textContent = confirmLabel;
  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.replaceWith(newBtn);
  newBtn.addEventListener('click', () => {
    onConfirm();
    confirmModal.classList.remove('active');
  });
  confirmModal.classList.add('active');
}
document.querySelectorAll('.modal-cancel-btn').forEach((btn) =>
  btn.addEventListener('click', () => confirmModal.classList.remove('active'))
);

/* ---------------- Init ---------------- */
initOnboarding();
showScreen('home');

/* Service worker registration — app-shell only, never caches raw scan content */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // فشل التسجيل لا يجب أن يمنع استخدام التطبيق نفسه
    });
  });
}
