# الخصوصية، الأمان، حقن التبعيات، ومعالجة الأخطاء — ملخص موحّد

هذا الملف يجمع الإشارات المطلوبة صراحة في تقارير المراجعة، ويوجّه لكل
تفصيل حيث هو موثّق فعليًا في الكود أو مستندات أخرى.

## Privacy (الخصوصية)
موثّقة بالتفصيل في `privacy.html` (صفحة مستخدم) وهذا الملخص التقني:
- لا حسابات/تسجيل دخول: لا يوجد أي كود لإدارة مستخدمين في المشروع كاملاً.
- لا تخزين رابط خام: `js/core/models.js#historyEntryFromReport` لا يضع
  حقل `url`/`domain` في كائن السجل المحفوظ — مُختبر في
  `tests/core-services.test.js`.
- لا صور/مستندات تُخزَّن: لا يوجد أي كود قراءة/تخزين ملفات في المشروع.
- تخزين محلي فقط: `js/core/storage.js` يستخدم `localStorage` حصرًا،
  بدون أي طلب شبكة لحفظ البيانات.

## Security (الأمان)
راجع `docs/threat-model.md` للتفاصيل الكاملة و`security.html` للنسخة
المخصصة للمستخدم العادي. أهم النقاط:
- SSRF guard دفاع إضافي فقط، وليس حدًا أمنيًا نهائيًا (موثّق صراحة في
  تعليقات `js/url/ssrf-guard.js` وفي threat-model.md).
- لا تُتَّبع أي تحويلات فعليًا (`NotConfiguredRedirectResolver`).
- مخططات مرفوضة صراحة: أي شيء غير `http`/`https`.

## Dependency Injection (حقن التبعيات)
`js/app/analysis-controller.js` يستقبل كل تبعياته عبر المُنشئ (لا
Singleton). نقطة التركيب الوحيدة: `js/main.js` (للمتصفح) أو داخل كل
اختبار (`tests/*.test.js`). راجع `docs/architecture.md` قسم "Dependency
Injection" و"Mock مقابل Live" للتفاصيل الكاملة مع أمثلة.

## Threat Intelligence Integration (التكامل المستقبلي)
`js/net/threat-intelligence-provider.js` يعرّف العقد فقط
(`providerId`, `check()`)، بدون أي تنفيذ. `js/engine/live-engine.js`
يوضح كيف يُستقبل provider عبر المُنشئ ولا يُستخدم فعليًا في هذه النسخة.

## Error Handling (معالجة الأخطاء)
`js/core/analysis-error.js` يحدد كل فئات الخطأ الممكنة
(`ErrorCategory`) مع رسالة عربية وهل قابل لإعادة المحاولة. كل مخرجات
المحرك تمر عبر `engineSuccess`/`engineFailure`
(`js/domain/i-analysis-engine.js`) — لا استثناءات خام تصل للواجهة أبدًا
(محاطة بـ`try/catch` في `js/engine/mock-engine.js`).

## Testing Strategy (استراتيجية الاختبار)
راجع `docs/testing-strategy.md` للتفصيل الكامل ونتائج التشغيل الفعلية.
