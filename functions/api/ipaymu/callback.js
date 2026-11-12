// Callback iPaymu -> menandai pesanan PAID hanya jika signature valid DAN nominal cocok.
// Signature: HMAC-SHA256(JSON key terurut A-Z, kunci = VA merchant) vs header X-Signature.
// Urutan key & escape "/" dicoba beberapa variasi karena contoh resmi iPaymu berbeda-beda
// (PHP ksort = urut byte, JS contoh = localeCompare). Salah satu variasi yang cocok sudah cukup.

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byLocale = (a, b) => a.localeCompare(b);

function sortObject(value, cmp) {
  if (Array.isArray(value)) return value.map(v => sortObject(v, cmp));
  if (value && typeof value === 'object') {
    return Object.keys(value).sort(cmp).reduce((out, k) => { out[k] = sortObject(value[k], cmp); return out; }, {});
  }
  return value;
}
function normalizePayload(payload) {
  const n = { ...payload };
  for (const key of ['trx_id', 'status_code', 'transaction_status_code', 'paid_off']) {
    if (n[key] !== undefined && n[key] !== null && /^-?\d+$/.test(String(n[key]))) n[key] = Number.parseInt(n[key], 10);
  }
  if (n.is_escrow !== undefined) n.is_escrow = n.is_escrow === true || n.is_escrow === 'true' || n.is_escrow === '1' || n.is_escrow === 1;
  if (n.additional_info === undefined || n.additional_info === '[]') n.additional_info = [];
  return n;
}
function parseForm(raw) {
  const payload = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) payload[k] = v;
  return normalizePayload(payload);
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signatureMatches(data, received, secret) {
  for (const cmp of [byCodeUnit, byLocale]) {
    const plain = JSON.stringify(sortObject(data, cmp));
    for (const body of [plain.replace(/\//g, '\\/'), plain]) {
      const expected = await hmacHex(secret, body);
      if (safeEqualHex(received.toLowerCase(), expected)) return true;
    }
  }
  return false;
}
const text = (message, status) => new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const TTL = 60 * 60 * 24 * 30;

export async function onRequestGet() { return text('iPaymu callback endpoint aktif (gunakan POST).', 200); }

export async function onRequestPost({ request, env }) {
  if (!env.IPAYMU_VA || !env.ORDERS) return text('Not configured', 503);
  try {
    const raw = await request.text();
    const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
    let payload;
    if (contentType.includes('application/json')) payload = normalizePayload(JSON.parse(raw));
    else if (contentType.includes('application/x-www-form-urlencoded')) payload = parseForm(raw);
    else return text('Unsupported content type', 415);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return text('Invalid payload', 400);

    const received = request.headers.get('X-Signature') || payload.signature;
    if (typeof received !== 'string' || !/^[a-f0-9]{64}$/i.test(received)) return text('Missing or invalid signature', 401);
    const data = { ...payload };
    delete data.signature;
    if (!(await signatureMatches(data, received, String(env.IPAYMU_VA).trim()))) {
      console.error('iPaymu callback: invalid signature');
      return text('Invalid signature', 401);
    }

    const ref = String(payload.reference_id || payload.referenceId || '');
    if (!/^WZ[A-Z0-9]+$/.test(ref)) return text('Invalid reference', 400);
    const stored = await env.ORDERS.get(ref);
    if (!stored) return text('Order not found', 404);
    const order = JSON.parse(stored);
    if (order.status === 'PAID') return text('OK', 200); // idempotent (callback bisa dikirim ulang)

    const statusCode = Number(payload.status_code);
    const status = String(payload.status || '').toLowerCase();
    const isSuccess = statusCode === 1 || status === 'berhasil' || status === 'success';
    const isFailure = statusCode === -2 || status === 'expired' || status === 'gagal' || status === 'failed';

    if (isSuccess) {
      const amount = Number(payload.total ?? payload.amount);
      if (!Number.isSafeInteger(amount) || amount !== Number(order.total)) {
        console.error('iPaymu callback amount mismatch', ref);
        return text('Amount mismatch', 400);
      }
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      order.ipaymuTransactionId = payload.trx_id == null ? null : String(payload.trx_id);
      order.paymentChannel = payload.channel || payload.via || null;
    } else if (isFailure) {
      order.status = 'FAILED';
      order.failedAt = new Date().toISOString();
    }
    order.lastCallbackAt = new Date().toISOString();
    await env.ORDERS.put(ref, JSON.stringify(order), { expirationTtl: TTL });
    return text('OK', 200);
  } catch (error) {
    console.error('ipaymu callback error', error);
    return text('Invalid callback', 400);
  }
}
