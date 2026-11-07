async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  return value;
}
export async function onRequestPost({ request, env }) {
  if (!env.IPAYMU_VA || !env.ORDERS) return new Response('Not configured', { status: 503 });
  try {
    const raw = await request.text();
    const payload = JSON.parse(raw);
    const received = request.headers.get('X-Signature') || payload.signature;
    if (!received) return new Response('Missing signature', { status: 401 });
    const data = { ...payload };
    delete data.signature;
    const expected = await hmacHex(env.IPAYMU_VA, JSON.stringify(stable(data)));
    if (received.toLowerCase() !== expected.toLowerCase()) return new Response('Invalid signature', { status: 401 });
    const ref = String(payload.reference_id || payload.referenceId || '');
    if (!ref) return new Response('Missing reference', { status: 400 });
    const stored = await env.ORDERS.get(ref);
    if (!stored) return new Response('Order not found', { status: 404 });
    const order = JSON.parse(stored);
    if (order.status === 'PAID') return new Response('OK', { status: 200 });
    const status = String(payload.status || '').toLowerCase();
    const statusCode = Number(payload.status_code);
    const transactionCode = Number(payload.transaction_status_code);
    if (status === 'berhasil' || status === 'success' || statusCode === 1 || transactionCode === 1 || transactionCode === 6) {
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      order.ipaymuTransactionId = payload.trx_id || null;
    } else if (status === 'gagal' || status === 'failed' || status === 'expired' || statusCode < 0) {
      order.status = 'FAILED';
    }
    await env.ORDERS.put(ref, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 30 });
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('ipaymu callback error', error);
    return new Response('Invalid callback', { status: 400 });
  }
}
