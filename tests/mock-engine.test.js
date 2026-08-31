import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockAnalysisEngine } from '../js/engine/mock-engine.js';
import { CancellationToken } from '../js/domain/cancellation-token.js';
import { isEngineSuccess, isEngineFailure } from '../js/domain/i-analysis-engine.js';
import { RiskLevel } from '../js/core/models.js';
import { ErrorCategory } from '../js/core/analysis-error.js';

describe('MockAnalysisEngine', () => {
  test('engine identifies itself correctly (isSimulated=true, requiresNetwork=false)', () => {
    const engine = new MockAnalysisEngine();
    assert.equal(engine.isSimulated, true);
    assert.equal(engine.requiresNetwork, false);
    assert.equal(engine.engineId, 'mock-v1');
  });

  test('valid trusted URL => success with GREEN', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('https://www.apple.com/sa', { cancelToken: new CancellationToken() });
    assert.ok(isEngineSuccess(outcome));
    assert.equal(outcome.result.level, RiskLevel.GREEN);
  });

  test('valid unknown URL => success with YELLOW (needs verification)', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('https://some-random-shop-xyz123.com', {
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineSuccess(outcome));
    assert.equal(outcome.result.level, RiskLevel.YELLOW);
  });

  test('suspicious lookalike URL => success with RED', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('https://paypa1-secure-verify.tk/login', {
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineSuccess(outcome));
    assert.equal(outcome.result.level, RiskLevel.RED);
  });

  test('empty input => failure EMPTY_INPUT', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.EMPTY_INPUT);
  });

  test('malformed input => failure INVALID_URL', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('https://', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.INVALID_URL);
  });

  test('unsupported scheme (javascript:) => failure UNSUPPORTED_SCHEME, never analyzed as a normal domain', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('javascript:alert(1)', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.UNSUPPORTED_SCHEME);
  });

  test('SSRF target (localhost) => failure SSRF_REJECTED, not analyzed as a risk score', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('http://localhost:8080/admin', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.SSRF_REJECTED);
  });

  test('SSRF target (private IP 192.168.x.x) => failure SSRF_REJECTED', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('http://192.168.1.1/', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.SSRF_REJECTED);
  });

  test('SSRF target (cloud metadata endpoint) => failure SSRF_REJECTED', async () => {
    const engine = new MockAnalysisEngine();
    const outcome = await engine.analyze('http://169.254.169.254/latest/meta-data/', {
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.SSRF_REJECTED);
  });

  test('cancellation before start => failure CANCELLED, no result produced', async () => {
    const engine = new MockAnalysisEngine();
    const token = new CancellationToken();
    token.cancel();
    const outcome = await engine.analyze('https://example.com', { cancelToken: token });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.CANCELLED);
  });

  test('cancellation mid-flight (during simulated delay) => failure CANCELLED', async () => {
    const engine = new MockAnalysisEngine();
    const token = new CancellationToken();
    const analyzePromise = engine.analyze('https://example.com', { cancelToken: token });
    setTimeout(() => token.cancel(), 20); // يلغي أثناء أول تأخير محاكى (350ms)
    const outcome = await analyzePromise;
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.CANCELLED);
  });

  test('deterministic: same URL analyzed twice produces identical level and score', async () => {
    const engine = new MockAnalysisEngine();
    const o1 = await engine.analyze('https://some-shop-example.com/page', { cancelToken: new CancellationToken() });
    const o2 = await engine.analyze('https://some-shop-example.com/page', { cancelToken: new CancellationToken() });
    assert.ok(isEngineSuccess(o1) && isEngineSuccess(o2));
    assert.equal(o1.result.level, o2.result.level);
    assert.equal(o1.result.score, o2.result.score);
  });

  test('extremely long URL => failure URL_TOO_LONG, never silently truncated and analyzed', async () => {
    const engine = new MockAnalysisEngine();
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    const outcome = await engine.analyze(longUrl, { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.URL_TOO_LONG);
  });

  test('result never contains the raw input string anywhere in its serialized form', async () => {
    const engine = new MockAnalysisEngine();
    const raw = 'https://very-specific-marker-abc123.tk/secret-path?token=xyz';
    const outcome = await engine.analyze(raw, { cancelToken: new CancellationToken() });
    assert.ok(isEngineSuccess(outcome));
    const serialized = JSON.stringify(outcome.result);
    assert.equal(serialized.includes('secret-path'), false);
    assert.equal(serialized.includes('token=xyz'), false);
  });
});
