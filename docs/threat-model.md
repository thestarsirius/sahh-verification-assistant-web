# نموذج التهديدات (Threat Model) — مساعد التحقق الرقمي (Web)

> **مبدأ أساسي يحكم هذا المستند بالكامل:**
> التحقق من جانب العميل (Client-side validation) هو طبقة دفاع إضافية
> (Defense-in-Depth)، **وليس** الحد الأمني النهائي (Security Boundary).
> جميع طلبات الشبكة الفعلية (DNS + HTTP) تتم **حصرًا** داخل
> Cloudflare Worker (`worker/src/`) — **لا يُجري متصفح المستخدم أي
> اتصال شبكة نحو الرابط المفحوص إطلاقًا**، لأن السماح للمتصفح بذلك
> مباشرة يجعله عرضة لأن يُستخدم كأداة SSRF بحد ذاته.

## الأصول (Assets)

- خصوصية المستخدم (لا حسابات، لا تخزين روابط خام دائم).
- سلامة نتائج التحليل المعروضة (عدم تضليل المستخدم بثقة زائفة).
- بيانات السجل المحلي (ملخصات فقط، بدون محتوى خام).
- الشبكة الداخلية لبنية Cloudflare (يجب ألا يصبح الـWorker وسيطًا SSRF).

## الجهات المهاجمة المحتملة (Threat Actors)

- مهاجم يرسل رابطًا/كود QR خبيثًا للمستخدم النهائي.
- مهاجم يحاول استغلال **الـWorker نفسه** كوسيط لفحص/الوصول لشبكة
  داخلية عبر رابط مُصمَّم خصيصًا (هذا هو التهديد الأساسي الآن بعد أن
  أصبح الـWorker يُجري طلبات شبكة حقيقية).

## سطح الهجوم الحقيقي والتخفيفات الفعلية المُنفَّذة

| التهديد | الوضع | التخفيف الفعلي المُنفَّذ | الدليل | المخاطرة المتبقية |
|---|---|---|---|---|
| SSRF عبر رابط أولي يشير مباشرة لعنوان داخلي/loopback/metadata | **مُخفَّف فعليًا** | `SsrfGuard.isBlockedHost()` يُفحص على المضيف الحرفي **قبل** أي DNS أو HTTP، داخل `worker/src/index.js` و`worker/src/dns.js` | `worker/test/index.test.js` (اختبار: SSRF target رفض دون استدعاء fetch إطلاقًا) | منخفضة |
| **DNS Rebinding** (نطاق يبدو بريئًا لكنه يُحلّ فعليًا إلى IP داخلي) | **مُخفَّف فعليًا** | `resolveAndValidateHostname()` يحلّ DNS حقيقيًا عبر DoH **قبل** أي طلب HTTP، ويرفض إن كان أي عنوان IP ناتج محظورًا — يحدث هذا الفحص عند **كل قفزة تحويل** أيضًا، وليس فقط الرابط الأصلي | `worker/test/dns.test.js` (اختبار "attacker-controlled-domain") و`worker/test/redirect-fetch.test.js` (اختبار "blocked mid-chain") | **فجوة TOCTOU متبقية وموثّقة**: التحقق يتم عبر استعلام DoH منفصل قبل استدعاء `fetch()` القياسي، وليس عبر Socket خام مثبَّت على نفس العنوان المُتحقَّق منه. نظريًا يمكن لمهاجم متقدم جدًا (يتحكم بخادم DNS الخاص به) تغيير الإجابة بين الفحص والاتصال الفعلي خلال هذه المدة القصيرة جدًا. **الحل الكامل** يتطلب استخدام `cloudflare:sockets` لفتح اتصال TCP/TLS خام مثبَّت يدويًا على IP المُتحقَّق منه بالضبط — لم يُنفَّذ في هذه النسخة بسبب تعقيده العالي وعدم القدرة على اختباره بثقة كافية دون بيئة تشغيل Cloudflare Workers حقيقية متاحة لنا وقت التطوير. |
| تحويلات خبيثة (Malicious redirects) إلى نطاق مختلف | **مُخفَّف فعليًا** | كل قفزة تحويل تمر عبر نفس خط الأنابيب الكامل (Validate→Normalize→DNS→SSRF) من جديد؛ تغيّر النطاق يُرصد ويُخفّض مستوى الثقة (`crossDomainRedirect`) | `worker/test/redirect-fetch.test.js`, `tests/live-signals-merge.test.js` | منخفضة |
| حلقات/سلاسل تحويل طويلة جدًا (Resource exhaustion) | **مُخفَّف فعليًا** | حد أقصى 5 تحويلات (`maxRedirects`)، مهلة إجمالية 12 ثانية (`overallDeadlineMs`) | `worker/test/redirect-fetch.test.js` (اختبار "exceeding max redirects") | منخفضة |
| استجابة ضخمة جدًا من الوجهة (Resource exhaustion) | **مُخفَّف فعليًا** | قراءة الجسم تتوقف وتُلغى فور تجاوز حد 2MB (`maxBytes`)، دون تحميله كاملاً في الذاكرة | `worker/test/redirect-fetch.test.js` (اختبار "response body larger than maxBytes") | منخفضة |
| روابط طويلة جدًا | **مُخفَّف فعليًا** | `UrlValidator` يرفض أي مدخل أطول من 2048 حرفًا | `tests/url.test.js` | منخفضة |
| مخططات خطرة (`javascript:`, `data:`, `file:`) — حتى داخل `Location` الخاص بتحويل | **مُخفَّف فعليًا** | `UrlNormalizer` يرفض أي مخطط غير `http`/`https` صراحة، ونفس الفحص يُطبَّق على كل `Location` header أثناء تتبّع التحويلات | `tests/url.test.js`, `worker/test/redirect-fetch.test.js` (اختبار "disallowed scheme") | منخفضة |
| مهلة زمنية غير محدودة (Hanging requests) | **مُخفَّف فعليًا** | `AbortController` بمهلة 5 ثوانٍ لكل طلب DNS/HTTP فرعي | `worker/test/dns.test.js`, `worker/test/redirect-fetch.test.js` | منخفضة |
| اختلاق نتيجة "آمن" عند تعذّر التحقق (DNS/Network/Timeout Failure) | **مُخفَّف فعليًا ومُختبر** | `mergeLiveSignalsIntoReport()` لا يرفع مستوى الثقة أبدًا عند وجود `fetchError`؛ نطاق غير موثوق مع تعذّر تحقق حي يبقى على الأقل Yellow، أبدًا Green | `tests/live-signals-merge.test.js`, `worker/test/index.test.js` (اختبار "DNS failure... never fabricated GREEN") | منخفضة |
| هجمات Homograph/IDN | **مُخفَّف جزئيًا** | تحويل Punycode التلقائي عبر WHATWG `URL`، يُعرض كمؤشر صريح | `tests/url.test.js` | القائمة السوداء لأسماء العلامات محدودة يدويًا |
| تسريب بيانات حساسة عبر Logs | **مُخفَّف فعليًا** | `SecureLogger` يُنقّي أي نص يشبه رابطًا/بريدًا؛ `console.error` في الـWorker يسجّل فقط `e.message` العام دون الرابط الخام | `tests/core-services.test.js` | منخفضة |
| تخزين دائم غير مقصود لبيانات خام | **مُخفَّف فعليًا ومُختبر** | لا يوجد أي تخزين على مستوى الـWorker إطلاقًا (Stateless بالكامل)؛ `HistoryEntry` في المتصفح لا يحتوي حقل url | `tests/core-services.test.js` | منخفضة |

## المخاطرة المتبقية الوحيدة الجديرة بالذكر

**فجوة TOCTOU بين فحص DNS واتصال fetch() الفعلي** (مشروحة أعلاه). هذا
تخفيف حقيقي وقوي (وليس شكليًا) — يمنع الغالبية العظمى من سيناريوهات
DNS rebinding العملية، لكنه ليس حصانة رياضية مطلقة. الحل الكامل موثّق
أعلاه (`cloudflare:sockets`) كخطوة تحصين مستقبلية عند توفر بيئة اختبار
حقيقية على Cloudflare.

