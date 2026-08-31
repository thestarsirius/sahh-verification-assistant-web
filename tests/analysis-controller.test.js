import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisController } from '../js/app/analysis-controller.js';
import { MockAnalysisEngine } from '../js/engine/mock-engine.js';
import { LiveAnalysisEngine } from '../js/engine/live-engine.js';
import { StorageService } from '../js/core/storage.js';
import { TemporaryCache } from '../js/core/cache.js';
import { CancellationToken } from '../js/domain/cancellation-token.js';
import { isEngineSuccess, isEngineFailure } from '../js/domain/i-analysis-engine.js';
import { RiskLevel } from '../js/core/models.js';
import { ErrorCategory } from '../js/core/analysis-error.js';

function makeController({ engine, forceOffline = false } = {}) {
  const storageService = new StorageService();
  const connectivity = { hasConnection: async () => !forceOffline };
  return {
    controller: new AnalysisController({
      engine: engine ?? new MockAnalysisEngine(),
      storageService,
      cache: new TemporaryCache(),
      connectivity,
    }),
    storageService,
  };
}

describe('AnalysisController — integration', () => {
  test('successful analysis is recorded in privacy-safe history', async () => {
    const { controller, storageService } = makeController();
    const outcome = await controller.runAnalysis({
      rawInput: 'https://apple.com',
      sourceType: 'url',
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineSuccess(outcome));
    const history = storageService.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].level, RiskLevel.GREEN);
    assert.equal(history[0].type, 'url');
  });

  test('failed analysis (invalid URL) is NOT recorded in history', async () => {
    const { controller, storageService } = makeController();
    await controller.runAnalysis({ rawInput: '', sourceType: 'url', cancelToken: new CancellationToken() });
    assert.equal(storageService.getHistory().length, 0);
  });

  test('cancelled analysis is NOT recorded in history', async () => {
    const { controller, storageService } = makeController();
    const token = new CancellationToken();
    token.cancel();
    await controller.runAnalysis({ rawInput: 'https://apple.com', sourceType: 'url', cancelToken: token });
    assert.equal(storageService.getHistory().length, 0);
  });

  test('Mock engine runs fully even when connectivity says offline (requiresNetwork=false so offline is irrelevant)', async () => {
    const { controller } = makeController({ forceOffline: true });
    const outcome = await controller.runAnalysis({
      rawInput: 'https://apple.com',
      sourceType: 'url',
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineSuccess(outcome), 'Mock must not be blocked by offline state since it makes no network calls');
    assert.equal(outcome.result.level, RiskLevel.GREEN);
  });

  test('Live engine + offline connectivity => OFFLINE failure, and it is NEVER green', async () => {
    const { controller, storageService } = makeController({ engine: new LiveAnalysisEngine({}), forceOffline: true });
    const outcome = await controller.runAnalysis({
      rawInput: 'https://apple.com',
      sourceType: 'url',
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.OFFLINE);
    assert.equal(storageService.getHistory().length, 0);
  });

  test('Live engine + online connectivity => PROVIDER_UNAVAILABLE, never a fabricated result', async () => {
    const { controller } = makeController({ engine: new LiveAnalysisEngine({}), forceOffline: false });
    const outcome = await controller.runAnalysis({
      rawInput: 'https://apple.com',
      sourceType: 'url',
      cancelToken: new CancellationToken(),
    });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.PROVIDER_UNAVAILABLE);
  });

  test('isSimulatedMode reflects the injected engine truthfully', () => {
    const mock = makeController({ engine: new MockAnalysisEngine() }).controller;
    const live = makeController({ engine: new LiveAnalysisEngine({}) }).controller;
    assert.equal(mock.isSimulatedMode, true);
    assert.equal(live.isSimulatedMode, false);
  });

  test('SSRF-rejected analysis is not recorded in history either', async () => {
    const { controller, storageService } = makeController();
    await controller.runAnalysis({
      rawInput: 'http://127.0.0.1/admin',
      sourceType: 'url',
      cancelToken: new CancellationToken(),
    });
    assert.equal(storageService.getHistory().length, 0);
  });

  test('two independently-constructed controllers do not share state (no hidden global singleton)', async () => {
    const c1 = makeController();
    const c2 = makeController();
    await c1.controller.runAnalysis({ rawInput: 'https://apple.com', sourceType: 'url', cancelToken: new CancellationToken() });
    assert.equal(c1.storageService.getHistory().length, 1);
    assert.equal(c2.storageService.getHistory().length, 0);
  });

  test('daily scan limit reached => DAILY_LIMIT_REACHED failure, not silently allowed', async () => {
    const storageService = new StorageService();
    const memBackend = new Map();
    const gateBackend = { getItem: (k) => (memBackend.has(k) ? memBackend.get(k) : null), setItem: (k, v) => memBackend.set(k, v) };
    const { FeatureGate, PlanTier } = await import('../js/core/feature-gate.js');
    const featureGate = new FeatureGate({ tier: PlanTier.FREE, backend: gateBackend });
    for (let i = 0; i < featureGate.limits.dailyScanLimit; i++) featureGate.recordScan();

    const controller = new AnalysisController({
      engine: new MockAnalysisEngine(),
      storageService,
      cache: new TemporaryCache(),
      connectivity: { hasConnection: async () => true },
      featureGate,
    });
    const outcome = await controller.runAnalysis({ rawInput: 'https://apple.com', sourceType: 'url', cancelToken: new CancellationToken() });
    assert.ok(isEngineFailure(outcome));
    assert.equal(outcome.error.category, ErrorCategory.DAILY_LIMIT_REACHED);
  });
});
