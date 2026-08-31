# البنية المعمارية — مساعد التحقق الرقمي (Web)

## لماذا الويب (Vanilla JS/HTML/CSS بدون إطار عمل)؟

طُلب في هذه المرحلة اختيار التقنية الأنسب من ناحية SEO وAdaء وBrowser
APIs وPWA وSuitability للنشر المجاني، مع تبرير الاختيار إن لم يكن
Flutter Web (الذي استُخدم في نسخة سابقة من المشروع).

تم اختيار **HTML/CSS/JavaScript عادي (ES Modules, بدون أي إطار عمل أو
خطوة بناء/Bundler)** للأسباب التالية:

1. **SEO حقيقي أفضل**: صفحات `/about.html` و`/privacy.html` و
   `/terms.html` و`/security.html` هي HTML كامل يُفهرَّس مباشرة بدون
   الحاجة لتشغيل JavaScript من محرك البحث — على عكس تطبيقات
   Client-Side-Rendered الثقيلة (بما فيها Flutter Web) التي تعاني
   تاريخيًا من ضعف الفهرسة وحجم Bundle كبير جدًا.
2. **الأداء**: لا يوجد إطار عمل أو Runtime إضافي يُحمَّل — الصفحة
   الرئيسية تحمّل فقط CSS + JS خاصين بالمشروع، بدون أي مكتبة CDN
   خارجية إطلاقًا (متطلب صريح لهذه المرحلة).
3. **Browser APIs مباشرة**: الوصول لكاميرا الجهاز (`getUserMedia`)
   وقراءة أكواد QR (`BarcodeDetector`) يتم مباشرة بدون طبقة تجريد
   إضافية، ما يقلل نقاط الفشل المحتملة.
4. **PWA أصلي**: `manifest.webmanifest` و`service-worker.js` قياسيان
   ومدعومان في كل المتصفحات الحديثة بدون أي إعداد إضافي.
5. **قابلية التحقق داخل بيئة التطوير الحالية**: منطق التحليل مكتوب
   كوحدات ES Module عادية تعمل في كل من المتصفح و Node.js بدون أي
   تعديل — هذا سمح فعليًا بتشغيل **89 اختبار Node حقيقي منفَّذ** (انظر
   `docs/testing-strategy.md`)، بخلاف أي تقنية تتطلب Bundler/SDK غير
   متاح في بيئة التنفيذ الحالية (لا يوجد اتصال إنترنت لتثبيت حزم جديدة).
6. **قابلية النقل للهاتف لاحقًا**: منطق `js/core`, `js/url`,
   `js/engine`, `js/domain`, `js/app` مكتوب بمعزل تام عن أي DOM API —
   قابل لإعادة الاستخدام لاحقًا في React Native/Flutter كمرجع منطقي، أو
   تحويله مباشرة إلى تطبيق React Native عبر نفس البنية.

## طبقات النظام

```
UI (js/ui, js/main.js, index.html)
        │  لا يحتوي على أي منطق تحليل
        ▼
AnalysisController (js/app)
        │  Constructor Injection — لا Singleton عام
        ▼
IAnalysisEngine (duck-typed contract)
   ├── MockAnalysisEngine (js/engine/mock-engine.js)
   └── LiveAnalysisEngine (js/engine/live-engine.js)
        │
        ▼
Pipeline: Validator → Normalizer → Canonicalizer → SsrfGuard → Evidence → RiskEngine
   (js/url/*, js/engine/risk-engine.js)
        │
        ▼
AnalysisReport / AnalysisError (js/core/models.js, js/core/analysis-error.js)
        │
        ▼
StorageService (js/core/storage.js) — يحفظ ملخص النتيجة فقط، محليًا (localStorage)
```

## Dependency Injection

`AnalysisController` (`js/app/analysis-controller.js`) لا يبني أي
تبعية داخليًا — يستقبل `engine`, `storageService`, `cache`,
`connectivity`, `featureGate` عبر المُنشئ. نقطة التركيب الوحيدة
(Composition Root) هي `js/main.js` في المتصفح، أو كل ملف اختبار على
حدة في `tests/*.test.js`. هذا يسمح باستبدال `MockAnalysisEngine` بـ
`LiveAnalysisEngine` (أو بأي Mock إضافي للاختبار) دون تعديل أي شاشة.

## Mock مقابل Live

القرار الوحيد بين الاثنين موجود في `js/core/config.js`
(`AppConfig.mode`). القيمة الحالية `development` دائمًا، ولا يوجد أي
منطق آخر في المشروع يبدّل المحرك بصمت. `LiveAnalysisEngine` بدون
`provider` حقيقي يعيد دائمًا فشل `PROVIDER_UNAVAILABLE` — لا يتحول أبدًا
لمحاكاة النتيجة.

## Threat Intelligence مستقبليًا

`js/net/threat-intelligence-provider.js` يعرّف العقد المطلوب
(`providerId`, `check(canonicalUrl)`) دون أي تنفيذ فعلي. أي تطبيق حقيقي
له (GoogleSafeBrowsingProvider، VirusTotalProvider، ...) يجب أن يستدعي
Backend/Secure Proxy خاص بالمالك — لا يوضع أي API Key داخل كود
الواجهة الأمامية إطلاقًا.

## معالجة الأخطاء

كل مخرجات المحرك تمر عبر `engineSuccess`/`engineFailure`
(`js/domain/i-analysis-engine.js`) — لا استثناءات خام تصل للواجهة.
`AnalysisError` (`js/core/analysis-error.js`) يحدد فئة الخطأ ورسالة
عربية واضحة وهل يمكن إعادة المحاولة. الواجهة (`main.js`) تعرض فقط
`error.userMessage` وتُظهر زر "إعادة المحاولة" إن كان `retryable`.

## استراتيجية الاختبار

راجع `docs/testing-strategy.md` للتفاصيل الكاملة، وملخص النتائج
الفعلية في التقرير النهائي المرفق مع هذا التسليم.
