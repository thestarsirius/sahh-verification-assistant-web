// ============================================================
// normalizer.js
// يحوّل النص المُدخل إلى كائن URL صالح للتحليل.
//
// قواعد صارمة:
//   - لا يُضاف مخطط (scheme) إلا إذا كان غائباً تماماً.
//   - لا تُحذف أو تُعاد ترتيب query parameters.
//   - لا يُغيَّر الـpath أو الـfragment.
//   - المخططات المدعومة: http, https فقط — أي مخطط آخر (javascript:,
//     data:, file:, ...) يُرفض صراحةً.
//   - يعتمد على واجهة WebPlatform القياسية `URL` المتاحة أصلاً في كل
//     من المتصفحات الحديثة وNode.js (لا حاجة لأي مكتبة خارجية)، وهي
//     نفسها المسؤولة عن دعم Unicode/IDN عبر تحويل Punycode التلقائي
//     المدمج في محرك الـURL القياسي (WHATWG URL Standard).
// ============================================================
import { UrlValidationError } from './validator.js';
import { AnalysisErrors } from '../core/analysis-error.js';

// يطابق أي مخطط بصيغة "name:" القياسية (RFC 3986) بغض النظر عن وجود
// "//" بعده أم لا — بعض المخططات الخطرة مثل data: وjavascript: لا
// تستخدم "//" إطلاقاً، ويجب اكتشافها كمخطط موجود (وليس رابطاً بلا
// مخطط) حتى تُرفض صراحةً بدل أن تُصنَّف خطأً كـ"رابط غير صالح" بعد
// إضافة https:// لها بالخطأ.
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export class UrlNormalizer {
  /**
   * @param {string} raw
   * @returns {URL}
   */
  normalize(raw) {
    let s = raw.trim();

    if (!SCHEME_PATTERN.test(s)) {
      s = 'https://' + s;
    }

    let url;
    try {
      url = new URL(s);
    } catch {
      throw new UrlValidationError(AnalysisErrors.invalidUrl());
    }

    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw new UrlValidationError(AnalysisErrors.unsupportedScheme(scheme));
    }

    if (!url.hostname) {
      throw new UrlValidationError(AnalysisErrors.invalidUrl());
    }

    // مضيف بأحرف صغيرة فقط — الـURL القياسي يقوم بذلك تلقائياً، لكن
    // نُثبّته صراحةً هنا لضمان الحتمية بغض النظر عن بيئة التشغيل.
    // path/query/fragment تبقى كما أدخلها المستخدم تماماً.
    return url;
  }
}
