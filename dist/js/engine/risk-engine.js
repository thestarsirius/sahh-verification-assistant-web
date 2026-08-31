// ============================================================
// risk-engine.js
// منفصل تماماً عن الواجهة وعن أي شبكة. دالة حتمية بالكامل: نفس
// المدخلات (evidence) تُنتج دائماً نفس النتيجة. لا يوجد Math.random
// أو أي مصدر عشوائية من أي نوع. سياسة القرار محافظة: الأدلة غير
// الكافية تُنتج دائماً "يحتاج تحقق" (Yellow) وليس "آمن" (Green).
// ============================================================
import { RiskLevel, checkItem, analysisReport } from '../core/models.js';

/**
 * ============================================================
 * mergeLiveSignalsIntoReport — دمج إشارات حيّة حقيقية (من الـWorker
 * الفعلي بعد DNS resolution وHTTP fetch وتتبّع Redirects) في تقرير
 * ثابت مبني مسبقًا عبر assess(). دالة حتمية وإضافية بحتة: بدون
 * liveSignals تعيد نفس التقرير الأصلي دون أي تغيير — لا تكسر أي
 * سلوك موجود للمحرك التجريبي (Mock) الذي لا يستدعيها إطلاقًا.
 *
 * @param {ReturnType<typeof analysisReport>} baseReport
 * @param {{
 *   resolvedIps?: string[],
 *   httpOk?: boolean,
 *   finalStatusCode?: number|null,
 *   redirectCount?: number,
 *   crossDomainRedirect?: boolean,
 *   exceededMaxRedirects?: boolean,
 *   fetchError?: 'timeout'|'network'|'dns'|null,
 * }} liveSignals
 * ============================================================
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
    domainChecks.push(checkItem(true, 'تم حل النطاق إلى عنوان شبكي علني (تم استبعاد عناوين الشبكات الداخلية)'));
  }

  if (liveSignals.fetchError) {
    const errLabel = {
      timeout: 'انتهت المهلة أثناء محاولة الوصول للوجهة',
      network: 'تعذّر الاتصال بالوجهة (خطأ شبكة)',
      dns: 'تعذّر تحليل اسم النطاق (DNS)',
    }[liveSignals.fetchError] || 'تعذّر التحقق من الوجهة فعليًا';
    redirectChecks.push(checkItem(null, errLabel + ' — لم تُستخدم هذه الحالة لرفع مستوى الثقة'));
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
    redirectChecks.push(checkItem(false, 'عدد التحويلات تجاوز الحد الآمن المسموح به للفحص'));
    reasons.push('الرابط يستخدم سلسلة تحويلات طويلة بشكل غير معتاد.');
    if (level === RiskLevel.GREEN) {
      level = RiskLevel.YELLOW;
      score = Math.min(score, 55);
    }
  }

  if (liveSignals.crossDomainRedirect) {
    redirectChecks.push(checkItem(false, 'الرابط يُحوّل فعليًا إلى نطاق مختلف عن النطاق الظاهر'));
    reasons.push('رُصد تحويل فعلي إلى نطاق مختلف عن النطاق الأصلي الذي أدخلته.');
    if (level === RiskLevel.GREEN) {
      level = RiskLevel.YELLOW;
      score = Math.min(score, 50);
    }
  }

  if (redirectChecks.length === 0) {
    redirectChecks.push(checkItem(null, 'لم يتم جمع بيانات تحويلات إضافية لهذا الفحص'));
  }

  return analysisReport({
    level,
    score,
    domain: baseReport.domain,
    checks: { domain: domainChecks, redirects: redirectChecks, phishing: phishingChecks },
    reasons,
    recommendation: baseReport.recommendation,
  });
}

export class RiskEngine {
  /**
   * @param {{
   *  domain:string, isHttps:boolean, isIpLiteral:boolean, isTrustedDomain:boolean,
   *  hasSuspiciousTld:boolean, hyphenCount:number, subdomainDepth:number,
   *  hasPhishingKeyword:boolean, looksLikeBrandLookalike:boolean,
   *  hasNonAsciiOriginalLabel:boolean, isPunycode:boolean
   * }} e
   */
  assess(e) {
    const domainChecks = [];
    domainChecks.push(
      checkItem(e.isHttps, e.isHttps ? 'الاتصال مشفّر عبر HTTPS' : 'لا يستخدم الرابط اتصالاً مشفّراً (HTTPS)')
    );
    domainChecks.push(
      checkItem(
        !e.isIpLiteral,
        e.isIpLiteral ? 'النطاق عبارة عن عنوان IP مباشر، وهذا غير معتاد للجهات الرسمية' : 'النطاق باسم نصي وليس عنوان IP'
      )
    );
    if (e.isTrustedDomain) {
      domainChecks.push(checkItem(true, 'النطاق مطابق لجهة معروفة ضمن القوائم البيضاء'));
    } else {
      domainChecks.push(checkItem(null, 'النطاق غير مدرج ضمن قوائم الجهات الموثوقة المتاحة حالياً'));
    }
    if (e.looksLikeBrandLookalike) {
      domainChecks.push(checkItem(false, 'يحتوي النطاق على اسم يشبه جهة معروفة دون تطابق فعلي'));
    }
    if (e.hasSuspiciousTld) {
      domainChecks.push(checkItem(false, 'امتداد النطاق من الامتدادات الشائعة في الروابط المشبوهة'));
    }
    if (e.hyphenCount >= 2) {
      domainChecks.push(checkItem(false, 'يحتوي النطاق على عدد غير معتاد من الشرطات'));
    }
    if (e.subdomainDepth >= 4) {
      domainChecks.push(checkItem(false, 'عدد كبير من المستويات الفرعية داخل النطاق'));
    }
    if (e.hasNonAsciiOriginalLabel) {
      domainChecks.push(
        checkItem(
          e.isPunycode ? null : false,
          e.isPunycode
            ? 'تم تحويل اسم النطاق تلقائياً إلى Punycode لعرض قانوني آمن (' + e.domain + ')'
            : 'يحتوي اسم النطاق على أحرف خارج النطاق اللاتيني الأساسي (احتمال تشابه بصري/IDN)'
        )
      );
    }

    const phishingChecks = [];
    const effectiveKeywordFlag = e.hasPhishingKeyword && !e.isTrustedDomain;
    phishingChecks.push(
      effectiveKeywordFlag
        ? checkItem(false, 'يحتوي الرابط على كلمات شائعة الاستخدام في محاولات التصيّد')
        : checkItem(true, 'لم يتم رصد كلمات مرتبطة مباشرة بمحاولات التصيّد')
    );
    if (e.looksLikeBrandLookalike) {
      phishingChecks.push(checkItem(false, 'تشابه الاسم مع جهة معروفة يزيد احتمال محاولة انتحال'));
    }

    const redirectChecks = [
      checkItem(null, 'فحص التحويلات الفعلية يتطلب اتصالاً بخادم تحليل خارجي — غير مُفعّل في هذه النسخة (Requires Backend)'),
    ];

    let redFlags = 0;
    if (!e.isHttps) redFlags++;
    if (e.isIpLiteral) redFlags++;
    if (e.hasSuspiciousTld) redFlags++;
    if (e.hyphenCount >= 2) redFlags++;
    if (e.subdomainDepth >= 4) redFlags++;
    if (effectiveKeywordFlag) redFlags++;
    if (e.looksLikeBrandLookalike) redFlags++;
    if (e.hasNonAsciiOriginalLabel && !e.isPunycode) redFlags++;

    let level, score, reasons;

    if (e.isTrustedDomain) {
      level = RiskLevel.GREEN;
      score = e.isHttps ? 95 : 80;
      reasons = [
        'النطاق مطابق لجهة رسمية أو موثوقة ضمن القوائم البيضاء المتاحة.',
        e.isHttps ? 'الاتصال يستخدم تشفير HTTPS.' : 'لاحظ أن الاتصال غير مشفّر رغم كون النطاق موثوقاً.',
      ];
    } else if (redFlags >= 2) {
      level = RiskLevel.RED;
      score = Math.min(30, Math.max(5, 30 - redFlags * 5));
      reasons = [
        e.looksLikeBrandLookalike
          ? 'النطاق يحاكي اسم جهة معروفة دون أن يكون تابعاً لها فعلياً.'
          : 'النطاق يحتوي على مؤشرات اشتباه متعددة.',
        effectiveKeywordFlag ? 'استخدام كلمات مرتبطة بطلب بيانات حساسة.' : 'خصائص تقنية للنطاق غير معتادة للجهات الرسمية.',
        'لم يتم العثور على تطابق واضح مع أي جهة معروفة أو موثوقة.',
      ];
    } else {
      level = RiskLevel.YELLOW;
      score = redFlags === 1 ? 45 : 55;
      reasons = [
        'النطاق غير مدرج ضمن قوائم الجهات الموثوقة المتاحة حالياً.',
        'لا توجد بيانات كافية لإصدار نتيجة موثوقة بشكل كامل.',
        redFlags === 1
          ? 'تم رصد مؤشر واحد يستحق الانتباه دون أن يرقى لتأكيد الخطر.'
          : 'لم تُرصد مؤشرات خطر قوية، لكن هذا لا يعني ضمان السلامة.',
      ];
    }

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
        'المؤشرات المتاحة لا تُظهر خطراً واضحاً، لكن يبقى الحذر عند إدخال البيانات مسؤوليتك دائماً.',
        'تأكد أنك على الصفحة الصحيحة تماماً قبل تسجيل الدخول.',
      ],
    };

    return analysisReport({
      level,
      score,
      domain: e.domain,
      checks: { domain: domainChecks, redirects: redirectChecks, phishing: phishingChecks },
      reasons,
      recommendation: recommendationByLevel[level],
    });
  }
}
