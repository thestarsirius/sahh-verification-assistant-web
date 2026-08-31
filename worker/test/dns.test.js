import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAndValidateHostname } from '../src/dns.js';

const originalFetch = globalThis.fetch;

function mockDohFetch(responder) {
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://cloudflare-dns.com/dns-query')) {
      const params = new URL(String(url)).searchParams;
      return responder(String(url), opts, params.get('type'));
    }
    throw new Error('unexpected fetch to: ' + url);
  };
}

function dohJsonResponse(answers) {
  return new Response(JSON.stringify({ Answer: answers }), { status: 200 });
}

describe('resolveAndValidateHostname', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('literal private IP hostname is blocked WITHOUT any DNS call', async () => {
    let dnsCalled = false;
    globalThis.fetch = async () => {
      dnsCalled = true;
      throw new Error('should not be called');
    };
    const result = await resolveAndValidateHostname('127.0.0.1');
    assert.equal(result.blocked, true);
    assert.equal(dnsCalled, false);
  });

  test('literal localhost hostname is blocked without DNS lookup', async () => {
    const result = await resolveAndValidateHostname('localhost');
    assert.equal(result.blocked, true);
  });

  test('domain resolving to a public IP is NOT blocked', async () => {
    mockDohFetch((url, opts, type) => {
      if (type === 'A') return dohJsonResponse([{ type: 1, data: '93.184.216.34' }]);
      return dohJsonResponse([]);
    });
    const result = await resolveAndValidateHostname('example.com');
    assert.equal(result.blocked, false);
    assert.deepEqual(result.ips, ['93.184.216.34']);
  });

  test('domain resolving to a private IP (DNS rebinding scenario) IS blocked', async () => {
    mockDohFetch((url, opts, type) => {
      if (type === 'A') return dohJsonResponse([{ type: 1, data: '10.0.0.5' }]);
      return dohJsonResponse([]);
    });
    const result = await resolveAndValidateHostname('attacker-controlled-domain.com');
    assert.equal(result.blocked, true);
    assert.deepEqual(result.ips, ['10.0.0.5']);
  });

  test('domain resolving to cloud metadata IP is blocked', async () => {
    mockDohFetch((url, opts, type) => {
      if (type === 'A') return dohJsonResponse([{ type: 1, data: '169.254.169.254' }]);
      return dohJsonResponse([]);
    });
    const result = await resolveAndValidateHostname('metadata-trick.com');
    assert.equal(result.blocked, true);
  });

  test('DNS returning zero records is reported as NO_RECORDS, not silently treated as safe', async () => {
    mockDohFetch(() => dohJsonResponse([]));
    const result = await resolveAndValidateHostname('nonexistent-domain-xyz-123.com');
    assert.equal(result.error, 'NO_RECORDS');
    assert.equal(result.blocked, false); // not "blocked" as SSRF, but also not resolved — caller must treat as inconclusive
    assert.equal(result.ips.length, 0);
  });

  test('DNS query failure (network error) is reported as DNS_FAILURE', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const result = await resolveAndValidateHostname('example.com');
    assert.equal(result.error, 'DNS_FAILURE');
  });

  test('DNS query abort/timeout is reported as TIMEOUT', async () => {
    globalThis.fetch = async (url, opts) => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const result = await resolveAndValidateHostname('example.com');
    assert.equal(result.error, 'TIMEOUT');
  });

  test('mixed A/AAAA records: any single blocked IP blocks the whole result', async () => {
    mockDohFetch((url, opts, type) => {
      if (type === 'A') return dohJsonResponse([{ type: 1, data: '93.184.216.34' }]);
      if (type === 'AAAA') return dohJsonResponse([{ type: 28, data: '::1' }]);
      return dohJsonResponse([]);
    });
    const result = await resolveAndValidateHostname('mixed-records.com');
    assert.equal(result.blocked, true);
  });
});
