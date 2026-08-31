// ============================================================
// cache.js
// ذاكرة تخزين مؤقتة في الذاكرة فقط (Map عادية)، لأداء أفضل عند
// تكرار فحص نفس الرابط خلال نفس الجلسة.
//
// قواعد صارمة:
//   - In-Memory فقط — لا localStorage ولا IndexedDB لهذه الذاكرة.
//   - محدودة الحجم (maxEntries) ومحدودة المدة (ttlMs) لكل عنصر.
//   - تحتوي فقط نتيجة تحليل (AnalysisReport)، ليس أي محتوى خام.
//   - تُفرَّغ بالكامل عند إعادة تحميل الصفحة (لأنها في الذاكرة فقط).
// ============================================================
export class TemporaryCache {
  #store = new Map();
  #maxEntries;
  #ttlMs;

  constructor({ maxEntries = 20, ttlMs = 2 * 60 * 1000 } = {}) {
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > this.#ttlMs) {
      this.#store.delete(key);
      return null;
    }
    return entry.report;
  }

  put(key, report) {
    if (this.#store.size >= this.#maxEntries) {
      const oldestKey = [...this.#store.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0][0];
      this.#store.delete(oldestKey);
    }
    this.#store.set(key, { report, storedAt: Date.now() });
  }

  clear() {
    this.#store.clear();
  }

  get size() {
    return this.#store.size;
  }
}
