// BUKAN lagi konfirmasi manual. Pembelian berjalan otomatis (create-order.js).
// Endpoint ini hanya dipakai admin untuk MEMBUAT ULANG tagihan iPaymu pada pesanan yang
// gagal membuat tagihan (status PAYMENT_CREATION_FAILED / CREATING_PAYMENT).
// Harga selalu diambil dari pesanan yang tersimpan, tidak bisa diubah dari sini.
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(v) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(env.ADMIN_TOKEN)]);
  return a === b;
}
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const RETRYABLE = ['PAYMENT_CREATION_FAILED', 'CREATING_PAYMENT'];

export async function onRequestPost({ request, env }) {
  try {
    if (!(await isAdmin(request, env))) return reply({ error: 'Akses admin ditolak.' }, 401);
    const environment = String(env.IPAYMU_ENV || '').toLowerCase();
    if (!env.IPAYMU_VA || !env.IPAYMU_API_KEY || !env.ORDERS || !['sandbox', 'production'].includes(environment)) {
      return reply({ error: 'Konfigurasi iPaymu/ORDERS belum lengkap.' }, 503);
    }
    let input; try { input = await request.json(); } catch { return reply({ error: 'Format permintaan tidak valid.' }, 400); }
    const ref = String(input?.referenceId || '');
    if (!/^WZ[A-Z0-9]+$/.test(ref)) return reply({ error: 'Nomor pesanan tidak valid.' }, 400);
    const raw = await env.ORDERS.get(ref);
    if (!raw) return reply({ error: 'Pesanan tidak ditemukan.' }, 404);
    const order = JSON.parse(raw);
    if (!RETRYABLE.includes(order.status)) return reply({ error: `Pesanan berstatus ${order.status}; tidak perlu dibuat ulang.` }, 409);
    if (!Number.isSafeInteger(order.unitPrice) || !Number.isInteger(order.qty)) return reply({ error: 'Data harga pesanan tidak lengkap.' }, 400);

    const origin = new URL(request.url).origin;
    const body = {
      product: [`WENZZSTORE - ${order.product} - ${order.packageLabel || ''}`.trim()],
      qty: [String(order.qty)], price: [String(order.unitPrice)],
      description: [`Pesanan ${ref}`],
      buyerName: order.name, buyerPhone: order.phone, buyerEmail: order.email,
      returnUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(ref)}`,
      notifyUrl: `${origin}/api/ipaymu/callback`,
      cancelUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(ref)}&cancel=1`,
      referenceId: ref
    };
    const bodyText = JSON.stringify(body);
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const signature = await hmacHex(String(env.IPAYMU_API_KEY).trim(), `POST:${String(env.IPAYMU_VA).trim()}:${await sha256Hex(bodyText)}:${String(env.IPAYMU_API_KEY).trim()}`);
    const api = environment === 'sandbox' ? 'https://sandbox.ipaymu.com/api/v2' : 'https://my.ipaymu.com/api/v2';
    const res = await fetch(`${api}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', va: String(env.IPAYMU_VA).trim(), signature, timestamp }, body: bodyText });
    let data = null; try { data = JSON.parse(await res.text()); } catch { /* bukan JSON */ }
    const url = data?.Data?.Url;
    if (!res.ok || !data || data.Status !== 200 || typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      console.error('iPaymu retry failed', res.status, data?.Message);
      return reply({ error: `iPaymu gagal membuat tagihan${data?.Message ? ': ' + String(data.Message).slice(0, 200) : '.'}` }, 424);
    }
    // Baca ulang: jangan menimpa PAID bila callback masuk di sela-sela.
    const latest = JSON.parse((await env.ORDERS.get(ref)) || raw);
    latest.paymentUrl = url; latest.paymentError = null; latest.paymentCreatedAt = new Date().toISOString();
    if (latest.status !== 'PAID') latest.status = 'AWAITING_PAYMENT';
    await env.ORDERS.put(ref, JSON.stringify(latest), { expirationTtl: 2592000 });
    return reply({ ok: true, paymentUrl: url, referenceId: ref, total: order.total });
  } catch (e) {
    console.error('admin confirm error', e);
    return reply({ error: 'Gagal membuat ulang tagihan.' }, 500);
  }
}
export async function onRequest() { return reply({ error: 'Method tidak didukung.' }, 405); }
