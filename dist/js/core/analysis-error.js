// ============================================================
// analysis-error.js
// نموذج الأخطاء الموحّد لكل خط أنابيب التحليل.
// ============================================================

export const ErrorCategory = Object.freeze({
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_SCHEME: 'UNSUPPORTED_SCHEME',
  URL_TOO_LONG: 'URL_TOO_LONG',
  SSRF_REJECTED: 'SSRF_REJECTED',
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  BACKEND_MISCONFIGURED: 'BACKEND_MISCONFIGURED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  CANCELLED: 'CANCELLED',
  DAILY_LIMIT_REACHED: 'DAILY_LIMIT_REACHED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * @param {{category:string, userMessage:string, retryable:boolean, technicalCode:string}} p
 */
export function analysisError({ category, userMessage, retryable, technicalCode }) {
  return Object.freeze({ category, userMessage, retryable, technicalCode });
}

export const AnalysisErrors = Object.freeze({
  emptyInput: () =>
    analysisError({
      category: ErrorCategory.EMPTY_INPUT,
      userMessage: 'لم يتم إدخال أي رابط أو محتوى للفحص.',
      retryable: false,
      technicalCode: 'EMPTY_INPUT',
    }),
  invalidUrl: () =>
    analysisError({
      category: ErrorCategory.INVALID_URL,
      userMessage: 'تعذّر فهم بنية الرابط. تأكد من صحته وحاول مرة أخرى.',
      retryable: true,
      technicalCode: 'INVALID_URL',
    }),
  unsupportedScheme: (scheme) =>
    analysisError({
      category: ErrorCategory.UNSUPPORTED_SCHEME,
      userMessage: `نوع الرابط (${scheme}) غير مدعوم حالياً. الأنواع المدعومة: http وhttps فقط.`,
      retryable: false,
      technicalCode: 'UNSUPPORTED_SCHEME',
    }),
  urlTooLong: () =>
    analysisError({
      category: ErrorCategory.URL_TOO_LONG,
      userMessage: 'الرابط أطول من الحد المسموح به للفحص.',
      retryable: false,
      technicalCode: 'URL_TOO_LONG',
    }),
  ssrfRejected: () =>
    analysisError({
      category: ErrorCategory.SSRF_REJECTED,
      userMessage: 'تمت رفض هذا العنوان لأنه يشير إلى شبكة داخلية أو محلية، ولا يمكن فحصه.',
      retryable: false,
      technicalCode: 'SSRF_REJECTED',
    }),
  offline: () =>
    analysisError({
      category: ErrorCategory.OFFLINE,
      userMessage: 'تعذر إجراء الفحص حالياً.\nتحقق من اتصال الإنترنت وحاول مرة أخرى.',
      retryable: true,
      technicalCode: 'OFFLINE',
    }),
  timeout: () =>
    analysisError({
      category: ErrorCategory.TIMEOUT,
      userMessage: 'استغرق التحليل وقتاً أطول من المتوقع. حاول مرة أخرى.',
      retryable: true,
      technicalCode: 'TIMEOUT',
    }),
  networkFailure: () =>
    analysisError({
      category: ErrorCategory.NETWORK_FAILURE,
      userMessage: 'تعذر الوصول إلى خدمة التحقق حالياً. تحقق من اتصالك وحاول مرة أخرى.',
      retryable: true,
      technicalCode: 'NETWORK_FAILURE',
    }),
  malformedResponse: () =>
    analysisError({
      category: ErrorCategory.UNKNOWN,
      userMessage: 'استجابة غير متوقعة من خدمة التحقق. حاول مرة أخرى.',
      retryable: true,
      technicalCode: 'MALFORMED_RESPONSE',
    }),
  backendMisconfigured: (statusCode) =>
    analysisError({
      category: ErrorCategory.BACKEND_MISCONFIGURED,
      userMessage: 'خدمة التحقق غير مُهيّأة بشكل صحيح على هذا النطاق حاليًا. الرجاء المحاولة لاحقًا.',
      retryable: true,
      technicalCode: `BACKEND_MISCONFIGURED_${statusCode ?? 'UNKNOWN'}`,
    }),
  providerUnavailable: (reason) =>
    analysisError({
      category: ErrorCategory.PROVIDER_UNAVAILABLE,
      userMessage:
        reason ||
        'محرك التحليل الحقيقي (Live) غير مُفعّل في هذه النسخة حتى الآن — يتطلب هذا ربط Backend وThreat Intelligence Provider حقيقي.',
      retryable: false,
      technicalCode: 'PROVIDER_UNAVAILABLE',
    }),
  cancelled: () =>
    analysisError({
      category: ErrorCategory.CANCELLED,
      userMessage: 'تم إلغاء عملية التحليل.',
      retryable: true,
      technicalCode: 'CANCELLED',
    }),
  dailyLimitReached: () =>
    analysisError({
      category: ErrorCategory.DAILY_LIMIT_REACHED,
      userMessage: 'وصلت للحد اليومي للفحوصات المجانية. حاول مرة أخرى غداً، أو تابع التطورات المستقبلية لخطة Premium.',
      retryable: false,
      technicalCode: 'DAILY_LIMIT_REACHED',
    }),
  unknown: (technicalCode) =>
    analysisError({
      category: ErrorCategory.UNKNOWN,
      userMessage: 'حدث خطأ غير متوقع أثناء التحليل. حاول مرة أخرى.',
      retryable: true,
      technicalCode: technicalCode || 'UNKNOWN',
    }),
});
