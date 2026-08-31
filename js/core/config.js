// ============================================================
// config.js
// نقطة التركيب (Composition Root) الوحيدة التي تقرر أي محرك يُستخدم.
// هذا هو المكان الوحيد المسموح فيه بالتبديل بين Mock وLive — لا يوجد
// أي مكان آخر في الكود يبدّل بينهما بصمت.
//
// AnalysisMode.DEVELOPMENT → MockAnalysisEngine (Simulated).
// AnalysisMode.PRODUCTION  → LiveAnalysisEngine (يتطلب Provider حقيقي
// يُمرَّر مستقبلاً؛ بدونه يعيد "Provider Unavailable" دائماً، ولا
// يتحول أبداً إلى Mock بصمت).
//
// القيمة الحالية ثابتة على Development عمداً — لا Backend أو Secret
// حقيقي متوفر بعد في هذه النسخة.
// ============================================================
import { MockAnalysisEngine } from '../engine/mock-engine.js';
import { LiveAnalysisEngine } from '../engine/live-engine.js';

export const AnalysisMode = Object.freeze({ DEVELOPMENT: 'development', PRODUCTION: 'production' });

export const AppConfig = Object.freeze({
  // الإنتاج يستخدم المحرك الحقيقي دائمًا. المحرك التجريبي (Mock) لا
  // يُستدعى إطلاقًا من هذه النقطة — يبقى متاحًا فقط داخل ملفات
  // الاختبار (tests/*.test.js) التي تُنشئه مباشرة عند الحاجة، تمامًا
  // كما طُلب: "Mock engines may remain only for automated testing".
  mode: AnalysisMode.PRODUCTION,

  // عنوان الـWorker الحقيقي (worker/src/index.js). الإعداد الافتراضي
  // '/api' يعمل تلقائيًا إن نُشر الـWorker على نفس نطاق الموقع عبر
  // مسار Cloudflare Route مثل "yourdomain.com/api/*" (الطريقة
  // الموصى بها في README.md — لا حاجة لإعداد CORS في هذه الحالة).
  // إن نُشر الـWorker على نطاق فرعي منفصل، غيّر هذه القيمة إلى عنوانه
  // الكامل بعد النشر (مثل: 'https://sahh-verify-worker.example.workers.dev/api').
  apiBaseUrl: '/api',

  buildDefaultEngine() {
    switch (AppConfig.mode) {
      case AnalysisMode.DEVELOPMENT:
        return new MockAnalysisEngine();
      case AnalysisMode.PRODUCTION:
        return new LiveAnalysisEngine({ apiBaseUrl: AppConfig.apiBaseUrl });
      default:
        return new LiveAnalysisEngine({ apiBaseUrl: AppConfig.apiBaseUrl });
    }
  },
});
