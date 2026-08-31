// ============================================================
// verify-pipeline.js
// خط الأنابيب الحقيقي الكامل للتحقق — مُستقل عن نقطة الدخول (Worker
// مستقل أو Cloudflare Pages Function)، حتى يمكن استخدامه من كلا
// المسارين دون ازدواجية منطق.
// ============================================================
import { UrlValidator, UrlValidationError } from '../../js/url/validator.js';
import { UrlNormalizer } from '../../js/url/normalizer.js';
import { UrlCanonicalizer } from '../../js/url/canonicalizer.js';
import { SsrfGuard } from '../../js/url/ssrf-guard.js';
import { RiskEngine, mergeLiveSignalsIntoReport } from '../../js/engine/risk-engine.js';
import { buildStaticEvidence } from '../../js/engine/evidence-builder.js';
import { AnalysisErrors } from '../../js/core/analysis-error.js';
import { safeFetchWithRedirects } from './redirect-fetch.js';

const validator = new UrlValidator();
const normalizer = new UrlNormalizer();
const canonicalizer = new UrlCanonicalizer();
const ssrfGuard = new SsrfGuard();
const riskEngine = new RiskEngine();

export const LIMITS = Object.freeze({
  maxRedirects: 5,
  perRequestTimeoutMs: 5000,
  overallDeadlineMs: 12000,
  maxResponseBytes: 2_000_000,
});

/**
 * خط الأنابيب الكامل: Validate → Normalize → Canonicalize → Static
 * Evidence → Risk Engine (ثابت) → SSRF-safe fetch حقيقي مع تتبّع
 * Redirects → دمج الإشارات الحيّة → النتيجة النهائية.
 * يرمي UrlValidationError عند فشل التحقق المبكر — يجب على المستدعي
 * التقاطها (كلا نقطتي الدخول تفعل ذلك).
 */
export async function verify(rawInput) {
  validator.validate(rawInput);
  const normalized = normalizer.normalize(rawInput);

  if (ssrfGuard.isBlockedHost(normalized.hostname)) {
    return { kind: 'failure', error: AnalysisErrors.ssrfRejected() };
  }

  const canonical = canonicalizer.canonicalize(normalized, rawInput);
  const evidence = buildStaticEvidence(normalized, canonical);
  const baseReport = riskEngine.assess(evidence);

  const live = await safeFetchWithRedirects(normalized, {
    maxRedirects: LIMITS.maxRedirects,
    timeoutMs: LIMITS.perRequestTimeoutMs,
    overallDeadlineMs: LIMITS.overallDeadlineMs,
    maxBytes: LIMITS.maxResponseBytes,
  });

  if (live.error === 'ssrf_blocked') {
    return { kind: 'failure', error: AnalysisErrors.ssrfRejected() };
  }

  const liveSignals = {
    resolvedIps: live.resolvedIps || [],
    redirectCount: live.redirectCount || 0,
    crossDomainRedirect: !!live.crossDomainRedirect,
    exceededMaxRedirects: !!live.exceededMaxRedirects,
    fetchError: live.error === 'timeout' || live.error === 'network' || live.error === 'dns' ? live.error : null,
    finalStatusCode: live.finalStatusCode ?? null,
  };

  const finalReport = mergeLiveSignalsIntoReport(baseReport, liveSignals);
  return { kind: 'success', result: finalReport };
}

export { UrlValidationError };
