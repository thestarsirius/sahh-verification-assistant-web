// ============================================================
// storage.js
// طبقة تخزين محلية بسيطة على جهاز المستخدم فقط (localStorage في
// المتصفح). لا توجد قاعدة بيانات مستخدمين، ولا حسابات، ولا مزامنة
// سحابية. يُخزَّن هنا فقط:
//   - حالة الموافقة على الشروط (bool)
//   - ملخصات نتائج الفحص (History) — بدون أي محتوى خام على الإطلاق
//
// الـbackend قابل للحقن (Dependency Injection) — في المتصفح نستخدم
// window.localStorage افتراضياً، وفي اختبارات Node نحقن Map بسيطة
// بنفس الواجهة (getItem/setItem/removeItem) بدلاً من محاولة الوصول
// إلى localStorage غير المتاح هناك.
// ============================================================
const TERMS_KEY = 'sahh:terms_accepted';
const HISTORY_KEY = 'sahh:history_v1';

function memoryStorageBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

export class StorageService {
  #backend;

  /** @param {{getItem, setItem, removeItem}} [backend] */
  constructor(backend) {
    this.#backend =
      backend || (typeof window !== 'undefined' && window.localStorage ? window.localStorage : memoryStorageBackend());
  }

  getTermsAccepted() {
    return this.#backend.getItem(TERMS_KEY) === 'true';
  }

  setTermsAccepted(value) {
    this.#backend.setItem(TERMS_KEY, value ? 'true' : 'false');
  }

  getHistory() {
    const raw = this.#backend.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #saveHistory(entries) {
    this.#backend.setItem(HISTORY_KEY, JSON.stringify(entries));
  }

  addEntry(entry) {
    const current = this.getHistory();
    const next = [entry, ...current].slice(0, 200); // حد أقصى معقول
    this.#saveHistory(next);
    return next;
  }

  deleteEntry(id) {
    const next = this.getHistory().filter((e) => e.id !== id);
    this.#saveHistory(next);
    return next;
  }

  deleteAllHistory() {
    this.#backend.removeItem(HISTORY_KEY);
  }
}
