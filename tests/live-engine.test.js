import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveAnalysisEngine } from '../js/engine/live-engine.js';
import { CancellationToken } from '../js/domain/cancellation-token.js';
import { isEngineFailure, isEngineSuccess } from '../js/domain/i-analysis-engine.js';
import { ErrorCategory } from '../js/core/analysis-error.js';

describe('LiveAnalysisEngine (no provider configured)', () => {
  test('engine identifies itself correctly (isSimulated=false, requiresNetwork=true)', () => {
    const engine = new LiveAnalysisEngine({});
    assert.equal(engine.isSimulated, false);
    assert.equal(engine.requiresNetwork, true);
  });

  test('analyze() without a provider ALWAYS fails with PROVIDER_UNAVAILABLE — never succeeds', async () => {
    const engine = new LiveAnalysisEngine({});
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.PROVIDER_UNAVAILABLE);
  });

  test('failure is never retryable into a silent Mock fallback (retryable=false)', async () => {
    const engine = new LiveAnalysisEngine({});
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.equal(outcome.error.retryable, false);
  });

  test('does NOT produce a GREEN/success result under any input, even a trusted-looking domain', async () => {
    const engine = new LiveAnalysisEngine({});
    for (const url of ['https://apple.com', 'https://google.com', 'not-a-url', '']) {
      const outcome = await engine.analyze(url, { cancelToken: new CancellationToken() });
      assert.ok(isEngineFailure(outcome), `expected failure for input: ${url}`);
    }
  });

  test('even with a (fake) provider object passed, current implementation still does not fabricate a real check', async () => {
    const fakeProvider = { providerId: 'fake', check: async () => ({ status: 'clean' }) };
    const engine = new LiveAnalysisEngine({ provider: fakeProvider });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    // التنفيذ الحالي متعمّد: حتى لو مُرِّر provider، لا يوجد استدعاء
    // فعلي مُفعّل بعد — هذا موثّق كحد معروف (Requires Backend/API).
    assert.ok(isEngineFailure(outcome));
  });
});

describe('LiveAnalysisEngine (real HTTP calling behavior, apiBaseUrl configured, mocked fetch)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('successful worker response => EngineSuccess with the exact result payload', async () => {
    const fakeResult = { level: 'green', score: 95, checks: {}, reasons: [], recommendation: [] };
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, 'https://worker.example/api/verify');
      assert.equal(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.equal(body.input, 'https://apple.com');
      return new Response(JSON.stringify({ kind: 'success', result: fakeResult }), { status: 200 });
    };
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('https://apple.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineSuccess(outcome));
    assert.deepEqual(outcome.result, fakeResult);
  });

  test('worker failure response is passed through as EngineFailure with the same error shape', async () => {
    const fakeError = { category: 'SSRF_REJECTED', userMessage: 'x', retryable: false, technicalCode: 'SSRF_REJECTED' };
    globalThis.fetch = async () => new Response(JSON.stringify({ kind: 'failure', error: fakeError }), { status: 200 });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('http://127.0.0.1/', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, 'SSRF_REJECTED');
  });

  test('network failure (fetch throws) => NETWORK_FAILURE, not a crash', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.technicalCode, 'NETWORK_FAILURE');
  });

  test('malformed (non-JSON) response => malformed-response failure, not a crash', async () => {
    globalThis.fetch = async () => new Response('not json at all', { status: 200 });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
  });

  test('cancellation aborts the in-flight fetch and returns CANCELLED', async () => {
    const token = new CancellationToken();
    globalThis.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const promise = engine.analyze('https://example.com', { cancelToken: token });
    setTimeout(() => token.cancel(), 10);
    const outcome = await promise;
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.technicalCode, 'CANCELLED');
  });

  test('timeout (no cancellation, request just takes too long) => TIMEOUT', async () => {
    globalThis.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api', timeoutMs: 30 });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.technicalCode, 'TIMEOUT');
  });

  test('REPRODUCES THE EXACT PRODUCTION SYMPTOM: Cloudflare returns its default HTML 404 page (Functions not deployed) => BACKEND_MISCONFIGURED, not a generic "malformed response"', async () => {
    globalThis.fetch = async () =>
      new Response('<!DOCTYPE html><html><body>404 Not Found</body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://sahh2030.pages.dev/api' });
    const outcome = await engine.analyze('https://apple.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, 'BACKEND_MISCONFIGURED');
    assert.match(outcome.error.technicalCode, /BACKEND_MISCONFIGURED_404/);
  });

  test('valid JSON response WITHOUT a perfectly-set Content-Type header still parses correctly (no false positive)', async () => {
    const fakeResult = { level: 'yellow', score: 50, checks: {}, reasons: [], recommendation: [] };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ kind: 'success', result: fakeResult })); // no explicit Content-Type set
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineSuccess(outcome), 'must not falsely flag a valid JSON body as backend-misconfigured');
  });

  test('a genuinely non-JSON, non-HTML error body (e.g. plain text 500) is reported as generic malformed response, not backend-misconfigured', async () => {
    globalThis.fetch = async () =>
      new Response('internal error, not json', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    const engine = new LiveAnalysisEngine({ apiBaseUrl: 'https://worker.example/api' });
    const outcome = await engine.analyze('https://example.com', { cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, 'UNKNOWN');
    assert.equal(outcome.error.technicalCode, 'MALFORMED_RESPONSE');
  });
});
