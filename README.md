# مساعد التحقق الرقمي — Web App (Production)

أداة حقيقية لتحليل الروابط وأكواد QR: **تحقق فعلي** يشمل حل DNS حقيقي،
زيارة الوجهة فعليًا، وتتبّع تحويلات حقيقي — مع حماية SSRF/DNS rebinding
متعددة الطبقات. راجع `docs/architecture.md` و`docs/threat-model.md`
و`docs/testing-strategy.md` للتفاصيل الكاملة.

## البنية

- **الواجهة الأمامية** (`index.html`, `css/`, `js/`): موقع ثابت بدون
  أي خطوة بناء، يستدعي `LiveAnalysisEngine` الذي يتصل بـ`/api/verify`.
- **الـBackend الحقيقي**: مسارين متكافئين تمامًا (نفس المنطق بالضبط عبر
  `worker/src/verify-pipeline.js`، بدون أي ازدواجية):
  - `functions/api/` — **Cloudflare Pages Functions (المُوصى به)**:
    يُنشر تلقائيًا مع الموقع على نفس النطاق، بدون أي إعداد CORS أو
    نطاق فرعي منفصل.
  - `worker/` — **Worker مستقل** (بديل، لمن يريد نطاقًا/نشرًا منفصلاً).

## لماذا يحتاج المشروع Backend فعلي؟

لا يمكن لمتصفح المستخدم إجراء التحقق الحقيقي (حل DNS + زيارة الوجهة)
بأمان بنفسه — فعل ذلك من المتصفح يجعل أي موقع يفتحه المستخدم قادرًا
على استخدام متصفحه كوسيط SSRF نحو شبكته الداخلية. لذلك **كل** طلبات
الشبكة الفعلية (DNS-over-HTTPS + HTTP نحو الوجهة) تحدث حصرًا داخل
Cloudflare Worker/Function، وليس المتصفح.

## المتغيرات البيئية / الأسرار المطلوبة

**لا يوجد أي متغير بيئة أو Secret مطلوب للنسخة الحالية.** التحقق
يعتمد فقط على DNS-over-HTTPS المجاني من Cloudflare (`cloudflare-dns.com`)
وfetch() القياسي — بدون أي مفتاح API. عند إضافة مزوّد Threat
Intelligence حقيقي مستقبلاً (Google Safe Browsing/VirusTotal)، يُضاف
مفتاحه عبر:
```bash
npx wrangler secret put GOOGLE_SAFE_BROWSING_API_KEY
```
ولا يوضع أبدًا داخل أي كود Frontend أو ملف في هذا المستودع.

## التشغيل محليًا (اختبار حقيقي، Worker + Frontend معًا)

```bash
# 1) اختبارات المنطق الحقيقي (بدون شبكة إنترنت فعلية، لكن بمنطق حقيقي 100%)
node --test tests/*.test.js              # 102 اختبار — الواجهة
cd worker && node --test test/*.test.js  # 36 اختبار — الـWorker + Functions

# 2) تشغيل محلي فعلي مع Wrangler (يتطلب حساب Cloudflare مجاني)
cd worker && npx wrangler dev            # يشغّل الـWorker محليًا على منفذ محلي حقيقي
# في نافذة طرفية أخرى:
npx serve . -l 5173                      # يخدم الواجهة الأمامية
```

> ملاحظة: عند التشغيل المحلي بهذه الطريقة، الواجهة تستدعي `/api/verify`
> على نفس المنفذ الذي تُخدَّم منه هي — إن شغّلت الـWorker على منفذ
> مختلف محليًا، حدّث `apiBaseUrl` في `js/core/config.js` مؤقتًا إلى
> عنوان الـWorker المحلي (مثل `http://127.0.0.1:8787/api`).

## النشر على Cloudflare Pages (الطريقة المُوصى بها — الأبسط)

```bash
# من داخل مجلد المشروع الجذر (حيث يوجد functions/ وdist/)
npx wrangler pages deploy dist --project-name=sahh-verification
```

Wrangler يكتشف مجلد `functions/` تلقائيًا من نفس مسار التشغيل ويُنشره
كـBackend حقيقي على **نفس نطاق** الموقع — فتصبح `/api/verify` و
`/api/health` تعملان فورًا بدون أي إعداد CORS أو ربط يدوي.

**أو** عبر الربط بمستودع Git من لوحة تحكم Cloudflare Pages مباشرة:
اختر "Framework preset: None"، و"Build output directory: dist"، ثم
انشر — سيُكتشف `functions/` تلقائيًا.

## النشر البديل: Worker مستقل على نطاق منفصل

```bash
cd worker
npx wrangler deploy
```

بعد النشر، احصل على رابط الـWorker (مثل
`https://sahh-verify-worker.<account>.workers.dev`)، ثم حدّث
`js/core/config.js`:
```js
apiBaseUrl: 'https://sahh-verify-worker.<account>.workers.dev/api',
```
وأعد بناء/نشر الواجهة الأمامية. (هذا المسار يحتاج CORS، وهو مُفعَّل
بالفعل داخل `worker/src/index.js`.)

## اختبار حقيقي بعد النشر

```bash
curl https://your-domain.com/api/health
# المتوقع: {"status":"ok","mode":"live","engineId":"pages-function-v1"}

curl -X POST https://your-domain.com/api/verify \
  -H "Content-Type: application/json" \
  -d '{"input":"https://apple.com"}'
# المتوقع: {"kind":"success","result":{"level":"green",...}}
```

## الإعداد المستقبلي (ليس مطلوبًا الآن)

- **Live Threat Intelligence حقيقي إضافي**: أضف مزوّدًا عبر
  `js/net/threat-intelligence-provider.js` وvia `wrangler secret put`.
- **Premium/الدفع الحقيقي**: بنية `FeatureGate` جاهزة للربط لاحقًا.
- **Domain مخصص**: اربطه من لوحة Cloudflare Pages بعد شرائه، وحدّث
  `canonical`/`sitemap.xml`/`robots.txt` من قيمة `example.com`
  المؤقتة إلى نطاقك الفعلي.
- **حماية DNS rebinding الكاملة (Socket خام)**: راجع القيد الموثّق
  بأمانة في `docs/threat-model.md`.

