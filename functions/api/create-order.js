const CATALOG = {
  'Telegram Premium': {
    packages: {
      'Telegram Premium Gift 3 bulan': { duration: '3 bulan', price: 259000 },
      'Telegram Premium Gift 6 bulan': { duration: '6 bulan', price: 369000 },
      'Telegram Premium Gift 12 bulan': { duration: '12 bulan', price: 599000 }
    }
  },
  'VIU Premium': { packages: { 'Paket 1 bulan': { duration: '1 bulan', price: 35000 } } },
  'ChatGPT Premium': { packages: { 'Paket 1 bulan — mulai': { duration: '1 bulan', price: 90000 } } },
  'Spotify Premium': { packages: { 'Paket 1 bulan — mulai WENZZSTORE': { duration: '1 bulan', price: 45000 } } },
  'X Premium': { packages: { 'Basic 1 bulan — mulai': { duration: '1 bulan', price: 95000 } } },
  'Netflix Premium': { packages: { 'Paket 1 bulan — mulai': { duration: '1 bulan', price: 65000 } } },
  'YouTube Premium': { packages: { 'Paket 1 bulan — mulai': { duration: '1 bulan', price: 50000 } } },
  'iQIYI Premium': { packages: { 'Standard VIP bulanan — mulai': { duration: '1 bulan', price: 50000 } } },
  'Canva Pro': { packages: { 'Paket 1 bulan — mulai': { duration: '1 bulan', price: 18000 } } },
  'Disney+ Premium': { packages: { 'Paket 1 bulan — mulai': { duration: '1 bulan', price: 70000 } } }
};
const ACCESS = ['Private', 'Sharing', 'Voucher/Aktivasi'];

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ORDERS) return Response.json({ error: 'Sistem pesanan belum dikonfigurasi.' }, { status: 503 });
    if (!env.IPAYMU_VA || !env.IPAYMU_API_KEY || !['sandbox', 'production'].includes(String(env.IPAYMU_ENV || '').toLowerCase())) {
      return Response.json({ error: 'Koneksi pembayaran belum dikonfigurasi. Silakan hubungi admin.' }, { status: 503 });
    }

    const input = await request.json();
    const product = String(input.product || '');
    const packageLabel = String(input.packageLabel || '');
    const item = CATALOG[product]?.packages?.[packageLabel];
    const duration = String(input.duration || '');
    const accessType = String(input.accessType || '');
    const qty = Number(input.qty);
    const name = String(input.name || '').trim();
    const phone = String(input.phone || '').trim();
    const email = String(input.email || '').trim();

    if (!item || item.duration !== duration || Number(input.packagePrice) !== item.price || !ACCESS.includes(accessType) ||
        !Number.isInteger(qty) || qty < 1 || qty > 10 || !name || name.length > 100 ||
        !/^[0-9+\- ]{8,20}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Produk atau harga tidak valid. Pilih produk dengan harga yang tersedia.' }, { status: 400 });
    }

    const total = item.price * qty;
    if (!Number.isSafeInteger(total) || total < 1000 || total > 100000000) {
      return Response.json({ error: 'Total pembayaran di luar batas yang diizinkan.' }, { status: 400 });
    }

    const orderId = `WZ${Date.now()}${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const origin = new URL(request.url).origin;
    const order = {
      orderId, product, packageLabel, duration, accessTypeRequested: accessType,
      qty, unitPrice: item.price, total, name, phone, email,
      status: 'CREATING_PAYMENT', paymentUrl: null,
      createdAt: new Date().toISOString()
    };
    await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });

    const body = {
      product: [`${product} - ${packageLabel} - ${accessType}`],
      qty: [String(qty)],
      price: [String(item.price)],
      description: [`WENZZSTORE ${orderId} - ${product} ${duration}`],
      buyerName: name,
      buyerPhone: phone,
      buyerEmail: email,
      returnUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(orderId)}`,
      notifyUrl: `${origin}/api/ipaymu/callback`,
      cancelUrl: `${origin}/payment-status.html?ref=${encodeURIComponent(orderId)}&cancel=1`,
      referenceId: orderId
    };
    const json = JSON.stringify(body);
    const bodyHash = await sha256(json);
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const signature = await hmac(env.IPAYMU_API_KEY, `POST:${env.IPAYMU_VA}:${bodyHash}:${env.IPAYMU_API_KEY}`);
    const api = String(env.IPAYMU_ENV).toLowerCase() === 'sandbox' ? 'https://sandbox.ipaymu.com/api/v2' : 'https://my.ipaymu.com/api/v2';

    const paymentResponse = await fetch(`${api}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', va: env.IPAYMU_VA, signature, timestamp },
      body: json
    });
    const paymentData = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok || paymentData.Status !== 200 || typeof paymentData.Data?.Url !== 'string' || !/^https:\/\//i.test(paymentData.Data.Url)) {
      console.error('iPaymu create payment failed', paymentResponse.status, paymentData?.Message || 'No message');
      order.status = 'PAYMENT_CREATION_FAILED';
      order.paymentErrorAt = new Date().toISOString();
      await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });
      return Response.json({ error: 'iPaymu belum berhasil membuat pembayaran. Silakan coba lagi atau hubungi admin.' }, { status: 502 });
    }

    order.status = 'AWAITING_PAYMENT';
    order.paymentUrl = paymentData.Data.Url;
    order.ipaymuSessionId = paymentData.Data.SessionId || null;
    order.paymentCreatedAt = new Date().toISOString();
    await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 2592000 });
    return Response.json({ referenceId: orderId, total, status: order.status, paymentUrl: order.paymentUrl });
  } catch (error) {
    console.error('create-order error', error);
    return Response.json({ error: 'Tidak dapat membuat pembayaran saat ini. Silakan coba lagi.' }, { status: 500 });
  }
}
