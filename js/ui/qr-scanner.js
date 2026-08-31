// ============================================================
// qr-scanner.js
// يستخدم getUserMedia + BarcodeDetector (Web API أصلي، بدون أي
// مكتبة أو CDN خارجي). في حال رفض إذن الكاميرا أو عدم دعم المتصفح
// لأي من الاثنين، لا ينهار التطبيق — يُعاد استدعاء onUnavailable
// حتى تعرض الواجهة خيار "إدخال الرابط يدويًا".
//
// ⚠️ لا يُفتح المحتوى المكتشف مباشرة أبداً — يُمرَّر فقط عبر
// onDetected(text) لتحليله أولاً.
// ============================================================
export class QrScanner {
  #video;
  #stream;
  #detector;
  #rafId;
  #stopped = true;

  constructor(videoElement) {
    this.#video = videoElement;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && 'BarcodeDetector' in window;
  }

  /**
   * @param {{onDetected:(text:string)=>void, onUnavailable:(reason:string)=>void}} handlers
   */
  async start({ onDetected, onUnavailable }) {
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnavailable('camera-unsupported');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      onUnavailable('barcode-detector-unsupported');
      return;
    }

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      onUnavailable('permission-denied');
      return;
    }

    this.#video.srcObject = this.#stream;
    await this.#video.play().catch(() => {});
    this.#detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    this.#stopped = false;

    const tick = async () => {
      if (this.#stopped) return;
      try {
        const codes = await this.#detector.detect(this.#video);
        if (codes.length > 0 && codes[0].rawValue) {
          onDetected(codes[0].rawValue);
          return; // نتوقف بعد أول اكتشاف — التوقف الفعلي عبر stop()
        }
      } catch {
        // خطأ عابر في إطار واحد من الفيديو — لا نوقف الجلسة بسببه
      }
      this.#rafId = requestAnimationFrame(tick);
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.#stopped = true;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    if (this.#stream) {
      this.#stream.getTracks().forEach((t) => t.stop());
      this.#stream = null;
    }
    if (this.#video) this.#video.srcObject = null;
  }

  toggleTorch(on) {
    const track = this.#stream?.getVideoTracks?.()[0];
    if (track && 'applyConstraints' in track) {
      track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    }
  }
}
