// ============================================================
// connectivity.js
// تجريد بسيط لفحص وجود اتصال إنترنت، يعتمد على navigator.onLine
// (متاح أصلاً في كل المتصفحات، بدون أي مكتبة خارجية).
//
// يُستخدم فقط من قِبل الـcontroller قبل استدعاء محرك يحتاج شبكة
// فعلياً (requiresNetwork === true). محرك Mock لا يحتاج هذا الفحص
// إطلاقاً لأنه لا يجري أي اتصال شبكة.
// ============================================================
export class BrowserConnectivityChecker {
  async hasConnection() {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
      // بيئة بدون navigator (مثل اختبارات Node) — نفترض وجود اتصال
      // افتراضياً لأن هذا الفحص غير ذي صلة خارج المتصفح.
      return true;
    }
    return navigator.onLine;
  }
}

/**
 * أداة اختبار/عرض توضيحي: تسمح بمحاكاة "عدم الاتصال" يدوياً من شاشة
 * الإعدادات، لتجربة مسار Offline دون الحاجة فعلياً لقطع شبكة الجهاز.
 */
export class DebugOverridableConnectivityChecker {
  constructor(inner = new BrowserConnectivityChecker()) {
    this.inner = inner;
    this.forceOffline = false;
  }

  async hasConnection() {
    if (this.forceOffline) return false;
    return this.inner.hasConnection();
  }
}
