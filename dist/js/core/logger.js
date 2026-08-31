// ============================================================
// logger.js
// طبقة تسجيل واحدة يمر عبرها كل الـlogging، لضمان عدم تسرّب بيانات
// حساسة بالخطأ. يُسمح بتسجيل: معرّف العملية، نوعها، المدة،
// النجاح/الفشل، وفئة الخطأ العامة فقط.
// ============================================================
const URL_LIKE = /(https?:\/\/\S+|\S+@\S+\.\S+)/gi;

export class SecureLogger {
  /** @param {(msg:string)=>void} sink */
  constructor(sink = (msg) => console.log(msg)) {
    this.sink = sink;
  }

  sanitize(input) {
    return String(input ?? '').replace(URL_LIKE, '[REDACTED]');
  }

  logOperation({ operationId, operationType, durationMs, success, errorCategory }) {
    this.sink(
      `[sahh.analysis] op=${operationId} type=${operationType} duration_ms=${durationMs} success=${success}` +
        (errorCategory ? ` error=${errorCategory}` : '')
    );
  }

  logSecurityEvent(event, context = {}) {
    const safeContext = Object.fromEntries(Object.entries(context).map(([k, v]) => [k, this.sanitize(v)]));
    this.sink(`[sahh.security] event=${event} context=${JSON.stringify(safeContext)}`);
  }
}
