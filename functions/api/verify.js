import { UrlValidationError, verify } from '../../worker/src/verify-pipeline.js';
import { AnalysisErrors } from '../../js/core/analysis-error.js';
import { analyzeWithAI } from '../../worker/src/ai/analyze-with-ai.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export async function onRequestPost(context) {
  let body;

  try {
    body = await context.request.json();
  } catch {
    return json({
      kind: 'failure',
      error: AnalysisErrors.invalidUrl(),
    });
  }

  const rawInput =
    typeof body?.input === 'string' ? body.input : '';

  try {
    // الفحص الأمني الأساسي
    const outcome = await verify(rawInput);

    if (outcome?.kind !== 'success' || !outcome?.result) {
      return json(outcome);
    }

    // شرح النتيجة باستخدام Cloudflare Workers AI
    const aiResult = await analyzeWithAI(
      context.env,
      outcome.result,
      rawInput
    );

    return json({
      kind: 'success',
      result: outcome.result,
      ai: aiResult,
    });

  } catch (e) {
    if (e instanceof UrlValidationError) {
      return json({
        kind: 'failure',
        error: e.analysisError,
      });
    }

    console.error(
      'unexpected_function_error',
      e?.message
    );

    return json({
      kind: 'failure',
      error: AnalysisErrors.unknown(
        'FUNCTION_UNEXPECTED'
      ),
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
  });
}

export async function onRequestGet() {
  return json(
    {
      error: 'method_not_allowed',
      hint: 'استخدم POST مع body بصيغة {"input":"..."}',
    },
    405
  );
}
