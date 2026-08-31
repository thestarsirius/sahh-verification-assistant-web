// ============================================================
// index.js — نقطة دخول Worker مستقل (بديل لـ Cloudflare Pages
// Functions، للمستخدمين الذين يريدون نشر خدمة التحقق كـWorker منفصل
// على نطاق فرعي خاص بها بدلاً من دمجها ضمن نفس نطاق الموقع).
//
// المنطق الفعلي بالكامل موجود في verify-pipeline.js — هذا الملف
// مسؤول فقط عن التوجيه (Routing) وCORS وتحويل الأخطاء غير المتوقعة.
// ============================================================
import { UrlValidationError, verify } from './verify-pipeline.js';
import { AnalysisErrors } from '../../js/core/analysis-error.js';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

export default {
  /** @param {Request} request */
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/health') {
      return json({ status: 'ok', mode: 'live', engineId: 'worker-v1' }, 200, origin);
    }

    if (url.pathname !== '/api/verify') {
      return json({ error: 'not_found' }, 404, origin);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ kind: 'failure', error: AnalysisErrors.invalidUrl() }, 200, origin);
    }

    const rawInput = typeof body?.input === 'string' ? body.input : '';

    try {
      const outcome = await verify(rawInput);
      return json(outcome, 200, origin);
    } catch (e) {
      if (e instanceof UrlValidationError) {
        return json({ kind: 'failure', error: e.analysisError }, 200, origin);
      }
      console.error('unexpected_worker_error', e?.message);
      return json({ kind: 'failure', error: AnalysisErrors.unknown('WORKER_UNEXPECTED') }, 200, origin);
    }
  },
};
