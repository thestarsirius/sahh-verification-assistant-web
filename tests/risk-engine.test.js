import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RiskEngine } from '../js/engine/risk-engine.js';
import { RiskLevel } from '../js/core/models.js';

function baseEvidence(overrides = {}) {
  return {
    domain: 'example.com',
    isHttps: true,
    isIpLiteral: false,
    isTrustedDomain: false,
    hasSuspiciousTld: false,
    hyphenCount: 0,
    subdomainDepth: 2,
    hasPhishingKeyword: false,
    looksLikeBrandLookalike: false,
    hasNonAsciiOriginalLabel: false,
    isPunycode: false,
    ...overrides,
  };
}

describe('RiskEngine (deterministic, no randomness)', () => {
  const engine = new RiskEngine();

  test('trusted domain => green', () => {
    const e = baseEvidence({ isTrustedDomain: true, domain: 'apple.com' });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.GREEN);
  });

  test('same evidence produces IDENTICAL result across repeated calls (determinism)', () => {
    const e = baseEvidence({ domain: 'random-shop-42.com', hasSuspiciousTld: false });
    const results = Array.from({ length: 50 }, () => engine.assess(e));
    const first = JSON.stringify(results[0]);
    for (const r of results) {
      assert.equal(JSON.stringify(r), first, 'every call must produce byte-identical output for identical input');
    }
  });

  test('two or more red flags => red', () => {
    const e = baseEvidence({ isHttps: false, hasSuspiciousTld: true, domain: 'login-secure-verify.tk', hyphenCount: 2 });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.RED);
    assert.ok(r.score <= 30);
  });

  test('unknown domain, no strong red flags => yellow (NOT green)', () => {
    const e = baseEvidence({ domain: 'some-unknown-shop.com' });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.YELLOW);
  });

  test('conservative policy: insufficient evidence never produces green', () => {
    const e = baseEvidence({ domain: 'random-new-site.com', isHttps: true });
    const r = engine.assess(e);
    assert.notEqual(r.level, RiskLevel.GREEN);
  });

  test('brand lookalike + suspicious TLD => red', () => {
    const e = baseEvidence({ domain: 'paypal-login.tk', looksLikeBrandLookalike: true, hasSuspiciousTld: true });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.RED);
  });

  test('IP literal alone (1 flag) => yellow, not red', () => {
    const e = baseEvidence({ domain: '93.184.216.34', isIpLiteral: true });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.YELLOW);
  });

  test('IP literal + no HTTPS (2 flags) => red', () => {
    const e = baseEvidence({ domain: '93.184.216.34', isIpLiteral: true, isHttps: false });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.RED);
  });

  test('never uses absolute-certainty language ("100%", "مضمون") in output text', () => {
    const trusted = engine.assess(baseEvidence({ isTrustedDomain: true }));
    const red = engine.assess(baseEvidence({ isHttps: false, hasSuspiciousTld: true, hyphenCount: 3 }));
    const yellow = engine.assess(baseEvidence({}));
    for (const report of [trusted, red, yellow]) {
      const allText = [...report.reasons, ...report.recommendation].join(' ');
      assert.equal(allText.includes('100%'), false);
      assert.equal(allText.includes('مضمون'), false);
      assert.equal(allText.includes('آمن 100'), false);
    }
  });

  test('redirect indicator explicitly states the feature requires a backend (never fabricates a real check)', () => {
    const r = engine.assess(baseEvidence({}));
    const redirectText = r.checks.redirects.map((c) => c.label).join(' ');
    assert.match(redirectText, /Backend|خارجي/);
  });

  test('phishing keyword on a trusted domain is not flagged (avoids false positives on legit paths)', () => {
    const e = baseEvidence({ isTrustedDomain: true, domain: 'stc.com.sa', hasPhishingKeyword: true });
    const r = engine.assess(e);
    assert.equal(r.level, RiskLevel.GREEN);
  });
});
