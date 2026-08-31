import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetchWithRedirects } from '../src/redirect-fetch.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function dohResponder(ipByHost) {
  return async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      const ip = ipByHost[name];
      if (type === 'A' && ip) return new Response(JSON.stringify({ Answer: [{ type: 1, data: ip }] }), { status: 200 });
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }
    return null; // caller decides what to do for non-DNS URLs
  };
}

describe('safeFetchWithRedirects', () => {
  test('simple 200 response, no redirects', async () => {
    const doh = dohResponder({ 'example.com': '93.184.216.34' });
    globalThis.fetch = async (url, opts) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      return new Response('ok', { status: 200 });
    };
    const result = await safeFetchWithRedirects(new URL('https://example.com/'));
    assert.equal(result.error, null);
    assert.equal(result.redirectCount, 0);
    assert.equal(result.finalStatusCode, 200);
    assert.equal(result.crossDomainRedirect, false);
  });

  test('same-domain redirect (path change) does not flag crossDomainRedirect', async () => {
    const doh = dohResponder({ 'example.com': '93.184.216.34' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      if (String(url) === 'https://example.com/old') {
        return new Response(null, { status: 302, headers: { Location: '/new' } });
      }
      return new Response('ok', { status: 200 });
    };
    const result = await safeFetchWithRedirects(new URL('https://example.com/old'));
    assert.equal(result.error, null);
    assert.equal(result.redirectCount, 1);
    assert.equal(result.crossDomainRedirect, false);
    assert.equal(result.finalStatusCode, 200);
  });

  test('cross-domain redirect is detected and flagged', async () => {
    const doh = dohResponder({ 'shortlink.example': '93.184.216.34', 'destination.example': '93.184.216.35' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      if (String(url) === 'https://shortlink.example/x') {
        return new Response(null, { status: 301, headers: { Location: 'https://destination.example/y' } });
      }
      return new Response('ok', { status: 200 });
    };
    const result = await safeFetchWithRedirects(new URL('https://shortlink.example/x'));
    assert.equal(result.crossDomainRedirect, true);
    assert.equal(result.redirectCount, 1);
  });

  test('redirect chain to a private IP domain is blocked mid-chain (prevents SSRF via redirect)', async () => {
    const doh = dohResponder({ 'innocent-looking.example': '93.184.216.34', 'internal.example': '10.0.0.9' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      if (String(url) === 'https://innocent-looking.example/') {
        return new Response(null, { status: 302, headers: { Location: 'https://internal.example/admin' } });
      }
      throw new Error('should never fetch the internal target directly');
    };
    const result = await safeFetchWithRedirects(new URL('https://innocent-looking.example/'));
    assert.equal(result.error, 'ssrf_blocked');
  });

  test('redirect directly to a raw private IP is blocked', async () => {
    globalThis.fetch = async (url) => {
      throw new Error('should never be called - blocked before fetch: ' + url);
    };
    const result = await safeFetchWithRedirects(new URL('http://192.168.1.1/'));
    assert.equal(result.error, 'ssrf_blocked');
  });

  test('exceeding max redirects stops the chain and reports exceededMaxRedirects', async () => {
    const doh = dohResponder({ 'loop.example': '93.184.216.34' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      const u = String(url);
      const n = Number(u.split('/hop').pop() || 0);
      return new Response(null, { status: 302, headers: { Location: `https://loop.example/hop${n + 1}` } });
    };
    const result = await safeFetchWithRedirects(new URL('https://loop.example/hop0'), { maxRedirects: 3 });
    assert.equal(result.exceededMaxRedirects, true);
    assert.ok(result.redirectCount > 3);
  });

  test('network error during fetch is reported as "network", not silently treated as safe', async () => {
    const doh = dohResponder({ 'unreachable.example': '93.184.216.34' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      throw new TypeError('fetch failed');
    };
    const result = await safeFetchWithRedirects(new URL('https://unreachable.example/'));
    assert.equal(result.error, 'network');
  });

  test('DNS failure for the target domain is reported as "dns"', async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.hostname === 'cloudflare-dns.com') throw new Error('doh down');
      throw new Error('should not reach here');
    };
    const result = await safeFetchWithRedirects(new URL('https://broken-dns.example/'));
    assert.equal(result.error, 'dns');
  });

  test('response body larger than maxBytes is truncated, not fully buffered', async () => {
    const doh = dohResponder({ 'big.example': '93.184.216.34' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      const bigChunk = new Uint8Array(1000).fill(65);
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < 50; i++) controller.enqueue(bigChunk); // 50,000 bytes total
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };
    const result = await safeFetchWithRedirects(new URL('https://big.example/'), { maxBytes: 5000 });
    assert.equal(result.error, null);
    assert.equal(result.responseTruncated, true);
  });

  test('redirect Location with a disallowed scheme (javascript:) is rejected, not followed', async () => {
    const doh = dohResponder({ 'evil-redirect.example': '93.184.216.34' });
    globalThis.fetch = async (url) => {
      const dohResp = await doh(url);
      if (dohResp) return dohResp;
      return new Response(null, { status: 302, headers: { Location: 'javascript:alert(1)' } });
    };
    const result = await safeFetchWithRedirects(new URL('https://evil-redirect.example/'));
    assert.equal(result.error, 'network');
  });
});
