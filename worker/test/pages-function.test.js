import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RiskLevel } from '../../js/core/models.js';
import { ErrorCategory } from '../../js/core/analysis-error.js';
import { onRequestPost, onRequestOptions } from '../../functions/api/verify.js';
import { onRequestGet } from '../../functions/api/health.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installMockNetwork(dnsMap) {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      const ip = dnsMap[name];
      if (type === 'A' && ip) return new Response(JSON.stringify({ Answer: [{ type: 1, data: ip }] }), { status: 200 });
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }
    return new Response('ok', { status: 200 });
  };
}

async function callFunction(input) {
  const request = new Request('https://mysite.pages.dev/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const resp = await onRequestPost({ request });
  return { status: resp.status, body: await resp.json() };
}

describe('Cloudflare Pages Function /api/verify (same-origin deployment path)', () => {
  test('trusted domain => success, GREEN — identical behavior to standalone Worker', async () => {
    installMockNetwork({ 'apple.com': '17.253.144.10' });
    const { body } = await callFunction('https://apple.com/sa');
    assert.equal(body.kind, 'success');
    assert.equal(body.result.level, RiskLevel.GREEN);
  });

  test('SSRF target rejected without contacting the target', async () => {
    globalThis.fetch = async () => {
      throw new Error('must not be called');
    };
    const { body } = await callFunction('http://127.0.0.1/admin');
    assert.equal(body.kind, 'failure');
    assert.equal(body.error.category, ErrorCategory.SSRF_REJECTED);
  });

  test('malformed JSON body is handled gracefully', async () => {
    const request = new Request('https://mysite.pages.dev/api/verify', {
      method: 'POST',
      body: '{bad json',
    });
    const resp = await onRequestPost({ request });
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.kind, 'failure');
  });

  test('OPTIONS returns 204', async () => {
    const resp = await onRequestOptions();
    assert.equal(resp.status, 204);
  });
});

describe('Cloudflare Pages Function /api/health', () => {
  test('returns ok status', async () => {
    const resp = await onRequestGet();
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.status, 'ok');
  });
});
