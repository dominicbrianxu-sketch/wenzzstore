// WENZZSTORE - Automatic iPaymu checkout (Cloudflare Pages Function)
// Server-side prices are authoritative; browser-supplied prices are never trusted.
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

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Safe diagnostic GET: does not create an order or call iPaymu.
export async function onRequestGet() {
  return json({ ok: true, endpoint: 'create-order', method: 'POST', message: 'Endpoint aktif. Gunakan POST untuk membuat pesanan.' });
}

export async function onRequestPost({ request, env }) {
  let orderId = null;
  try {
    if (!env.ORDERS) return json({ error: 'Binding KV ORDERS belum dikonfigurasi.' }, 503);
    const environment = String(env.IPAYMU_ENV || '').toLowerCase();
    if (!env.IPAYMU_VA || !env.IPAYMU_API_KEY || !['sandbox', 'production'].includes(environment)) {
      return json({ error: 'Konfigurasi iPaymu belum lengkap. Periksa IPAYMU_VA, IPAYMU_API_KEY, dan IPAYMU_ENV.' }, 503);
    }
    const input = await request.json();
    const product = String(input.product || '').trim();
    const packageLabel = String(input.packageLabel || '').trim();
    const duration = String(input.duration || '').trim();
    const accessType = String(input.accessType || '').trim();
    const qty = Number(input.qty);
    const name = String(input.name || '').trim();
    const phone = String(input.phone || '').trim();
    const email = String(input.email || '').trim();
    const selected = CATALOG[product]?.find(p => p.label === packageLabel && p.duration === duration);
    if (!selected) return json({ error: 'Paket tidak tersedia atau belum memiliki harga final. Pilih paket yang menampilkan harga.' }, 400);
    if (input.packagePrice !== undefined && Number(input.packagePrice) !== selected.price) {
      return json({ error: 'Harga paket tidak sesuai. Muat ulang halaman dan pilih paket kembali.' }, 409);
    }
    if (!ACCESS_TYPES.includes(accessType)) return json({ error: 'Jenis akses tidak valid.' }, 400);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return json({ error: 'Jumlah pesanan harus antara 1 sampai 10.' }, 400);
    if (!name || name.length > 100) return json({ error: 'Nama lengkap wajib diisi (maksimal 100 karakter).' }, 400);
    if (!/^[0-9+\- ]{8,20}$/.test(phone)) return json({ error: 'Nomor WhatsApp tidak valid.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) return json({ error: 'Alamat email tidak valid.' }, 400);
    const total = selected.price * qty;
    if (!Number.isSafeInteger(total) || total < 1000 || total > 100000000) return json({ error: 'Total pembayaran di luar batas yang diizinkan.' }, 400);

    orderId = `WZ${Date.now()}${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const origin = new URL(request.url).origin;
    const order = {
      orderId, product, packageLabel, duration, accessTypeRequested: accessType, qty,
      unitPrice: selected.price, total, name, phone, email,
      status: 'AWAITING_PAYMENT', paymentProvider: 'iPaymu', createdAt: new Date().toISOString()
    };
    // Save first so callback can find the order if it arrives quickly.
    await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });

    const body = {
      product: [`WENZZSTORE - ${product} - ${packageLabel}`],
      qty: [String(qty)], price: [String(selected.price)],
      description: [`Pesanan ${orderId}`], buyerName: name, buyerPhone: phone, buyerEmail: email,
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
    const paymentResponse = await fetch(`${apiBase}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', va: env.IPAYMU_VA, signature, timestamp },
      body: bodyText
    });
    let paymentData;
    try { paymentData = await paymentResponse.json(); }
    catch {
      console.error('iPaymu returned non-JSON response', paymentResponse.status);
      order.status = 'PAYMENT_CREATION_FAILED';
      await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });
      return json({ error: 'Respons iPaymu tidak dapat dibaca. Silakan hubungi admin.', referenceId: orderId }, 502);
    }
    const paymentUrl = paymentData?.Data?.Url;
    if (!paymentResponse.ok || paymentData?.Status !== 200 || typeof paymentUrl !== 'string' || !/^https:\/\//i.test(paymentUrl)) {
      console.error('iPaymu payment creation failed', paymentResponse.status, paymentData?.Message || 'Unknown response');
      order.status = 'PAYMENT_CREATION_FAILED';
      order.paymentError = String(paymentData?.Message || 'iPaymu gagal membuat tagihan.').slice(0, 300);
      await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });
      return json({ error: 'iPaymu belum berhasil membuat tagihan. Periksa konfigurasi akun atau hubungi admin.', referenceId: orderId }, 502);
    }
    // Preserve a PAID state if callback has already arrived.
    const latestRaw = await env.ORDERS.get(orderId);
    const latest = latestRaw ? JSON.parse(latestRaw) : order;
    latest.paymentUrl = paymentUrl;
    latest.paymentCreatedAt = new Date().toISOString();
    if (latest.status !== 'PAID') latest.status = 'AWAITING_PAYMENT';
    await env.ORDERS.put(orderId, JSON.stringify(latest), { expirationTtl: 2592000 });
    return json({ ok: true, referenceId: orderId, total, paymentUrl });
  } catch (error) {
    console.error('WENZZSTORE create-order error', error);
    if (orderId && env.ORDERS) {
      try {
        const raw = await env.ORDERS.get(orderId);
        if (raw) {
          const order = JSON.parse(raw);
          if (order.status !== 'PAID') {
            order.status = 'PAYMENT_CREATION_FAILED';
            await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });
          }
        }
      } catch (storageError) { console.error('Could not update failed order', storageError); }
    }
    return json({ error: 'Terjadi kesalahan saat membuat pesanan atau tagihan. Silakan coba kembali.' }, 500);
  }
}
