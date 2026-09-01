// ============================================================
// analyze-with-ai.js
// AI explanation layer using Cloudflare Workers AI.
// لا يقرر مستوى الخطر بنفسه؛ يشرح نتيجة محرك الأمان الحالي.
// ============================================================

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

export async function analyzeWithAI(env, report, url) {
  if (!env?.AI) {
    return {
      available: false,
      explanation: null,
    };
  }

  try {
    const prompt = `
أنت مساعد أمن سيبراني سعودي متخصص في تحليل الروابط.

لدينا نتيجة فحص أمني حتمية لرابط.
مهمتك شرح النتيجة للمستخدم باللغة العربية بشكل واضح ومختصر.

ممنوع تغيير مستوى الخطورة أو الدرجة التي أعطاها محرك الأمان.
لا تقل إن الرابط آمن 100%.
لا تخترع معلومات غير موجودة في البيانات.

الرابط:
${url}

مستوى الخطورة:
${report.level}

الدرجة:
${report.score}/100

النطاق:
${report.domain}

الأسباب:
${JSON.stringify(report.reasons, null, 2)}

التحقق من النطاق:
${JSON.stringify(report.checks?.domain || [], null, 2)}

التحقق من التحويلات:
${JSON.stringify(report.checks?.redirects || [], null, 2)}

التحقق من التصيد:
${JSON.stringify(report.checks?.phishing || [], null, 2)}

أرجع JSON فقط بهذا الشكل:
{
  "summary": "شرح قصير للنتيجة",
  "why": [
    "سبب مهم 1",
    "سبب مهم 2",
    "سبب مهم 3"
  ],
  "advice": [
    "نصيحة 1",
    "نصيحة 2"
  ]
}
`;

    const response = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'أنت محلل أمن سيبراني. أجب بالعربية فقط وبصيغة JSON صحيحة.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 500,
    });

    let text = response?.response;

    if (typeof text !== 'string') {
      return {
        available: false,
        explanation: null,
      };
    }

    text = text.trim();

    // إزالة ```json إذا أعادها النموذج
    text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(text);

    return {
      available: true,
      explanation: {
        summary: String(parsed.summary || ''),
        why: Array.isArray(parsed.why) ? parsed.why.map(String) : [],
        advice: Array.isArray(parsed.advice)
          ? parsed.advice.map(String)
          : [],
      },
    };
  } catch (error) {
    console.error('AI_ANALYSIS_ERROR', error?.message);

    return {
      available: false,
      explanation: null,
    };
  }
}
