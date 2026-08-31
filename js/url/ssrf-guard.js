// ============================================================
// ssrf-guard.js
// طبقة دفاع إضافية (Defense-in-Depth) على مستوى الواجهة الأمامية.
//
// ⚠️ حدود موثّقة صراحة (انظر docs/threat-model.md):
//   Client-side validation is defense-in-depth, NOT the final SSRF
//   security boundary. هذا الحارس يفحص فقط العناوين المكتوبة حرفياً
//   (IP literal) أو "localhost". هذه النسخة لا تُجري أي طلب شبكة فعلي
//   من الأساس (Mock بالكامل محلي، Live غير مُفعّل) — لذلك سيناريوهات
//   SSRF الحقيقية (تحويلات إلى عناوين داخلية بعد الاتصال، DNS
//   rebinding بعد resolution) لا يمكن أن تقع فعلياً هنا لعدم وجود
//   اتصال شبكة من الأساس. عند إضافة Backend/Live fetching مستقبلاً:
//   **يجب** فرض حماية SSRF كاملة على مستوى الـBackend نفسه (بعد DNS
//   resolution، وحماية من redirect لعنوان داخلي، وDNS rebinding) —
//   هذا الحارس لا يُعتبر Security Boundary كافياً بمفرده أبداً.
// ============================================================
export class SsrfGuard {
  /** @param {string} host */
  isBlockedHost(host) {
    const h = (host || '').toLowerCase();

    if (h === 'localhost' || h.endsWith('.localhost')) return true;

    const ipv4 = this.#tryParseIpv4(h);
    if (ipv4) return this.#isBlockedIpv4(ipv4);

    if (h.includes(':')) return this.#isBlockedIpv6Literal(h);

    return false;
  }

  #tryParseIpv4(host) {
    const parts = host.split('.');
    if (parts.length !== 4) return null;
    const octets = [];
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const n = Number(p);
      if (n < 0 || n > 255) return null;
      octets.push(n);
    }
    return octets;
  }

  #isBlockedIpv4(o) {
    if (o[0] === 127) return true; // loopback 127.0.0.0/8
    if (o[0] === 10) return true; // private 10.0.0.0/8
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // private 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true; // private 192.168.0.0/16
    if (o[0] === 169 && o[1] === 254) return true; // link-local (incl. 169.254.169.254 metadata)
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  #isBlockedIpv6Literal(host) {
    const h = host.replace(/[[\]]/g, '').toLowerCase();
    if (h === '::1') return true; // loopback
    if (h.startsWith('fe80:')) return true; // link-local
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local fc00::/7
    if (h.startsWith('::ffff:')) {
      const mapped = h.substring('::ffff:'.length);
      const ipv4 = this.#tryParseIpv4(mapped);
      if (ipv4) return this.#isBlockedIpv4(ipv4);
    }
    return false;
  }
}
