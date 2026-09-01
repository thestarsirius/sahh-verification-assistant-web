export const TRUSTED_DOMAINS = [
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
  'najiz.sa',
  'etimad.sa',
  'qiwa.sa',
  'jadarat.sa',

  'apple.com',
  'google.com',
  'microsoft.com',
  'alrajhibank.com.sa',
  'stcpay.com.sa',
  'stc.com.sa',
  'sabb.com',
  'riyadbank.com'
];

export const SUSPICIOUS_TLDS = [
  '.tk',
  '.xyz',
  '.top',
  '.club',
  '.info',
  '.click',
  '.gq'
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
  'netflix'
];

export function isTrustedDomain(domain) {
  const normalized = String(domain || '')
    .toLowerCase()
    .replace(/\.$/, '');

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
  'unlock'
];

export function containsPhishingKeyword(hostAndPath) {
  const s = String(hostAndPath || '').toLowerCase();

  return PHISHING_KEYWORDS.some((keyword) =>
    s.includes(keyword)
  );
}

export function buildStaticEvidence(normalizedUrl, canonical) {
  const domain = canonical.domain;

  const isIp =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(
      normalizedUrl.hostname
    );

  const hyphenCount =
    (domain.match(/-/g) || []).length;

  const suspiciousTld =
    SUSPICIOUS_TLDS.some((tld) =>
      domain.endsWith(tld)
    );

  const subdomainDepth =
    domain.split('.').length;

  const trusted =
    isTrustedDomain(domain);

  const fullPath =
    (
      normalizedUrl.hostname +
      normalizedUrl.pathname
    ).toLowerCase();

  const hasKeyword =
    containsPhishingKeyword(fullPath);

  const lookalike =
    !trusted &&
    BRAND_LOOKALIKES.some((brand) =>
      domain.includes(brand)
    );

  return {
    domain,
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
      canonical.isPunycode
  };
}
