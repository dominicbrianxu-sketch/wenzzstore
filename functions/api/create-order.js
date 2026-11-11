
// ============================================================
// WENZZSTORE - CREATE ORDER API
// Cloudflare Pages Functions
// ============================================================

// DIAGNOSTIC GET
// Memastikan endpoint aktif tanpa membuat pesanan.
export async function onRequestGet() {
  return Response.json(
    {
      ok: true,
      endpoint: "create-order",
      method: "POST",
      message: "Endpoint aktif. Gunakan POST untuk membuat pesanan."
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

// ============================================================
// KATALOG PRODUK
// ============================================================

const CATALOG = {
  "Telegram Premium": {
    start: 230000,
    durations: ["3 bulan", "6 bulan", "12 bulan"]
  },

  "VIU Premium": {
    start: 35000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "ChatGPT Premium": {
    start: 90000,
    durations: ["1 bulan"]
  },

  "Spotify Premium": {
    start: 45000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "X Premium": {
    start: 95000,
    durations: ["1 bulan", "3 bulan", "12 bulan"]
  },

  "Netflix Premium": {
    start: 65000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "YouTube Premium": {
    start: 50000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "iQIYI Premium": {
    start: 50000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "Canva Pro": {
    start: 18000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  },

  "Disney+ Premium": {
    start: 70000,
    durations: ["1 bulan", "3 bulan", "6 bulan", "12 bulan"]
  }
};

const ACCESS = [
  "Private",
  "Sharing",
  "Voucher/Aktivasi"
];

// ============================================================
// CREATE ORDER - POST
// ============================================================

export async function onRequestPost({ request, env }) {
  try {
    // Pastikan KV tersedia.
    if (!env.ORDERS) {
      return Response.json(
        {
          error: "Sistem pesanan belum dikonfigurasi. Hubungi admin."
        },
        { status: 503 }
      );
    }

    const i = await request.json();

    const product = String(i.product || "");
    const item = CATALOG[product];

    const duration = String(i.duration || "");
    const packageLabel = String(i.packageLabel || "");

    const requestedPrice =
      i.packagePrice === null || i.packagePrice === undefined
        ? null
        : Number(i.packagePrice);

    const accessType = String(i.accessType || "");
    const qty = Number(i.qty);

    const name = String(i.name || "").trim();
    const phone = String(i.phone || "").trim();
    const email = String(i.email || "").trim();

    // Validasi data pesanan.
    if (
      !item ||
      !item.durations.includes(duration) ||
      !packageLabel ||
      packageLabel.length > 120 ||
      (
        requestedPrice !== null &&
        (
          !Number.isSafeInteger(requestedPrice) ||
          requestedPrice < 1000 ||
          requestedPrice > 100000000
        )
      ) ||
      !ACCESS.includes(accessType) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 10 ||
      !name ||
      name.length > 100 ||
      !/^[0-9+\- ]{8,20}$/.test(phone) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return Response.json(
        {
          error: "Data pesanan tidak valid. Periksa produk, jenis akses, durasi, dan kontak."
        },
        { status: 400 }
      );
    }

    // Buat ID pesanan.
    const orderId =
      `WZ${Date.now()}${crypto.randomUUID()
        .replaceAll("-", "")
        .slice(0, 8)
        .toUpperCase()}`;

    // Data pesanan.
    const order = {
      orderId,
      product,
      duration,
      packageLabel,
      accessTypeRequested: accessType,
      qty,

      unitPrice: requestedPrice,
      startingPrice: item.start,
      quotedPackagePrice: requestedPrice,

      total:
        requestedPrice === null
          ? null
          : requestedPrice * qty,

      name,
      phone,
      email,

      status: "WAITING_ADMIN",

      priceNote:
        requestedPrice === null
          ? "Harga varian belum tersedia secara terverifikasi; admin wajib menetapkan harga final."
          : "Harga merupakan referensi paket; admin wajib memeriksa jenis akses dan stok sebelum membuat tagihan.",

      createdAt: new Date().toISOString()
    };

    // Simpan pesanan ke Cloudflare KV.
    await env.ORDERS.put(
      orderId,
      JSON.stringify(order),
      {
        expirationTtl: 2592000
      }
    );

    // Respons berhasil.
    return Response.json({
      referenceId: orderId,
      startingPrice: item.start,
      packageLabel,
      duration,
      quotedPackagePrice: requestedPrice,
      status: order.status
    });

  } catch (e) {
    console.error("CREATE ORDER ERROR:", e);

    return Response.json(
      {
        error: "Pesanan belum dapat disimpan."
      },
      { status: 500 }
    );
  }
}
