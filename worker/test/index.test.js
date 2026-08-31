import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RiskLevel } from '../../js/core/models.js';
import { ErrorCategory } from '../../js/core/analysis-error.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installMockNetwork({ dnsMap = {}, httpHandlers = {} }) {
  globalThis.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      const ip = dnsMap[name];
      if (type === 'A' && ip) return new Response(JSON.stringify({ Answer: [{ type: 1, data: ip }] }), { status: 200 });
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }
    const handler = httpHandlers[String(url)] || httpHandlers[u.origin + u.pathname];
    if (handler) return handler();
    return new Response('ok', { status: 200 });
  };
}

// نستورد verify() ديناميكيًا بعد تركيب mock الشبكة إن لزم — لكن بما أن
// index.js يستورد fetch عبر global في وقت الاستدعاء (وليس وقت الاستيراد)
// يمكن الاستيراد الثابت هنا بأمان.
const { default: worker } = await import('../src/index.js');

async function callVerify(input) {
  const req = new Request('https://worker.example/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const resp = await worker.fetch(req, {}, {});
  const body = await resp.json();
  return { status: resp.status, body };
}

describe('Worker /api/verify — full pipeline (mocked network)', () => {
  test('trusted domain with clean live signals => success, GREEN', async () => {
    installMockNetwork({ dnsMap: { 'apple.com': '17.253.144.10' } });
    const { status, body } = await callVerify('https://apple.com/sa');
    assert.equal(status, 200);
    assert.equal(body.kind, 'success');
    assert.equal(body.result.level, RiskLevel.GREEN);
  });

  test('SSRF target (raw private IP) => failure, target never contacted', async () => {
    globalThis.fetch = async () => {
      throw new Error('must never call fetch for a blocked target');
    };
    const { body } = await callVerify('http://127.0.0.1/admin');
    assert.equal(body.kind, 'failure');
    assert.equal(body.error.category, ErrorCategory.SSRF_REJECTED);
  });

  test('domain that resolves (DNS rebinding-style) to a private IP => failure, blocked before HTTP fetch', async () => {
    let httpFetchCalled = false;
    installMockNetwork({ dnsMap: { 'sneaky-domain.example': '172.16.0.5' } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (!String(url).includes('cloudflare-dns.com')) httpFetchCalled = true;
      return realFetch(url, opts);
    };
    const { body } = await callVerify('https://sneaky-domain.example/');
    assert.equal(body.kind, 'failure');
    assert.equal(body.error.category, ErrorCategory.SSRF_REJECTED);
    assert.equal(httpFetchCalled, false, 'must not attempt HTTP fetch once DNS shows a private IP');
  });

  test('empty input => failure EMPTY_INPUT', async () => {
    const { body } = await callVerify('');
    assert.equal(body.kind, 'failure');
    assert.equal(body.error.category, ErrorCategory.EMPTY_INPUT);
  });

  test('unsupported scheme => failure UNSUPPORTED_SCHEME', async () => {
    const { body } = await callVerify('javascript:alert(1)');
    assert.equal(body.kind, 'failure');
    assert.equal(body.error.category, ErrorCategory.UNSUPPORTED_SCHEME);
  });

  test('suspicious lookalike domain with clean DNS => success, RED', async () => {
    installMockNetwork({ dnsMap: { 'paypa1-secure-verify.tk': '203.0.113.5' } });
    const { body } = await callVerify('https://paypa1-secure-verify.tk/login');
    assert.equal(body.kind, 'success');
    assert.equal(body.result.level, RiskLevel.RED);
  });

  test('cross-domain redirect on an otherwise-trusted-looking flow downgrades to YELLOW', async () => {
    installMockNetwork({
      dnsMap: { 'shortener.example': '203.0.113.10', 'unrelated-destination.example': '203.0.113.11' },
      httpHandlers: {
        'https://shortener.example/x': () =>
          new Response(null, { status: 302, headers: { Location: 'https://unrelated-destination.example/y' } }),
      },
    });
    const { body } = await callVerify('https://shortener.example/x');
    assert.equal(body.kind, 'success');
    assert.equal(body.result.level, RiskLevel.YELLOW);
    assert.ok(body.result.reasons.some((r) => r.includes('نطاق مختلف')));
  });

  test('DNS failure for target => success is still possible with an inconclusive live signal (fetchError=dns), never fabricated GREEN for untrusted domain', async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.hostname === 'cloudflare-dns.com') throw new Error('doh unreachable');
      throw new Error('should not reach http fetch');
    };
    const { body } = await callVerify('https://random-unknown-domain-42.com/');
    assert.equal(body.kind, 'success'); // still returns a conservative static-based result
    assert.equal(body.result.level, RiskLevel.YELLOW); // never GREEN when we can't verify a non-trusted domain
  });

  test('CORS preflight OPTIONS request is handled', async () => {
    const req = new Request('https://worker.example/api/verify', { method: 'OPTIONS' });
    const resp = await worker.fetch(req, {}, {});
    assert.equal(resp.status, 204);
    assert.ok(resp.headers.get('Access-Control-Allow-Origin'));
  });

  test('unknown route returns 404', async () => {
    const req = new Request('https://worker.example/api/does-not-exist');
    const resp = await worker.fetch(req, {}, {});
    assert.equal(resp.status, 404);
  });

  test('health check endpoint responds', async () => {
    const req = new Request('https://worker.example/api/health');
    const resp = await worker.fetch(req, {}, {});
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.status, 'ok');
  });

  test('malformed JSON body is handled gracefully, not a 500 crash', async () => {
    const req = new Request('https://worker.example/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const resp = await worker.fetch(req, {}, {});
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.kind, 'failure');
  });
});
