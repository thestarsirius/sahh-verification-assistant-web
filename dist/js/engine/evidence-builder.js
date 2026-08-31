// ============================================================
// evidence-builder.js
// استخراج "الأدلة" الثابتة (Static Evidence) من رابط مُطبَّع ومُقنَّن —
// منطق نقي بلا أي اعتماد على DOM أو Node أو Worker، لذلك يُستخدم
// حرفيًا من نفس الملف في: (أ) المتصفح عبر MockAnalysisEngine للعرض
// التجريبي دون شبكة، و(ب) Cloudflare Worker الحقيقي كطبقة التحليل
// الثابتة قبل إضافة الإشارات الحيّة (DNS/HTTP/Redirects).
// هذا يمنع ازدواجية المنطق بين البيئتين ويضمن اتساق النتائج.
// ============================================================
export const TRUSTED_DOMAINS = [
  'apple.com', 'google.com', 'microsoft.com', 'absher.sa', 'sa.gov.sa',
  'my.gov.sa', 'alrajhibank.com.sa', 'stcpay.com.sa', 'stc.com.sa',
  'sabb.com', 'riyadbank.com', 'hrsd.gov.sa', 'moh.gov.sa', 'zatca.gov.sa',
];
export const SUSPICIOUS_TLDS = ['.tk', '.xyz', '.top', '.club', '.info', '.click', '.gq'];
export const BRAND_LOOKALIKES = ['paypal', 'apple', 'google', 'absher', 'stc', 'bank', 'rajhi', 'amazon', 'netflix'];

export function isTrustedDomain(domain) {
  return TRUSTED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

const PHISHING_KEYWORDS = [
  'login', 'verify', 'secure', 'update', 'account', 'bank', 'gift',
  'prize', 'free', 'confirm', 'password', 'wallet', 'unlock',
];
export function containsPhishingKeyword(hostAndPath) {
  const s = (hostAndPath || '').toLowerCase();
  return PHISHING_KEYWORDS.some((k) => s.includes(k));
}

/**
 * @param {URL} normalizedUrl
 * @param {{domain:string, hasNonAsciiOriginalLabel:boolean, isPunycode:boolean}} canonical
 * @returns evidence object consumed directly by RiskEngine.assess()
 */
export function buildStaticEvidence(normalizedUrl, canonical) {
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedUrl.hostname);
  const hyphenCount = (canonical.domain.match(/-/g) || []).length;
  const suspiciousTld = SUSPICIOUS_TLDS.some((t) => canonical.domain.endsWith(t));
  const subdomainDepth = canonical.domain.split('.').length;
  const trusted = isTrustedDomain(canonical.domain);
  const fullPath = (normalizedUrl.hostname + normalizedUrl.pathname).toLowerCase();
  const hasKeyword = containsPhishingKeyword(fullPath);
  const lookalike = !trusted && BRAND_LOOKALIKES.some((b) => canonical.domain.includes(b));

  return {
    domain: canonical.domain,
    isHttps: normalizedUrl.protocol === 'https:',
    isIpLiteral: isIp,
    isTrustedDomain: trusted,
    hasSuspiciousTld: suspiciousTld,
    hyphenCount,
    subdomainDepth,
    hasPhishingKeyword: hasKeyword,
    looksLikeBrandLookalike: lookalike,
    hasNonAsciiOriginalLabel: canonical.hasNonAsciiOriginalLabel,
    isPunycode: canonical.isPunycode,
  };
}
