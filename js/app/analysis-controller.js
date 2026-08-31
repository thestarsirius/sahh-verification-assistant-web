// ============================================================
// analysis-controller.js
// يجمع محرك التحليل، التخزين المحلي، الذاكرة المؤقتة، وفحص الاتصال
// في كائن واحد يُنشأ مرة واحدة (في main.js للمتصفح، أو صراحةً في كل
// اختبار) ويُمرَّر عبر المُنشئ (Constructor Injection) لكل ما يحتاجه.
//
// هذا ليس Global Singleton: لا يوجد static instance ثابت يُستدعى من
// أي مكان — الكائن يُمرَّر صراحةً، ما يجعله قابلاً للاستبدال بسهولة
// في الاختبارات (محرك مختلف، أو StorageService وهمي).
// ============================================================
import { isEngineSuccess, isEngineFailure, engineFailure } from '../domain/i-analysis-engine.js';
import { AnalysisErrors } from '../core/analysis-error.js';
import { historyEntryFromReport } from '../core/models.js';
import { SecureLogger } from '../core/logger.js';

function simpleId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class AnalysisController {
  constructor({ engine, storageService, cache, connectivity, featureGate, logger = new SecureLogger() }) {
    this.engine = engine;
    this.storageService = storageService;
    this.cache = cache;
    this.connectivity = connectivity;
    this.featureGate = featureGate ?? null;
    this.logger = logger;
  }

  get isSimulatedMode() {
    return this.engine.isSimulated;
  }

  /**
   * ينفّذ التحليل الكامل، يحفظ ملخص النتيجة في السجل المحلي عند
   * النجاح فقط (لا يُحفظ شيء عند الفشل أو الإلغاء).
   * @param {{rawInput:string, sourceType:'qr'|'url', cancelToken:import('../domain/cancellation-token.js').CancellationToken}} p
   */
  async runAnalysis({ rawInput, sourceType, cancelToken }) {
    const opId = simpleId();
    const startedAt = Date.now();

    if (this.featureGate && !this.featureGate.canScanToday()) {
      return engineFailure(AnalysisErrors.dailyLimitReached());
    }

    // فحص الاتصال فقط إذا كان المحرك الحالي يحتاج شبكة فعلياً — Mock
    // لا يحتاج هذا الفحص إطلاقاً لأنه لا يتصل بأي خادم (Offline لا
    // يمكن أن يمنع Mock من العمل، ولا ينتج أبداً GREEN).
    if (this.engine.requiresNetwork) {
      const online = await this.connectivity.hasConnection();
      if (!online) {
        this.logger.logOperation({
          operationId: opId,
          operationType: sourceType,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCategory: 'OFFLINE',
        });
        return engineFailure(AnalysisErrors.offline());
      }
    }

    const outcome = await this.engine.analyze(rawInput, { cancelToken });

    if (isEngineSuccess(outcome)) {
      this.logger.logOperation({
        operationId: opId,
        operationType: sourceType,
        durationMs: Date.now() - startedAt,
        success: true,
      });
      const entry = historyEntryFromReport({ id: opId, type: sourceType, report: outcome.result });
      this.storageService.addEntry(entry);
      this.featureGate?.recordScan();
      return outcome;
    }

    if (isEngineFailure(outcome)) {
      this.logger.logOperation({
        operationId: opId,
        operationType: sourceType,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCategory: outcome.error.technicalCode,
      });
      // لا يُحفظ أي شيء في السجل عند الفشل أو الإلغاء.
      return outcome;
    }

    return engineFailure(AnalysisErrors.unknown('UNRECOGNIZED_OUTCOME'));
  }
}
