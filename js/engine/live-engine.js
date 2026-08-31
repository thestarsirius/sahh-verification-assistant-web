// ============================================================
// live-engine.js
// LiveAnalysisEngine — يستدعي فعليًا نقطة النهاية الحقيقية
// POST {apiBaseUrl}/verify التي يوفرها Cloudflare Worker
// (worker/src/index.js). هذا هو المحرك المستخدم في الإنتاج.
//
// إذا لم يُهيَّأ apiBaseUrl (مثلاً أثناء التطوير المحلي بدون Worker
// مُشغَّل)، يُعيد فشلاً صريحًا PROVIDER_UNAVAILABLE — لا يتحول أبداً
// بصمت إلى المحرك التجريبي (MockAnalysisEngine). القرار بين الوضعين
// يتم صراحةً فقط في js/core/config.js.
// ============================================================
import { engineSuccess, engineFailure } from '../domain/i-analysis-engine.js';
import { AnalysisErrors } from '../core/analysis-error.js';

const DEFAULT_TIMEOUT_MS = 15000;

export class LiveAnalysisEngine {
  #apiBaseUrl;
  #timeoutMs;
  #provider;

  /** @param {{apiBaseUrl?: string|null, timeoutMs?: number, provider?: *}} opts */
  constructor({ apiBaseUrl = null, timeoutMs = DEFAULT_TIMEOUT_MS, provider = null } = {}) {
    this.#apiBaseUrl = apiBaseUrl;
    this.#timeoutMs = timeoutMs;
    this.#provider = provider;
  }

  get engineId() {
    return 'live-worker-v1';
  }
  get requiresNetwork() {
    return true;
  }
  get isSimulated() {
    return false;
  }

  async analyze(rawInput, { cancelToken } = {}) {
    if (!this.#apiBaseUrl) {
      return engineFailure(
        AnalysisErrors.providerUnavailable(
          'لم يتم تهيئة عنوان خدمة التحقق الحقيقية (Worker) بعد. راجع js/core/config.js وREADME.md لتفعيلها بعد النشر.'
        )
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    if (cancelToken) {
      cancelToken.throwIfCancelled?.();
      cancelToken.whenCancelled?.then(() => controller.abort());
    }

    try {
      const resp = await fetch(this.#apiBaseUrl.replace(/\/$/, '') + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: rawInput }),
        signal: controller.signal,
      });

      let body;
      try {
        body = await resp.json();
      } catch (parseErr) {
        // فشل تحليل JSON — هذا هو العرض الأدق لمشكلة "Functions غير
        // مُنشورة فعليًا على هذا النطاق": Cloudflare Pages يُعيد صفحة
        // HTML افتراضية (404 أو صفحة خطأ) بدل تفويض الطلب فعليًا إلى
        // Pages Function. نميّز هذه الحالة صراحةً بفحص Content-Type
        // بعد فشل التحليل فقط (وليس قبله، تجنبًا لرفض استجابات JSON
        // صالحة فعليًا لمجرد عدم ضبط الترويسة بدقة مثالية).
        const contentType = resp.headers.get('content-type') || '';
        const looksLikeHtmlFallback = contentType.includes('text/html') || resp.status === 404;
        console.error(
          `[LiveAnalysisEngine] Failed to parse response from ${this.#apiBaseUrl}/verify as JSON. ` +
            `HTTP ${resp.status}, Content-Type="${contentType}". ${parseErr?.message || ''} ` +
            (looksLikeHtmlFallback
              ? 'هذا يوحي بأن Cloudflare Pages Functions غير مُنشورة فعليًا على هذا المسار — راجع README.md قسم "النشر على Cloudflare Pages".'
              : '')
        );
        return engineFailure(
          looksLikeHtmlFallback ? AnalysisErrors.backendMisconfigured(resp.status) : AnalysisErrors.malformedResponse()
        );
      }

      if (body?.kind === 'success' && body.result) {
        return engineSuccess(body.result);
      }
      if (body?.kind === 'failure' && body.error) {
        return engineFailure(body.error);
      }
      console.error('[LiveAnalysisEngine] JSON response did not match the expected {kind, result|error} schema:', body);
      return engineFailure(AnalysisErrors.malformedResponse());
    } catch (err) {
      if (controller.signal.aborted) {
        return engineFailure(cancelToken?.isCancelled ? AnalysisErrors.cancelled() : AnalysisErrors.timeout());
      }
      return engineFailure(AnalysisErrors.networkFailure());
    } finally {
      clearTimeout(timer);
    }
  }
}
