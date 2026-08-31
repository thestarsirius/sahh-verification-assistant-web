// ============================================================
// functions/api/health.js — فحص سريع للتأكد من أن الـBackend يعمل.
// ============================================================
export async function onRequestGet() {
  return new Response(JSON.stringify({ status: 'ok', mode: 'live', engineId: 'pages-function-v1' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
