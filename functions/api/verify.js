// ============================================================
// functions/api/verify.js — Cloudflare Pages Function
// هذا هو مسار النشر المُوصى به (الأبسط): يُنشر تلقائيًا مع الموقع
// الثابت على نفس النطاق تمامًا عند رفع المشروع إلى Cloudflare Pages
// — بدون الحاجة لأي إعداد CORS أو نطاق فرعي منفصل أو ربط Route يدوي.
// الواجهة الأمامية تستدعي '/api/verify' بشكل مباشر (نفس الأصل تمامًا).
//
// المنطق الفعلي بالكامل مُستورد من worker/src/verify-pipeline.js —
// لا يوجد أي ازدواجية منطق بين هذا المسار ومسار الـWorker المستقل.
// ============================================================
import { UrlValidationError, verify } from '../../worker/src/verify-pipeline.js';
import { AnalysisErrors } from '../../js/core/analysis-error.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** @param {{request: Request}} context */
export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ kind: 'failure', error: AnalysisErrors.invalidUrl() });
  }

  const rawInput = typeof body?.input === 'string' ? body.input : '';

  try {
    const outcome = await verify(rawInput);
    return json(outcome);
  } catch (e) {
    if (e instanceof UrlValidationError) {
      return json({ kind: 'failure', error: e.analysisError });
    }
    console.error('unexpected_function_error', e?.message);
    return json({ kind: 'failure', error: AnalysisErrors.unknown('FUNCTION_UNEXPECTED') });
  }
}

export async function onRequestOptions() {
  // نفس الأصل تمامًا (Pages Function على نفس نطاق الموقع) — لا حاجة
  // فعلية لـCORS، لكن نُعيد استجابة سليمة لأي Preflight محتمل بأمان.
  return new Response(null, { status: 204 });
}

// أي طريقة HTTP أخرى غير POST/OPTIONS يجب أن تُعيد JSON صريحًا أيضًا،
// وليس صفحة الخطأ الافتراضية من Cloudflare — هذا يضمن أن الواجهة
// الأمامية (أو أي أداة تشخيص مثل curl) تحصل دائمًا على استجابة JSON
// متسقة من هذا المسار بغض النظر عن الطريقة المُستخدَمة بالخطأ.
export async function onRequestGet() {
  return json({ error: 'method_not_allowed', hint: 'استخدم POST مع body بصيغة {"input": "..."}' }, 405);
}
