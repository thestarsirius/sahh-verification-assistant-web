// ============================================================
// models.js
// نماذج بيانات محايدة عن أي منصة — تعمل في المتصفح وNode.js بدون
// أي تعديل. لا تحتوي على أي حقل لتخزين الرابط الخام.
// ============================================================

/** @typedef {'green'|'yellow'|'red'} RiskLevel */

export const RiskLevel = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
});

/**
 * عنصر تحقق فردي ضمن تقرير "لماذا ظهرت هذه النتيجة؟".
 * ok === true  -> مؤشر إيجابي
 * ok === false -> مؤشر تحذيري
 * ok === null  -> معلومة محايدة / غير متاحة
 * @param {boolean|null} ok
 * @param {string} label
 */
export function checkItem(ok, label) {
  return Object.freeze({ ok, label });
}

/**
 * تقرير تحليل ناجح (Trusted / Needs Verification / Potential Risk).
 * حقل domain يُعرض بشكل مؤقت في شاشة النتيجة فقط، ولا يُخزَّن أبداً
 * ضمن السجل المحلي — انظر toHistoryEntry أدناه.
 */
export function analysisReport({ level, score, domain, checks, reasons, recommendation }) {
  return Object.freeze({
    level,
    score,
    domain: domain ?? null,
    checks: Object.freeze({ ...checks }),
    reasons: Object.freeze([...reasons]),
    recommendation: Object.freeze([...recommendation]),
  });
}

/**
 * عنصر محفوظ في "سجل التحقق" المحلي — ملخص فقط، بدون أي محتوى خام.
 */
export function historyEntryFromReport({ id, type, report, timestamp }) {
  return Object.freeze({
    id,
    type, // 'qr' | 'url'
    timestamp: timestamp ?? new Date().toISOString(),
    level: report.level,
    score: report.score,
    checks: report.checks,
    reasons: report.reasons,
    recommendation: report.recommendation,
    // ⚠️ عمداً: لا يوجد حقل url/domain/qrContent هنا.
  });
}
