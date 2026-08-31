// ============================================================
// redirect-resolver.js
// واجهة مستقبلية لتحليل سلسلة التحويلات (A → B → C). تنفيذها الفعلي
// يتطلب اتصال شبكة حقيقياً مع حدود موارد وحماية SSRF/DNS rebinding
// كاملة على مستوى Backend (انظر docs/threat-model.md، §12 و§17).
//
// لا يوجد أي تنفيذ شبكي فعلي هنا — NotConfiguredRedirectResolver هو
// التنفيذ الوحيد المتاح، يعيد السلسلة الأصلية فقط دون أي تتبّع فعلي.
// ============================================================
export class NotConfiguredRedirectResolver {
  /**
   * @param {URL} start
   */
  async resolveChain(start, { maxRedirects = 5, timeoutMs = 5000, cancelToken } = {}) {
    void maxRedirects;
    void timeoutMs;
    void cancelToken;
    return { chain: [start], wasTruncated: false, featureAvailable: false };
  }
}
