import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { UrlValidator, UrlValidationError } from '../js/url/validator.js';
import { UrlNormalizer } from '../js/url/normalizer.js';
import { UrlCanonicalizer } from '../js/url/canonicalizer.js';
import { SsrfGuard } from '../js/url/ssrf-guard.js';
import { ErrorCategory } from '../js/core/analysis-error.js';

describe('UrlValidator', () => {
  const validator = new UrlValidator();

  test('rejects empty input', () => {
    assert.throws(() => validator.validate(''), UrlValidationError);
    try {
      validator.validate('');
    } catch (e) {
      assert.equal(e.analysisError.category, ErrorCategory.EMPTY_INPUT);
    }
  });

  test('rejects whitespace-only input', () => {
    assert.throws(() => validator.validate('   '), UrlValidationError);
  });

  test('rejects extremely long input (> 2048 chars)', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    try {
      validator.validate(longUrl);
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.analysisError.category, ErrorCategory.URL_TOO_LONG);
    }
  });

  test('rejects control characters', () => {
    assert.throws(() => validator.validate('https://example.com/\x07'), UrlValidationError);
  });

  test('accepts a normal https URL', () => {
    assert.doesNotThrow(() => validator.validate('https://example.com/path'));
  });
});

describe('UrlNormalizer', () => {
  const normalizer = new UrlNormalizer();

  test('adds https scheme when missing', () => {
    const u = normalizer.normalize('example.com/path');
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'example.com');
  });

  test('lower-cases host but preserves path/query exactly (no reordering, no dropping)', () => {
    const u = normalizer.normalize('HTTPS://Example.COM/Path?Token=ABC123&x=1&x=2');
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'example.com');
    assert.equal(u.pathname, '/Path');
    assert.equal(u.search, '?Token=ABC123&x=1&x=2');
  });

  test('rejects unsupported schemes explicitly (javascript:)', () => {
    try {
      normalizer.normalize('javascript:alert(1)');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.analysisError.category, ErrorCategory.UNSUPPORTED_SCHEME);
    }
  });

  test('rejects unsupported schemes explicitly (data:)', () => {
    try {
      normalizer.normalize('data:text/html,<script>alert(1)</script>');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.analysisError.category, ErrorCategory.UNSUPPORTED_SCHEME);
    }
  });

  test('rejects unsupported schemes explicitly (file:)', () => {
    try {
      normalizer.normalize('file:///etc/passwd');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.analysisError.category, ErrorCategory.UNSUPPORTED_SCHEME);
    }
  });

  test('rejects malformed URL', () => {
    assert.throws(() => normalizer.normalize('https://'), UrlValidationError);
  });

  test('handles unusual ports without altering meaning', () => {
    const u = normalizer.normalize('https://example.com:8443/path');
    assert.equal(u.port, '8443');
    assert.equal(u.hostname, 'example.com');
  });

  test('handles IDN/unicode domains via native punycode conversion', () => {
    const u = normalizer.normalize('https://xn--pple-43d.com'); // already-punycode form is stable
    assert.ok(u.hostname.startsWith('xn--'));
  });
});

describe('UrlCanonicalizer', () => {
  const normalizer = new UrlNormalizer();
  const canon = new UrlCanonicalizer();

  test('strips leading www. from domain', () => {
    const u = normalizer.normalize('https://www.example.com/x');
    const c = canon.canonicalize(u, 'https://www.example.com/x');
    assert.equal(c.domain, 'example.com');
  });

  test('flags punycode-converted unicode domains', () => {
    const raw = 'https://аpple.com'; // Cyrillic "а" homograph
    const u = normalizer.normalize(raw);
    const c = canon.canonicalize(u, raw);
    assert.equal(c.hasNonAsciiOriginalLabel, true);
    assert.equal(c.isPunycode, true); // WHATWG URL auto-converts to xn--
  });
});

describe('SsrfGuard', () => {
  const guard = new SsrfGuard();

  test('blocks localhost', () => assert.equal(guard.isBlockedHost('localhost'), true));
  test('blocks 127.0.0.1 loopback', () => assert.equal(guard.isBlockedHost('127.0.0.1'), true));
  test('blocks 10.x private range', () => assert.equal(guard.isBlockedHost('10.1.2.3'), true));
  test('blocks 172.16-31.x private range', () => assert.equal(guard.isBlockedHost('172.20.0.5'), true));
  test('does not block 172.15.x (outside private range)', () => assert.equal(guard.isBlockedHost('172.15.0.5'), false));
  test('does not block 172.32.x (outside private range)', () => assert.equal(guard.isBlockedHost('172.32.0.5'), false));
  test('blocks 192.168.x private range', () => assert.equal(guard.isBlockedHost('192.168.1.1'), true));
  test('blocks 169.254.169.254 metadata endpoint', () => assert.equal(guard.isBlockedHost('169.254.169.254'), true));
  test('blocks 0.0.0.0', () => assert.equal(guard.isBlockedHost('0.0.0.0'), true));
  test('blocks CGNAT 100.64.0.0/10', () => assert.equal(guard.isBlockedHost('100.64.1.1'), true));
  test('does not block 100.63.x (outside CGNAT range)', () => assert.equal(guard.isBlockedHost('100.63.1.1'), false));
  test('blocks IPv6 loopback ::1', () => assert.equal(guard.isBlockedHost('::1'), true));
  test('blocks IPv6 link-local fe80::', () => assert.equal(guard.isBlockedHost('fe80::1'), true));
  test('blocks IPv6 unique-local fd00::/8', () => assert.equal(guard.isBlockedHost('fd12:3456::1'), true));
  test('blocks IPv4-mapped IPv6 pointing to private range', () =>
    assert.equal(guard.isBlockedHost('::ffff:127.0.0.1'), true));
  test('does not block a normal public domain', () => assert.equal(guard.isBlockedHost('example.com'), false));
  test('does not block a normal public IP', () => assert.equal(guard.isBlockedHost('93.184.216.34'), false));
});
