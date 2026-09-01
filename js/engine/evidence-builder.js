// ============================================================
// evidence-builder.js
// استخراج الأدلة الثابتة من الرابط.
// ============================================================

export const TRUSTED_DOMAINS = [
  // جهات ومنصات سعودية حكومية معروفة
  'gov.sa',
  'sa.gov.sa',
  'my.gov.sa',
  'absher.sa',
  'hrsd.gov.sa',
  'moh.gov.sa',
  'zatca.gov.sa',
  'edu.gov.sa',
  'moe.gov.sa',
  'moj.gov.sa',
  'moi.gov.sa',
  'mofa.gov.sa',
  'mc.gov.sa',
  'sdaia.gov.sa',
  'nca.gov.sa',
  'cst.gov.sa',
  'gosi.gov.sa',
  'balady.gov.sa',
  'amana.gov.sa',
  'najiz.sa',
  'etimad.sa',
  'qiwa.sa',
  'jadarat.sa',

  // جهات / خدمات موثوقة غير حكومية
  'apple.com',
  'google.com',
  'microsoft.com',
  'alrajhibank.com.sa',
  'stcpay.com.sa',
  'stc.com.sa',
  'sabb.com',
  'riyadbank.com',
];

export const SUSPICIOUS_TLDS = [
  '.tk',
  '.xyz',
  '.top',
  '.club',
  '.info',
  '.click',
  '.gq',
];

export const BRAND_LOOKALIKES = [
  'paypal',
  'apple',
  'google',
  'absher',
  'stc',
  'bank',
  'rajhi',
  'amazon',
  'netflix',
];

export function isTrustedDomain(domain) {
  const normalized = String(domain || '').toLowerCase().replace(/\.$/, '');

  return TRUSTED_DOMAINS.some(
    (trusted) =>
      normalized === trusted ||
      normalized.endsWith('.' + trusted)
  );
}

const PHISHING_KEYWORDS = [
  'login',
  'verify',
  'secure',
  'update',
  'account',
  'bank',
  'gift',
  'prize',
  'free',
  'confirm',
  'password',
  'wallet',
  'unlock',
];

export function containsPhishingKeyword(hostAndPath) {
  const s = (hostAndPath || '').toLowerCase();
  return PHISHING_KEYWORDS.some((k) => s.includes(k));
}

/**
 * @param {URL} normalizedUrl
 * @param {{
 *   domain:string,
 *   hasNonAsciiOriginalLabel:boolean,
 *   isPunycode:boolean
 * }} canonical
 * @returns evidence object consumed directly by RiskEngine.assess()
 */
export function buildStaticEvidence(normalizedUrl, canonical) {
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(
    normalizedUrl.hostname
  );

  const hyphenCount =
    (canonical.domain.match(/-/g) || []).length;

  const suspiciousTld =
    SUSPICIOUS_TLDS.some((t) =>
      canonical.domain.endsWith(t)
    );

  const subdomainDepth =
    canonical.domain.split('.').length;

  const trusted =
    isTrustedDomain(canonical.domain);

  const fullPath =
    (
      normalizedUrl.hostname +
      normalizedUrl.pathname
    ).toLowerCase();

  const hasKeyword =
    containsPhishingKeyword(fullPath);

  const lookalike =
    !trusted &&
    BRAND_LOOKALIKES.some((b) =>
      canonical.domain.includes(b)
    );

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
    hasNonAsciiOriginalLabel:
      canonical.hasNonAsciiOriginalLabel,
    isPunycode:
      canonical.isPunycode,
  };
}
