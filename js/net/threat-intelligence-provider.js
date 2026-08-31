// ============================================================
// threat-intelligence-provider.js
// واجهة مستقبلية للتكامل مع مزوّدي فحص التهديدات الحقيقيين. لا يوجد
// أي تنفيذ فعلي لهذه الواجهة في هذه النسخة.
//
// تطبيقات مستقبلية مقترحة (Requires Backend/API — غير منفّذة هنا):
//   - GoogleSafeBrowsingProvider
//   - VirusTotalProvider
//
// ⚠️ لا تضع API Keys داخل كود الواجهة الأمامية (Frontend) مطلقاً.
// أي تنفيذ حقيقي لهذه الواجهة يجب أن يستدعي Backend/Secure Proxy خاص
// بك، وليس مزوّد التهديدات مباشرة من المتصفح.
// ============================================================

export const ThreatVerdictStatus = Object.freeze({
  CLEAN: 'clean',
  SUSPICIOUS: 'suspicious',
  MALICIOUS: 'malicious',
  UNKNOWN: 'unknown',
});

/**
 * العقد المطلوب من أي مزوّد حقيقي:
 *   - providerId: string
 *   - async check(canonicalUrl): Promise<{status, providerReference?}>
 * @param {*} provider
 */
export function assertIsThreatIntelligenceProvider(provider) {
  if (!provider || typeof provider.check !== 'function' || !provider.providerId) {
    throw new Error('Provider does not satisfy the ThreatIntelligenceProvider contract');
  }
  return true;
}
