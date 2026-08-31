// ============================================================
// validator.js
// أول مرحلة في الـpipeline — ترفض المدخلات غير الصالحة بوضوح دون
// تعديل الرابط أو تفسير معناه الأمني بعد.
// ============================================================
import { AnalysisErrors } from '../core/analysis-error.js';

export class UrlValidationError extends Error {
  constructor(analysisErrorObj) {
    super(analysisErrorObj.userMessage);
    this.name = 'UrlValidationError';
    this.analysisError = analysisErrorObj;
  }
}

export const MAX_URL_LENGTH = 2048;

export class UrlValidator {
  /** @param {string} raw */
  validate(raw) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new UrlValidationError(AnalysisErrors.emptyInput());
    }
    if (raw.length > MAX_URL_LENGTH) {
      throw new UrlValidationError(AnalysisErrors.urlTooLong());
    }
    if (this.#hasControlCharacters(raw)) {
      throw new UrlValidationError(AnalysisErrors.invalidUrl());
    }
  }

  #hasControlCharacters(raw) {
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if (code === 0x7f) return true;
      if (code < 0x20 && code !== 0x09) return true; // نسمح بالـtab فقط، نرفض باقي أحرف التحكم
    }
    return false;
  }
}
