// ============================================================
// dns.js
// حل اسم النطاق فعليًا عبر DNS-over-HTTPS الخاص بـ Cloudflare
// (cloudflare-dns.com) — لا يتطلب أي مفتاح API. تُستخدم النتيجة
// للتحقق من أن عناوين IP الفعلية للنطاق ليست عناوين شبكة داخلية
// قبل السماح بأي طلب HTTP فعلي نحوها.
//
// ⚠️ هذا تخفيف حقيقي وليس شكليًا: نحل DNS بأنفسنا هنا ونتحقق من
// النتيجة *قبل* استدعاء fetch()، بدلاً من الاعتماد فقط على كون
// الرابط "https://" ويبدو نطاقًا عاديًا. راجع docs/threat-model.md
// (النسخة المُحدَّثة) لتوثيق الفجوة المتبقية بين هذا الفحص واتصال
// fetch() الفعلي (احتمال ضئيل لتغيّر DNS بين الفحص والاتصال — TOCTOU)
// والتي تتطلب حلاً كاملاً على مستوى Socket خام (cloudflare:sockets)
// غير مُنفَّذ في هذه النسخة لعدم القدرة على اختباره فعليًا في بيئة
// التطوير الحالية (لا يوجد وصول لبيئة تشغيل Cloudflare Workers هنا).
// ============================================================
import { SsrfGuard } from '../../js/url/ssrf-guard.js';

const ssrfGuard = new SsrfGuard();
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/**
 * @param {string} hostname
 * @param {number} timeoutMs
 * @returns {Promise<{ips: string[], blocked: boolean, error: string|null}>}
 */
export async function resolveAndValidateHostname(hostname, timeoutMs = 4000) {
  // إذا كان hostname نفسه IP literal، لا حاجة لحل DNS — يُفحص مباشرة.
  if (ssrfGuard.isBlockedHost(hostname)) {
    return { ips: [hostname], blocked: true, error: null };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return { ips: [hostname], blocked: false, error: null };
  }

  try {
    const [aRecords, aaaaRecords] = await Promise.all([
      queryDoh(hostname, 'A', timeoutMs),
      queryDoh(hostname, 'AAAA', timeoutMs),
    ]);
    const ips = [...aRecords, ...aaaaRecords];

    if (ips.length === 0) {
      return { ips: [], blocked: false, error: 'NO_RECORDS' };
    }

    const blocked = ips.some((ip) => ssrfGuard.isBlockedHost(ip));
    return { ips, blocked, error: null };
  } catch (e) {
    return { ips: [], blocked: false, error: e.name === 'AbortError' ? 'TIMEOUT' : 'DNS_FAILURE' };
  }
}

async function queryDoh(hostname, type, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const recordType = type === 'A' ? 1 : 28;
    return (data.Answer || []).filter((r) => r.type === recordType).map((r) => r.data);
  } finally {
    clearTimeout(timer);
  }
}
