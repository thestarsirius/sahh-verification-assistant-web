// ============================================================
// redirect-fetch.js
// يتتبّع سلسلة تحويلات (Redirects) حقيقية لرابط ما، مع إعادة التحقق
// الكامل (مخطط + DNS + قائمة حظر IP) عند **كل** قفزة، وليس فقط
// الرابط الأصلي — هذا هو ما يمنع تحويل الخدمة إلى SSRF proxy عبر
// رابط أولي بريء يُحوِّل لاحقًا إلى عنوان داخلي.
//
// حدود صارمة مُطبَّقة فعليًا:
//   - أقصى عدد تحويلات (maxRedirects)
//   - مهلة زمنية لكل طلب ولكامل السلسلة (timeoutMs / overallDeadlineMs)
//   - حد أقصى لحجم الاستجابة المقروءة (maxBytes) — نتوقف عن القراءة
//     ونُلغي الطلب فور تجاوزه، دون تحميل الاستجابة كاملة في الذاكرة.
//   - مخططات مسموحة: http/https فقط، حتى ضمن Location الخاص بالتحويل.
// ============================================================
import { UrlValidator, UrlValidationError } from '../../js/url/validator.js';
import { UrlNormalizer } from '../../js/url/normalizer.js';
import { UrlCanonicalizer } from '../../js/url/canonicalizer.js';
import { resolveAndValidateHostname } from './dns.js';

const validator = new UrlValidator();
const normalizer = new UrlNormalizer();
const canonicalizer = new UrlCanonicalizer();

export async function safeFetchWithRedirects(
  startUrl,
  { maxRedirects = 5, timeoutMs = 5000, overallDeadlineMs = 12000, maxBytes = 2_000_000 } = {}
) {
  const deadline = Date.now() + overallDeadlineMs;
  let currentUrl = startUrl;
  let redirectCount = 0;
  const originalDomain = canonicalizer.canonicalize(startUrl, startUrl.href).domain;
  let crossDomainRedirect = false;

  while (true) {
    if (Date.now() > deadline) {
      return { error: 'timeout', redirectCount, crossDomainRedirect, finalStatusCode: null, resolvedIps: [] };
    }

    const dnsResult = await resolveAndValidateHostname(currentUrl.hostname, timeoutMs);
    if (dnsResult.blocked) {
      return { error: 'ssrf_blocked', redirectCount, crossDomainRedirect, finalStatusCode: null, resolvedIps: dnsResult.ips };
    }
    if (dnsResult.error === 'TIMEOUT') {
      return { error: 'timeout', redirectCount, crossDomainRedirect, finalStatusCode: null, resolvedIps: [] };
    }
    if (dnsResult.error === 'DNS_FAILURE' || dnsResult.error === 'NO_RECORDS') {
      return { error: 'dns', redirectCount, crossDomainRedirect, finalStatusCode: null, resolvedIps: [] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'SahhVerificationBot/1.0 (+security-scan)' },
      });
    } catch (e) {
      clearTimeout(timer);
      return {
        error: e.name === 'AbortError' ? 'timeout' : 'network',
        redirectCount,
        crossDomainRedirect,
        finalStatusCode: null,
        resolvedIps: dnsResult.ips,
      };
    }
    clearTimeout(timer);

    const isRedirect = resp.status >= 300 && resp.status < 400 && resp.headers.get('location');
    if (isRedirect) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        return {
          error: null,
          exceededMaxRedirects: true,
          redirectCount,
          crossDomainRedirect,
          finalStatusCode: resp.status,
          resolvedIps: dnsResult.ips,
        };
      }
      let nextUrl;
      try {
        nextUrl = new URL(resp.headers.get('location'), currentUrl);
      } catch {
        return { error: 'network', redirectCount, crossDomainRedirect, finalStatusCode: resp.status, resolvedIps: dnsResult.ips };
      }
      if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
        return { error: 'network', redirectCount, crossDomainRedirect, finalStatusCode: resp.status, resolvedIps: dnsResult.ips };
      }

      try {
        validator.validate(nextUrl.href);
        const normalizedNext = normalizer.normalize(nextUrl.href);
        const canonicalNext = canonicalizer.canonicalize(normalizedNext, nextUrl.href);
        if (canonicalNext.domain !== originalDomain) crossDomainRedirect = true;
        currentUrl = normalizedNext;
        continue;
      } catch (e) {
        if (e instanceof UrlValidationError) {
          return { error: 'network', redirectCount, crossDomainRedirect, finalStatusCode: resp.status, resolvedIps: dnsResult.ips };
        }
        throw e;
      }
    }

    let bytesRead = 0;
    if (resp.body) {
      const reader = resp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytesRead += value.length;
          if (bytesRead > maxBytes) {
            await reader.cancel();
            break;
          }
        }
      } catch {
        // فشل قراءة الجسم لا يُفشل الفحص بالكامل — المهم أننا حصلنا على status
      }
    }

    return {
      error: null,
      exceededMaxRedirects: false,
      redirectCount,
      crossDomainRedirect,
      finalStatusCode: resp.status,
      resolvedIps: dnsResult.ips,
      responseTruncated: bytesRead > maxBytes,
    };
  }
}
