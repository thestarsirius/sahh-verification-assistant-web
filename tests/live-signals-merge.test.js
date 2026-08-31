import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RiskEngine, mergeLiveSignalsIntoReport } from '../js/engine/risk-engine.js';
import { RiskLevel } from '../js/core/models.js';

function trustedGreenReport() {
  const engine = new RiskEngine();
  return engine.assess({
    domain: 'apple.com',
    isHttps: true,
    isIpLiteral: false,
    isTrustedDomain: true,
    hasSuspiciousTld: false,
    hyphenCount: 0,
    subdomainDepth: 2,
    hasPhishingKeyword: false,
    looksLikeBrandLookalike: false,
    hasNonAsciiOriginalLabel: false,
    isPunycode: false,
  });
}

describe('mergeLiveSignalsIntoReport (deterministic, additive)', () => {
  test('no liveSignals => report returned unchanged', () => {
    const base = trustedGreenReport();
    const merged = mergeLiveSignalsIntoReport(base, null);
    assert.equal(merged, base);
  });

  test('successful reachability with no redirects keeps GREEN, adds a positive redirect check', () => {
    const base = trustedGreenReport();
    const merged = mergeLiveSignalsIntoReport(base, { resolvedIps: ['93.184.216.34'], redirectCount: 0 });
    assert.equal(merged.level, RiskLevel.GREEN);
    const redirectText = merged.checks.redirects.map((c) => c.label).join(' ');
    assert.match(redirectText, /لا توجد تحويلات/);
  });

  test('cross-domain redirect downgrades GREEN to YELLOW, never stays falsely GREEN', () => {
    const base = trustedGreenReport();
    const merged = mergeLiveSignalsIntoReport(base, { redirectCount: 1, crossDomainRedirect: true });
    assert.equal(merged.level, RiskLevel.YELLOW);
    assert.ok(merged.reasons.some((r) => r.includes('نطاق مختلف')));
  });

  test('exceeding max redirects downgrades GREEN to YELLOW', () => {
    const base = trustedGreenReport();
    const merged = mergeLiveSignalsIntoReport(base, { redirectCount: 12, exceededMaxRedirects: true });
    assert.equal(merged.level, RiskLevel.YELLOW);
  });

  test('a fetch timeout does NOT upgrade or downgrade level on its own (no false confidence either way)', () => {
    const base = trustedGreenReport();
    const merged = mergeLiveSignalsIntoReport(base, { fetchError: 'timeout' });
    assert.equal(merged.level, RiskLevel.GREEN); // trust is identity-based, not reachability-based
    const redirectText = merged.checks.redirects.map((c) => c.label).join(' ');
    assert.match(redirectText, /لم تُستخدم هذه الحالة لرفع مستوى الثقة/);
  });

  test('never mutates the original base report object (immutability)', () => {
    const base = trustedGreenReport();
    const beforeJson = JSON.stringify(base);
    mergeLiveSignalsIntoReport(base, { redirectCount: 3, crossDomainRedirect: true, exceededMaxRedirects: true });
    assert.equal(JSON.stringify(base), beforeJson);
  });

  test('RED base level is never "improved" back to GREEN/YELLOW by live signals', () => {
    const engine = new RiskEngine();
    const redBase = engine.assess({
      domain: 'paypa1-login.tk',
      isHttps: false,
      isIpLiteral: false,
      isTrustedDomain: false,
      hasSuspiciousTld: true,
      hyphenCount: 2,
      subdomainDepth: 2,
      hasPhishingKeyword: true,
      looksLikeBrandLookalike: true,
      hasNonAsciiOriginalLabel: false,
      isPunycode: false,
    });
    const merged = mergeLiveSignalsIntoReport(redBase, { resolvedIps: ['1.2.3.4'], redirectCount: 0 });
    assert.equal(merged.level, RiskLevel.RED);
  });
});
