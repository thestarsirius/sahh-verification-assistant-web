import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TemporaryCache } from '../js/core/cache.js';
import { SecureLogger } from '../js/core/logger.js';
import { StorageService } from '../js/core/storage.js';
import { FeatureGate, PlanTier } from '../js/core/feature-gate.js';
import { RiskLevel, analysisReport, checkItem, historyEntryFromReport } from '../js/core/models.js';

describe('TemporaryCache (in-memory only)', () => {
  test('stores and retrieves a value', () => {
    const cache = new TemporaryCache();
    const report = analysisReport({ level: RiskLevel.GREEN, score: 90, checks: {}, reasons: [], recommendation: [] });
    cache.put('key1', report);
    assert.equal(cache.get('key1'), report);
  });

  test('expires entries after TTL', async () => {
    const cache = new TemporaryCache({ ttlMs: 10 });
    const report = analysisReport({ level: RiskLevel.GREEN, score: 90, checks: {}, reasons: [], recommendation: [] });
    cache.put('key1', report);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cache.get('key1'), null);
  });

  test('evicts oldest entry when maxEntries exceeded', () => {
    const cache = new TemporaryCache({ maxEntries: 2 });
    const r = (s) => analysisReport({ level: RiskLevel.GREEN, score: s, checks: {}, reasons: [], recommendation: [] });
    cache.put('a', r(1));
    cache.put('b', r(2));
    cache.put('c', r(3)); // يطرد 'a'
    assert.equal(cache.get('a'), null);
    assert.notEqual(cache.get('b'), null);
    assert.notEqual(cache.get('c'), null);
    assert.equal(cache.size, 2);
  });

  test('unknown key returns null, not an exception', () => {
    const cache = new TemporaryCache();
    assert.equal(cache.get('does-not-exist'), null);
  });
});

describe('SecureLogger (redaction)', () => {
  test('redacts URLs from arbitrary sanitized text', () => {
    const logger = new SecureLogger(() => {});
    const out = logger.sanitize('visit https://evil.example.com/steal?x=1 now');
    assert.equal(out.includes('evil.example.com'), false);
    assert.match(out, /\[REDACTED\]/);
  });

  test('redacts email-like strings', () => {
    const logger = new SecureLogger(() => {});
    const out = logger.sanitize('contact user@example.com please');
    assert.equal(out.includes('user@example.com'), false);
  });

  test('logOperation never receives or needs a raw URL parameter at all (API-level guarantee)', () => {
    const messages = [];
    const logger = new SecureLogger((m) => messages.push(m));
    logger.logOperation({ operationId: 'op1', operationType: 'url', durationMs: 12, success: true });
    assert.match(messages[0], /op=op1/);
    assert.equal(messages[0].includes('http'), false);
  });

  test('logSecurityEvent sanitizes context values before logging', () => {
    const messages = [];
    const logger = new SecureLogger((m) => messages.push(m));
    logger.logSecurityEvent('ssrf_rejected', { attempted: 'http://127.0.0.1/admin' });
    assert.equal(messages[0].includes('127.0.0.1'), false);
  });
});

describe('StorageService (privacy-first local history)', () => {
  test('addEntry never stores a "url" field, even if accidentally provided', () => {
    const storage = new StorageService();
    const report = analysisReport({
      level: RiskLevel.RED,
      score: 10,
      domain: 'evil.tk',
      checks: { domain: [checkItem(false, 'x')], redirects: [], phishing: [] },
      reasons: ['r'],
      recommendation: ['do not enter data'],
    });
    const entry = historyEntryFromReport({ id: 'e1', type: 'url', report });
    storage.addEntry(entry);
    const stored = storage.getHistory()[0];
    assert.equal('url' in stored, false);
    assert.equal('qrContent' in stored, false);
    assert.equal('domain' in stored, false); // domain متعمداً غير مخزّن في السجل
    assert.equal(JSON.stringify(stored).includes('evil.tk'), false);
  });

  test('deleteEntry removes only the targeted entry', () => {
    const storage = new StorageService();
    const mkReport = () => analysisReport({ level: RiskLevel.YELLOW, score: 50, checks: {}, reasons: [], recommendation: [] });
    storage.addEntry(historyEntryFromReport({ id: 'a', type: 'url', report: mkReport() }));
    storage.addEntry(historyEntryFromReport({ id: 'b', type: 'qr', report: mkReport() }));
    storage.deleteEntry('a');
    const ids = storage.getHistory().map((e) => e.id);
    assert.deepEqual(ids, ['b']);
  });

  test('deleteAllHistory clears everything', () => {
    const storage = new StorageService();
    const mkReport = () => analysisReport({ level: RiskLevel.YELLOW, score: 50, checks: {}, reasons: [], recommendation: [] });
    storage.addEntry(historyEntryFromReport({ id: 'a', type: 'url', report: mkReport() }));
    storage.deleteAllHistory();
    assert.deepEqual(storage.getHistory(), []);
  });

  test('terms acceptance persists independently of history', () => {
    const storage = new StorageService();
    assert.equal(storage.getTermsAccepted(), false);
    storage.setTermsAccepted(true);
    assert.equal(storage.getTermsAccepted(), true);
  });

  test('history caps at 200 entries (resource limit)', () => {
    const storage = new StorageService();
    const mkReport = () => analysisReport({ level: RiskLevel.YELLOW, score: 50, checks: {}, reasons: [], recommendation: [] });
    for (let i = 0; i < 210; i++) {
      storage.addEntry(historyEntryFromReport({ id: `e${i}`, type: 'url', report: mkReport() }));
    }
    assert.equal(storage.getHistory().length, 200);
  });
});

describe('FeatureGate (Free/Premium architecture, no real payment)', () => {
  test('free tier has a finite daily scan limit', () => {
    const gate = new FeatureGate({ tier: PlanTier.FREE });
    assert.ok(Number.isFinite(gate.limits.dailyScanLimit));
  });

  test('premium tier has unlimited scans and advanced features enabled', () => {
    const gate = new FeatureGate({ tier: PlanTier.PREMIUM });
    assert.equal(gate.limits.dailyScanLimit, Infinity);
    assert.equal(gate.limits.advancedAnalysis, true);
  });

  test('recordScan increments today usage and canScanToday reflects the limit', () => {
    const backend = new Map();
    const memBackend = { getItem: (k) => (backend.has(k) ? backend.get(k) : null), setItem: (k, v) => backend.set(k, v) };
    const gate = new FeatureGate({ tier: PlanTier.FREE, backend: memBackend });
    for (let i = 0; i < gate.limits.dailyScanLimit; i++) gate.recordScan();
    assert.equal(gate.canScanToday(), false);
  });
});
