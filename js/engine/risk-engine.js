// ============================================================
// risk-engine.js
// Risk Engine — حتمي بالكامل وبدون شبكة.
// التصنيف:
// 🟢 GREEN  = موثوق / لا توجد مؤشرات خطر مهمة
// 🟡 YELLOW = يحتاج إلى تحقق
// 🔴 RED    = غير موثوق / توجد مؤشرات خطر قوية
//
// ملاحظة مهمة:
// GREEN لا تعني ضمان السلامة 100%، بل تعني أن الأدلة التقنية
// المتاحة لا تظهر مؤشرات خطر مهمة.
// ============================================================
import { RiskLevel, checkItem, analysisReport } from '../core/models.js';
/**
 * دمج الإشارات الحية القادمة من الـWorker مع التقرير الأساسي.
 */
export function mergeLiveSignalsIntoReport(baseReport, liveSignals) {
  if (!liveSignals) return baseReport;
  const domainChecks = [...baseReport.checks.domain];
  const redirectChecks = [];
  const phishingChecks = [...baseReport.checks.phishing];
  const reasons = [...baseReport.reasons];
  let level = baseReport.level;
  let score = baseReport.score;
  if (liveSignals.resolvedIps && liveSignals.resolvedIps.length > 0) {
    domainChecks.push(
      checkItem(
        true,
        'تم حل النطاق إلى عنوان شبكي علني وتم استبعاد عناوين الشبكات الداخلية'
      )
    );
  }
  if (liveSignals.fetchError) {
    const errLabel = {
      timeout: 'انتهت المهلة أثناء محاولة الوصول للوجهة',
      network: 'تعذّر الاتصال بالوجهة (خطأ شبكة)',
      dns: 'تعذّر تحليل اسم النطاق (DNS)',
    }[liveSignals.fetchError] || 'تعذّر التحقق من الوجهة فعليًا';
    redirectChecks.push(
      checkItem(null, errLabel + ' — لم تُستخدم هذه الحالة لرفع مستوى الثقة')
    );
  } else if (typeof liveSignals.redirectCount === 'number') {
    redirectChecks.push(
      checkItem(
        liveSignals.redirectCount === 0,
        liveSignals.redirectCount === 0
          ? 'لا توجد تحويلات (Redirects) على المسار المباشر للرابط'
          : `تم رصد ${liveSignals.redirectCount} عملية تحويل قبل الوصول للوجهة النهائية`
      )
    );
  }
  if (liveSignals.exceededMaxRedirects) {
    redirectChecks.push(
      checkItem(false, 'عدد التحويلات تجاوز الحد الآمن المسموح به للفحص')
    );
    reasons.push('الرابط يستخدم سلسلة تحويلات طويلة بشكل غير معتاد.');
    level = RiskLevel.RED;
    score = Math.min(score, 25);
  }
  if (liveSignals.crossDomainRedirect) {
    redirectChecks.push(
      checkItem(
        false,
        'الرابط يُحوّل فعليًا إلى نطاق مختلف عن النطاق الظاهر'
      )
    );
    reasons.push(
      'رُصد تحويل فعلي إلى نطاق مختلف عن النطاق الأصلي الذي أدخلته.'
    );
    if (level !== RiskLevel.RED) {
      level = RiskLevel.YELLOW;
      score = Math.min(score, 50);
    }
  }
  if (redirectChecks.length === 0) {
    redirectChecks.push(
      checkItem(null, 'لم يتم جمع بيانات تحويلات إضافية لهذا الفحص')
    );
  }
  return analysisReport({
    level,
    score,
    domain: baseReport.domain,
    checks: {
      domain: domainChecks,
      redirects: redirectChecks,
      phishing: phishingChecks,
    },
    reasons,
    recommendation: baseReport.recommendation,
  });
}
export class RiskEngine {
  /**
   * @param {{
   *  domain:string,
   *  isHttps:boolean,
   *  isIpLiteral:boolean,
   *  isTrustedDomain:boolean,
   *  hasSuspiciousTld:boolean,
   *  hyphenCount:number,
   *  subdomainDepth:number,
   *  hasPhishingKeyword:boolean,
   *  looksLikeBrandLookalike:boolean,
   *  hasNonAsciiOriginalLabel:boolean,
   *  isPunycode:boolean
   * }} e
   */
  assess(e) {
    const domainChecks = [];
    // ============================================================
    // DOMAIN CHECKS
    // ============================================================
    domainChecks.push(
      checkItem(
        e.isHttps,
        e.isHttps
          ? 'الاتصال مشفّر عبر HTTPS'
          : 'لا يستخدم الرابط اتصالاً مشفّراً (HTTPS)'
      )
    );
    domainChecks.push(
      checkItem(
        !e.isIpLiteral,
        e.isIpLiteral
          ? 'النطاق عبارة عن عنوان IP مباشر، وهذا غير معتاد للجهات الرسمية'
          : 'النطاق يستخدم اسم نطاق وليس عنوان IP مباشر'
      )
    );
    if (e.isTrustedDomain) {
      domainChecks.push(
        checkItem(
          true,
          'النطاق مطابق لجهة معروفة ضمن القوائم البيضاء'
        )
      );
    } else {
      domainChecks.push(
        checkItem(
          null,
          'النطاق غير مدرج ضمن قوائم الجهات الموثوقة المتاحة حالياً'
        )
      );
    }
    if (e.looksLikeBrandLookalike) {
      domainChecks.push(
        checkItem(
          false,
          'يحتوي النطاق على اسم يشبه جهة معروفة دون تطابق فعلي'
        )
      );
    }
    if (e.hasSuspiciousTld) {
      domainChecks.push(
        checkItem(
          false,
          'امتداد النطاق من الامتدادات الشائعة في الروابط المشبوهة'
        )
      );
    }
    if (e.hyphenCount >= 2) {
      domainChecks.push(
        checkItem(
          false,
          'يحتوي النطاق على عدد غير معتاد من الشرطات'
        )
      );
    }
    if (e.subdomainDepth >= 4) {
      domainChecks.push(
        checkItem(
          false,
          'عدد كبير من المستويات الفرعية داخل النطاق'
        )
      );
    }
    if (e.hasNonAsciiOriginalLabel) {
      domainChecks.push(
        checkItem(
          e.isPunycode ? null : false,
          e.isPunycode
            ? `تم تحويل اسم النطاق تلقائياً إلى Punycode لعرض قانوني آمن (${e.domain})`
            : 'يحتوي اسم النطاق على أحرف خارج النطاق اللاتيني الأساسي (احتمال تشابه بصري/IDN)'
        )
      );
    }
    // ============================================================
    // PHISHING CHECKS
    // ============================================================
    const phishingChecks = [];
    const effectiveKeywordFlag =
      e.hasPhishingKeyword && !e.isTrustedDomain;
    if (effectiveKeywordFlag) {
      phishingChecks.push(
        checkItem(
          false,
          'يحتوي الرابط على كلمات شائعة الاستخدام في محاولات التصيّد'
        )
      );
    } else {
      phishingChecks.push(
        checkItem(
          true,
          'لم يتم رصد كلمات مرتبطة مباشرة بمحاولات التصيّد'
        )
      );
    }
    if (e.looksLikeBrandLookalike) {
      phishingChecks.push(
        checkItem(
          false,
          'تشابه الاسم مع جهة معروفة يزيد احتمال محاولة انتحال'
        )
      );
    }
    // ============================================================
    // RED FLAGS
    // ============================================================
    let redFlags = 0;
    if (!e.isHttps) redFlags++;
    if (e.isIpLiteral) redFlags++;
    if (e.hasSuspiciousTld) redFlags++;
    if (e.hyphenCount >= 2) redFlags++;
    if (e.subdomainDepth >= 4) redFlags++;
    if (effectiveKeywordFlag) redFlags++;
    if (e.looksLikeBrandLookalike) redFlags++;
    if (e.hasNonAsciiOriginalLabel && !e.isPunycode) redFlags++;
    // ============================================================
    // POSITIVE SIGNALS
    // ============================================================
    let positiveSignals = 0;
    if (e.isHttps) positiveSignals++;
    if (!e.isIpLiteral) positiveSignals++;
    if (!e.hasSuspiciousTld) positiveSignals++;
    if (e.hyphenCount < 2) positiveSignals++;
    if (e.subdomainDepth < 4) positiveSignals++;
    if (!effectiveKeywordFlag) positiveSignals++;
    if (!e.looksLikeBrandLookalike) positiveSignals++;
    if (!e.hasNonAsciiOriginalLabel || e.isPunycode) positiveSignals++;
    // ============================================================
    // FINAL CLASSIFICATION
    // ============================================================
    let level;
    let score;
    let reasons;
    // ------------------------------------------------------------
    // 1. Trusted allowlist
    // ------------------------------------------------------------
    if (e.isTrustedDomain) {
      level = RiskLevel.GREEN;
      score = e.isHttps ? 98 : 85;
      reasons = [
        'النطاق مطابق لجهة معروفة أو موثوقة ضمن القوائم البيضاء المتاحة.',
        e.isHttps
          ? 'الاتصال يستخدم تشفير HTTPS.'
          : 'النطاق موثوق، لكن الاتصال لا يستخدم HTTPS.',
      ];
    }
    // ------------------------------------------------------------
    // 2. Strong danger
    // ------------------------------------------------------------
    else if (
      e.looksLikeBrandLookalike ||
      redFlags >= 3
    ) {
      level = RiskLevel.RED;
      score = Math.max(
        5,
        Math.min(30, 30 - redFlags * 5)
      );
      reasons = [
        e.looksLikeBrandLookalike
          ? 'النطاق يحاكي اسم جهة معروفة دون أن يكون تابعاً لها فعلياً.'
          : 'النطاق يحتوي على عدة مؤشرات اشتباه تقنية.',
        effectiveKeywordFlag
          ? 'تم رصد كلمات مرتبطة بمحاولات التصيّد أو طلب بيانات حساسة.'
          : 'تم رصد خصائص تقنية غير معتادة في النطاق.',
        'يوصى بعدم إدخال بيانات شخصية أو مالية عبر هذا الرابط.',
      ];
    }
    // ------------------------------------------------------------
    // 3. One or two suspicious signals
    // ------------------------------------------------------------
    else if (redFlags === 1 || redFlags === 2) {
      level = RiskLevel.YELLOW;
      score =
        redFlags === 1
          ? 58
          : 42;
      reasons = [
        'تم رصد بعض المؤشرات التي تستحق الانتباه.',
        'لا توجد أدلة كافية حالياً للحكم بأن الرابط ضار بشكل مؤكد.',
        'يفضل التحقق من الجهة عبر قناة رسمية قبل إدخال البيانات.',
      ];
    }
    // ------------------------------------------------------------
    // 4. Clean / low-risk URL
    // ------------------------------------------------------------
    else if (
      e.isHttps &&
      !e.isIpLiteral &&
      !e.hasSuspiciousTld &&
      !e.looksLikeBrandLookalike &&
      !effectiveKeywordFlag &&
      e.hyphenCount < 2 &&
      e.subdomainDepth < 4 &&
      (!e.hasNonAsciiOriginalLabel || e.isPunycode) &&
      positiveSignals >= 7
    ) {
      level = RiskLevel.GREEN;
      score = 85 + Math.min(
        10,
        positiveSignals
      );
      reasons = [
        'لم يتم رصد مؤشرات خطر تقنية قوية في الرابط.',
        'النطاق يستخدم HTTPS وبنية نطاق طبيعية.',
        'لم يتم رصد مؤشرات واضحة على التصيّد أو انتحال جهة معروفة.',
        'هذه النتيجة تعني أن المؤشرات المتاحة تبدو سليمة، وليست ضماناً مطلقاً للسلامة.',
      ];
    }
    // ------------------------------------------------------------
    // 5. Insufficient evidence
    // ------------------------------------------------------------
    else {
      level = RiskLevel.YELLOW;
      score = 55;
      reasons = [
        'لم يتم العثور على مؤشرات خطر قوية.',
        'لكن النطاق غير مدرج ضمن قوائم الجهات الموثوقة المتاحة حالياً.',
        'الأدلة المتاحة غير كافية لإصدار حكم موثوق بشكل كامل.',
      ];
    }
    // ============================================================
    // RECOMMENDATIONS
    // ============================================================
    const recommendationByLevel = {
      [RiskLevel.RED]: [
        'لا تُدخل بياناتك الشخصية أو بيانات بطاقتك عبر هذا الرابط.',
        'لا تُدخل كلمة المرور في الصفحة قبل التحقق من النطاق.',
        'إذا كنت تتوقع رسالة من جهة معينة، تواصل معها عبر قناتها الرسمية مباشرة.',
      ],
      [RiskLevel.YELLOW]: [
        'تحقق من الجهة عبر موقعها أو تطبيقها الرسمي قبل إدخال أي بيانات.',
        'لا تدخل بياناتك الشخصية قبل التأكد من الجهة المرسلة.',
        'يفضل عدم فتح الرابط إذا لم تكن تتوقع استلامه.',
      ],
      [RiskLevel.GREEN]: [
        'المؤشرات المتاحة لا تُظهر خطراً واضحاً.',
        'تأكد أنك على الصفحة الصحيحة تماماً قبل تسجيل الدخول.',
        'لا تشارك معلومات حساسة إلا مع الجهة التي تتأكد من هويتها.',
      ],
    };
    // ============================================================
    // FINAL REPORT
    // ============================================================
    return analysisReport({
      level,
      score,
      domain: e.domain,
      checks: {
        domain: domainChecks,
        redirects: [
          checkItem(
            null,
            'فحص التحويلات الفعلية يتم عبر الـWorker عند توفر بيانات الشبكة'
          ),
        ],
        phishing: phishingChecks,
      },
      reasons,
      recommendation:
        recommendationByLevel[level],
    });
  }
}
