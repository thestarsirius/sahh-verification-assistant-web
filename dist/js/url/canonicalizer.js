// ============================================================
// canonicalizer.js
// يشتق تمثيلاً قانونياً (canonical) من URL مُطبَّع بالفعل، للاستخدام
// في التحليل والعرض المؤقت فقط — وليس رابط الطلب الفعلي (لا يوجد
// طلب شبكة فعلي أصلاً في محرك Mock).
//
// ✅ IDN/Punycode: كائن URL القياسي (WHATWG URL) يحوّل أسماء النطاقات
// اليونيكود تلقائياً إلى Punycode (xn--...) عند التحليل — لذلك
// url.hostname هنا يعكس بالفعل الشكل القانوني المقاوم لهجمات
// Homograph الأساسية، بخلاف نسخة Flutter السابقة التي وثّقنا فيها
// هذا القيد صراحةً (Dart's Uri class لا يقوم بهذا التحويل تلقائياً).
// هذا فرق حقيقي وموثّق لصالح اختيار المنصة الحالية — انظر
// docs/architecture.md قسم "لماذا الويب".
// ============================================================
export class CanonicalUrl {
  constructor({ url, domain, hasNonAsciiOriginalLabel, isPunycode }) {
    this.url = url;
    this.domain = domain;
    this.hasNonAsciiOriginalLabel = hasNonAsciiOriginalLabel;
    this.isPunycode = isPunycode;
    Object.freeze(this);
  }
}

export class UrlCanonicalizer {
  /**
   * @param {URL} normalizedUrl
   * @param {string} rawInputForIdnCheck - المدخل الأصلي، فقط لفحص إن
   *   كان يحتوي أحرف يونيكود في اسم النطاق قبل تحويل المتصفح له —
   *   لا يُخزَّن ولا يُمرَّر لأي مكان آخر.
   */
  canonicalize(normalizedUrl, rawInputForIdnCheck = '') {
    let host = normalizedUrl.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.substring(4);

    const isPunycode = host.split('.').some((label) => label.startsWith('xn--'));
    const hasNonAsciiOriginalLabel = /[^\x00-\x7F]/.test(rawInputForIdnCheck);

    return new CanonicalUrl({ url: normalizedUrl, domain: host, hasNonAsciiOriginalLabel, isPunycode });
  }
}
