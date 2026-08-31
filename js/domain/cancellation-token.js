// ============================================================
// cancellation-token.js
// أداة تعاونية لإلغاء عملية التحليل من أي مرحلة في الـpipeline.
// ============================================================

export class OperationCancelledError extends Error {
  constructor() {
    super('OperationCancelledError: تم إلغاء العملية من قبل المستخدم');
    this.name = 'OperationCancelledError';
  }
}

export class CancellationToken {
  #cancelled = false;
  #listeners = [];
  #whenCancelledPromise = null;

  get isCancelled() {
    return this.#cancelled;
  }

  /** Promise يكتمل بمجرد استدعاء cancel() — يُستخدم للاشتراك الخارجي
   * في حدث الإلغاء (مثل ربط AbortController.abort() به). */
  get whenCancelled() {
    if (!this.#whenCancelledPromise) {
      this.#whenCancelledPromise = new Promise((resolve) => {
        if (this.#cancelled) {
          resolve();
          return;
        }
        this.#listeners.push(resolve);
      });
    }
    return this.#whenCancelledPromise;
  }

  cancel() {
    if (this.#cancelled) return;
    this.#cancelled = true;
    for (const fn of this.#listeners) fn();
    this.#listeners = [];
  }

  throwIfCancelled() {
    if (this.#cancelled) throw new OperationCancelledError();
  }

  /** ينتظر [ms]، لكن يتوقف فوراً إذا أُلغيت العملية أثناء الانتظار. */
  delayOrCancel(ms) {
    this.throwIfCancelled();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.isCancelled ? reject(new OperationCancelledError()) : resolve();
      }, ms);
      const onCancel = () => {
        clearTimeout(timer);
        cleanup();
        reject(new OperationCancelledError());
      };
      const cleanup = () => {
        const i = this.#listeners.indexOf(onCancel);
        if (i >= 0) this.#listeners.splice(i, 1);
      };
      this.#listeners.push(onCancel);
    });
  }
}
