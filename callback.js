async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = sortObject(value[key]); return out; }, {});
  }
  return value;
}

function normalizePayload(payload) {
  const normalized = { ...payload };
  for (const key of ['trx_id', 'status_code', 'transaction_status_code', 'paid_off']) {
    if (normalized[key] !== undefined && normalized[key] !== null && /^-?\d+$/.test(String(normalized[key]))) {
      normalized[key] = Number.parseInt(normalized[key], 10);
    }
  }
  if (normalized.is_escrow !== undefined) {
    normalized.is_escrow = normalized.is_escrow === true || normalized.is_escrow === 'true' || normalized.is_escrow === '1' || normalized.is_escrow === 1;
  }
  if (normalized.additional_info === '[]') normalized.additional_info = [];
  else if (normalized.additional_info === undefined) normalized.additional_info = [];
  return normalized;
}

function parseForm(raw) {
  const params = new URLSearchParams(raw);
  const payload = {};
  for (const [key, value] of params.entries()) payload[key] = value;
  return normalizePayload(payload);
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(message, status) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function onRequestPost({ request, env }) {
  if (!env.IPAYMU_VA || !env.ORDERS) return jsonResponse('Not configured', 503);
  try {
    const raw = await request.text();
    const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
    let payload;
    if (contentType.includes('application/json')) payload = normalizePayload(JSON.parse(raw));
    else if (contentType.includes('application/x-www-form-urlencoded')) payload = parseForm(raw);
    else return jsonResponse('Unsupported content type', 415);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return jsonResponse('Invalid payload', 400);

    const received = request.headers.get('X-Signature') || payload.signature;
    if (typeof received !== 'string' || !/^[a-f0-9]{64}$/i.test(received)) return jsonResponse('Missing or invalid signature', 401);
    const data = { ...payload };
    delete data.signature;
    let canonical = JSON.stringify(sortObject(data));
    canonical = canonical.replace(/\//g, '\\/');
    const expected = await hmacHex(env.IPAYMU_VA, canonical);
    if (!safeEqualHex(received.toLowerCase(), expected.toLowerCase())) return jsonResponse('Invalid signature', 401);

    const ref = String(payload.reference_id || payload.referenceId || '');
    if (!/^WZ[A-Z0-9]+$/.test(ref)) return jsonResponse('Invalid reference', 400);
    const stored = await env.ORDERS.get(ref);
    if (!stored) return jsonResponse('Order not found', 404);
    const order = JSON.parse(stored);
    if (order.status === 'PAID') return jsonResponse('OK', 200);

    const statusCode = Number(payload.status_code);
    const status = String(payload.status || '').toLowerCase();
    const isSuccess = statusCode === 1 || status === 'berhasil' || status === 'success';
    const isFailure = statusCode === -2 || status === 'expired' || status === 'gagal' || status === 'failed';
    if (isSuccess) {
      const amountRaw = payload.total ?? payload.amount;
      const amount = Number(amountRaw);
      if (!Number.isSafeInteger(amount) || amount !== Number(order.total)) {
        console.error('iPaymu callback amount mismatch', { referenceId: ref });
        return jsonResponse('Amount mismatch', 400);
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
    await env.ORDERS.put(ref, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 30 });
    return jsonResponse('OK', 200);
  } catch (error) {
    console.error('ipaymu callback error', error);
    return jsonResponse('Invalid callback', 400);
  }
}
