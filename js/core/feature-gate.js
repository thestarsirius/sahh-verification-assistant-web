// ============================================================
// feature-gate.js
// بنية Free/Premium واضحة وقابلة للربط لاحقاً بنظام اشتراكات ودفع
// حقيقي. لا يوجد أي نظام دفع وهمي هنا — فقط تحديد صريح لما هو متاح
// في كل مستوى، وعداد استخدام يومي بسيط محلي (localStorage) لتفعيل
// حد الفحوصات المجانية.
// ============================================================
export const PlanTier = Object.freeze({ FREE: 'free', PREMIUM: 'premium' });

export const PLAN_LIMITS = Object.freeze({
  [PlanTier.FREE]: {
    dailyScanLimit: 20,
    advancedAnalysis: false,
    detailedReports: false,
  },
  [PlanTier.PREMIUM]: {
    dailyScanLimit: Infinity,
    advancedAnalysis: true,
    detailedReports: true,
  },
});

const USAGE_KEY_PREFIX = 'sahh:usage:';

export class FeatureGate {
  #backend;
  #tier;

  /**
   * @param {{tier?: string, backend?: {getItem,setItem}}} opts
   */
  constructor({ tier = PlanTier.FREE, backend } = {}) {
    this.#tier = tier;
    this.#backend = backend || (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  }

  get tier() {
    return this.#tier;
  }

  get limits() {
    return PLAN_LIMITS[this.#tier];
  }

  #todayKey() {
    return USAGE_KEY_PREFIX + new Date().toISOString().slice(0, 10);
  }

  getTodayUsage() {
    if (!this.#backend) return 0;
    return Number(this.#backend.getItem(this.#todayKey()) || 0);
  }

  /** يزيد العداد اليومي بواحد. يُستدعى بعد كل تحليل ناجح فقط. */
  recordScan() {
    if (!this.#backend) return;
    this.#backend.setItem(this.#todayKey(), String(this.getTodayUsage() + 1));
  }

  /** هل تبقى للمستخدم فحوصات مجانية اليوم؟ */
  canScanToday() {
    return this.getTodayUsage() < this.limits.dailyScanLimit;
  }
}
