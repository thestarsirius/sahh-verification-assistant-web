// ============================================================
// i-analysis-engine.js
// العقد الأساسي لأي محرك تحليل (Mock أو Live). في JavaScript لا
// توجد interfaces صارمة، لذلك نوثّق العقد عبر JSDoc + دالة تحقق
// اختيارية assertIsAnalysisEngine تُستخدم في الاختبارات فقط للتأكد
// أن أي تطبيق (Mock/Live) يلتزم بالشكل المطلوب.
//
// العقد المطلوب من أي كائن محرك:
//   - engineId: string
//   - requiresNetwork: boolean
//   - isSimulated: boolean
//   - async analyze(rawInput, { cancelToken }): Promise<EngineOutcome>
// ============================================================

/** @param {*} value */
export function engineSuccess(result) {
  return Object.freeze({ kind: 'success', result });
}

/** @param {*} error */
export function engineFailure(error) {
  return Object.freeze({ kind: 'failure', error });
}

export function isEngineSuccess(outcome) {
  return outcome && outcome.kind === 'success';
}
export function isEngineFailure(outcome) {
  return outcome && outcome.kind === 'failure';
}

export function assertIsAnalysisEngine(engine) {
  const required = ['engineId', 'requiresNetwork', 'isSimulated', 'analyze'];
  for (const key of required) {
    if (!(key in engine)) {
      throw new Error(`Engine object is missing required member: ${key}`);
    }
  }
  if (typeof engine.analyze !== 'function') {
    throw new Error('Engine.analyze must be a function');
  }
  return true;
}
