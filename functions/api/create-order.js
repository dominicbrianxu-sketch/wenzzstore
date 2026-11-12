// WENZZSTORE - Checkout otomatis iPaymu (Cloudflare Pages Function)
// Harga dihitung di server. Harga dari browser tidak pernah dipercaya.
// SEMUA respons dari endpoint ini selalu JSON (tidak pernah HTML).

const CATALOG = {
  'Telegram Premium': [
    { label: 'Telegram Premium Gift 3 bulan', duration: '3 bulan', price: 259000 },
    { label: 'Telegram Premium Gift 6 bulan', duration: '6 bulan', price: 369000 },
    { label: 'Telegram Premium Gift 12 bulan', duration: '12 bulan', price: 599000 }
  ],
  'VIU Premium': [{ label: 'Paket 1 bulan', duration: '1 bulan', price: 35000 }],
  'ChatGPT Premium': [{ label: 'Paket 1 bulan — mulai', duration: '1 bulan', price: 90000 }],
  'Spotify Premium': [{ label: 'Paket 1 bulan — mulai WENZZSTORE', duration: '1 bulan', price: 45000 }],
  'X Premium': [{ label: 'Basic 1 bulan — mulai', duration: '1 bulan', price: 95000 }],
  'Netflix Premium': [{ label: 'Paket 1 bulan — mulai', duration: '1 bulan', price: 65000 }],
  'YouTube Premium': [{ label: 'Paket 1 bulan — mulai', duration: '1 bulan', price: 50000 }],
  'iQIYI Premium': [{ label: 'Standard VIP bulanan — mulai', duration: '1 bulan', price: 50000 }],
  'Canva Pro': [{ label: 'Paket 1 bulan — mulai', duration: '1 bulan', price: 18000 }],
  'Disney+ Premium': [{ label: 'Paket 1 bulan — mulai', duration: '1 bulan', price: 70000 }]
};
const ACCESS_TYPES = ['Private', 'Sharing', 'Voucher/Aktivasi'];
const ORDER_TTL = 60 * 60 * 24 * 30;
const RATE_LIMIT_MAX = 8;       // maks. pesanan per IP
const RATE_LIMIT_WINDOW = 600;  // dalam 10 menit

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
// ID baru selalu "lebih kecil" dari ID lama -> daftar KV (urut abjad) menampilkan pesanan TERBARU lebih dulu.
function newOrderId() {
  const reversed = String(9999999999999 - Date.now()).padStart(13, '0');
  return `WZ${reversed}${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}
async function rateLimited(env, request) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `rl:${ip}`;
    const count = Number(await env.ORDERS.get(key)) || 0;
    if (count >= RATE_LIMIT_MAX) return true;
    await env.ORDERS.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  } catch (e) { console.error('rate limit error', e); }
  return false;
}
async function saveOrder(env, order) {
  await env.ORDERS.put(order.orderId, JSON.stringify(order), { expirationTtl: ORDER_TTL });
}

// Diagnostik aman: tidak membuat pesanan dan tidak memanggil iPaymu.
export async function onRequestGet({ env }) {
  const environment = String(env.IPAYMU_ENV || '').toLowerCase();
  return json({
    ok: true, endpoint: 'create-order', method: 'POST',
    kvBound: !!env.ORDERS,
    ipaymuConfigured: !!(env.IPAYMU_VA && env.IPAYMU_API_KEY && ['sandbox', 'production'].includes(environment)),
    environment: environment || null
  });
}

export async function onRequestPost({ request, env }) {
  let order = null;
  try {
    if (!env.ORDERS) return json({ error: 'Server belum siap (KV ORDERS belum dikonfigurasi). Hubungi admin.' }, 503);
    const environment = String(env.IPAYMU_ENV || '').toLowerCase();
    if (!env.IPAYMU_VA || !env.IPAYMU_API_KEY || !['sandbox', 'production'].includes(environment)) {
      return json({ error: 'Pembayaran belum aktif (konfigurasi iPaymu belum lengkap). Hubungi admin.' }, 503);
    }

    let input;
    try { input = await request.json(); } catch { return json({ error: 'Format permintaan tidak valid.' }, 400); }
    if (!input || typeof input !== 'object') return json({ error: 'Format permintaan tidak valid.' }, 400);
    if (input.website) return json({ error: 'Permintaan ditolak.' }, 400); // honeypot anti-bot

    const product = String(input.product || '').trim();
    const packageLabel = String(input.packageLabel || '').trim();
    const duration = String(input.duration || '').trim();
    const accessType = String(input.accessType || '').trim();
    const qty = Number(input.qty);
    const name = String(input.name || '').trim();
    const phone = String(input.phone || '').replace(/[^0-9]/g, '');
    const email = String(input.email || '').trim().toLowerCase();

    const selected = CATALOG[product]?.find(p => p.label === packageLabel && p.duration === duration);
    if (!selected) return json({ error: 'Paket tidak tersedia. Muat ulang halaman lalu pilih paket kembali.' }, 400);
    if (input.packagePrice !== undefined && Number(input.packagePrice) !== selected.price) {
      return json({ error: 'Harga paket berubah. Muat ulang halaman lalu pilih paket kembali.' }, 409);
    }
    if (!ACCESS_TYPES.includes(accessType)) return json({ error: 'Pilih jenis akses terlebih dahulu.' }, 400);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return json({ error: 'Jumlah pesanan harus 1 sampai 10.' }, 400);
    if (!name || name.length > 100) return json({ error: 'Nama lengkap wajib diisi (maks. 100 karakter).' }, 400);
    if (phone.length < 8 || phone.length > 15) return json({ error: 'Nomor WhatsApp tidak valid.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) return json({ error: 'Alamat email tidak valid.' }, 400);

    const total = selected.price * qty;
    if (!Number.isSafeInteger(total) || total < 1000 || total > 100000000) return json({ error: 'Total pembayaran di luar batas.' }, 400);

    if (await rateLimited(env, request)) return json({ error: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' }, 429);

    const orderId = newOrderId();
    const origin = new URL(request.url).origin;
    order = {
      orderId, product, packageLabel, duration, accessTypeRequested: accessType, qty,
      unitPrice: selected.price, total, name, phone, email,
      status: 'CREATING_PAYMENT', paymentProvider: 'iPaymu', createdAt: new Date().toISOString()
    };
    // Simpan dulu agar callback yang datang cepat tetap menemukan pesanan.
    await saveOrder(env, order);

    const body = {
      product: [`WENZZSTORE - ${product} - ${packageLabel}`],
      qty: [String(qty)],
      price: [String(selected.price)],
      description: [`Pesanan ${orderId}`],
      buyerName: name, buyerPhone: phone, buyerEmail: email,
      returnUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(orderId)}`,
      notifyUrl: `${origin}/api/ipaymu/callback`,
      cancelUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(orderId)}&cancel=1`,
      referenceId: orderId
    };
    const bodyText = JSON.stringify(body);
    const bodyHash = await sha256Hex(bodyText);
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const signature = await hmacHex(env.IPAYMU_API_KEY, `POST:${env.IPAYMU_VA}:${bodyHash}:${env.IPAYMU_API_KEY}`);
    const apiBase = environment === 'sandbox' ? 'https://sandbox.ipaymu.com/api/v2' : 'https://my.ipaymu.com/api/v2';

    let paymentResponse, rawText;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      paymentResponse = await fetch(`${apiBase}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', va: env.IPAYMU_VA, signature, timestamp },
        body: bodyText,
        signal: ctrl.signal
      });
      rawText = await paymentResponse.text();
      clearTimeout(timer);
    } catch (e) {
      console.error('iPaymu fetch failed', String(e));
      order.status = 'PAYMENT_CREATION_FAILED';
      order.paymentError = 'Tidak dapat terhubung ke iPaymu.';
      await saveOrder(env, order);
      return json({ error: 'Tidak dapat terhubung ke iPaymu. Coba lagi sebentar lagi.', referenceId: orderId }, 424);
    }

    let data = null;
    try { data = JSON.parse(rawText); } catch { /* bukan JSON */ }
    const paymentUrl = data?.Data?.Url;
    if (!paymentResponse.ok || !data || data.Status !== 200 || typeof paymentUrl !== 'string' || !/^https:\/\//i.test(paymentUrl)) {
      const reason = String(data?.Message || `HTTP ${paymentResponse.status}`).slice(0, 300);
      console.error('iPaymu payment creation failed', paymentResponse.status, reason);
      order.status = 'PAYMENT_CREATION_FAILED';
      order.paymentError = reason;
      await saveOrder(env, order);
      const res = { error: 'iPaymu belum bisa membuat tagihan. Coba lagi atau hubungi admin.', referenceId: orderId };
      if (environment === 'sandbox') res.detail = reason;
      return json(res, 424);
    }

    // Jangan menimpa status PAID bila callback sudah masuk lebih dulu.
    let latest = order;
    try { const raw = await env.ORDERS.get(orderId); if (raw) latest = JSON.parse(raw); } catch { /* pakai order lokal */ }
    latest.paymentUrl = paymentUrl;
    latest.paymentCreatedAt = new Date().toISOString();
    if (latest.status !== 'PAID') latest.status = 'AWAITING_PAYMENT';
    await saveOrder(env, latest);
    return json({ ok: true, referenceId: orderId, total, paymentUrl });
  } catch (error) {
    console.error('WENZZSTORE create-order error', error);
    try {
      if (order && env.ORDERS) {
        const raw = await env.ORDERS.get(order.orderId);
        const cur = raw ? JSON.parse(raw) : order;
        if (cur.status !== 'PAID') { cur.status = 'PAYMENT_CREATION_FAILED'; await saveOrder(env, cur); }
      }
    } catch (e) { console.error('could not mark failed', e); }
    return json({ error: 'Terjadi kesalahan di server. Silakan coba lagi.' }, 500);
  }
}

// Method lain -> JSON, bukan HTML.
export async function onRequest() {
  return json({ error: 'Method tidak didukung.' }, 405);
}
