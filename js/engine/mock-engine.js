// ============================================================
// mock-engine.js
// MockAnalysisEngine — Development / Demo Mode. SIMULATED ANALYSIS.
//
// ✅ لا يجري أي Network Request حقيقي.
// ✅ لا يتصل بأي مزوّد Threat Intelligence.
// ✅ لا يستخدم أي API Key.
// ✅ لا يدّعي أن النتائج "Verified" أو نتائج فحص أمني حقيقي.
// ✅ حتمي بالكامل — لا Math.random ولا أي مصدر عشوائية.
//
// يُستخدم فقط في: التطوير، اختبارات الواجهة، الاختبارات الآلية،
// والعرض التوضيحي (Demo). أي نتيجة يعرضها هذا المحرك يجب أن تكون
// مصحوبة في الواجهة بشارة "Development/Demo Mode — Simulated
// Analysis" (انظر js/ui/simulated-badge.js).
// ============================================================
import { UrlValidator, UrlValidationError } from '../url/validator.js';
import { UrlNormalizer } from '../url/normalizer.js';
import { UrlCanonicalizer } from '../url/canonicalizer.js';
import { SsrfGuard } from '../url/ssrf-guard.js';
import { RiskEngine } from './risk-engine.js';
import { buildStaticEvidence } from './evidence-builder.js';
import { engineSuccess, engineFailure } from '../domain/i-analysis-engine.js';
import { AnalysisErrors } from '../core/analysis-error.js';
import { OperationCancelledError } from '../domain/cancellation-token.js';

export class MockAnalysisEngine {
  #validator;
  #normalizer;
  #canonicalizer;
  #ssrfGuard;
  #riskEngine;

  constructor({
    validator = new UrlValidator(),
    normalizer = new UrlNormalizer(),
    canonicalizer = new UrlCanonicalizer(),
    ssrfGuard = new SsrfGuard(),
    riskEngine = new RiskEngine(),
  } = {}) {
    this.#validator = validator;
    this.#normalizer = normalizer;
    this.#canonicalizer = canonicalizer;
    this.#ssrfGuard = ssrfGuard;
    this.#riskEngine = riskEngine;
  }

  get engineId() {
    return 'mock-v1';
  }
  get requiresNetwork() {
    return false;
  }
  get isSimulated() {
    return true;
  }

  /**
   * @param {string} rawInput
   * @param {{cancelToken: import('../domain/cancellation-token.js').CancellationToken}} opts
   */
  async analyze(rawInput, { cancelToken }) {
    try {
      cancelToken.throwIfCancelled();

      // 1) Validation
      this.#validator.validate(rawInput);
      cancelToken.throwIfCancelled();

      await cancelToken.delayOrCancel(350);

      // 2) Normalization
      const normalized = this.#normalizer.normalize(rawInput);
      cancelToken.throwIfCancelled();

      // SSRF guard — قبل أي معالجة أخرى
      if (this.#ssrfGuard.isBlockedHost(normalized.hostname)) {
        return engineFailure(AnalysisErrors.ssrfRejected());
      }

      await cancelToken.delayOrCancel(350);

      // 3) Canonicalization
      const canonical = this.#canonicalizer.canonicalize(normalized, rawInput);
      cancelToken.throwIfCancelled();

      // 4) URL Analysis -> Evidence (حتمي بالكامل، منطق مشترك مع الـWorker الحقيقي)
      const evidence = buildStaticEvidence(normalized, canonical);

      await cancelToken.delayOrCancel(350);

      // 5) Redirect Analysis: غير متاح بدون شبكة حقيقية (موثّق في التقرير والحارس)
      // 6) Threat Intelligence: لا يوجد مزوّد متصل في Mock
      // 7) Risk Engine (حتمي بالكامل)
      const report = this.#riskEngine.assess(evidence);
      cancelToken.throwIfCancelled();

      await cancelToken.delayOrCancel(250);

      return engineSuccess(report);
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        return engineFailure(AnalysisErrors.cancelled());
      }
      if (err instanceof UrlValidationError) {
        return engineFailure(err.analysisError);
      }
      return engineFailure(AnalysisErrors.unknown('MOCK_ENGINE_UNEXPECTED'));
    }
  }
}
