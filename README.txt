WENZZSTORE — KONFIRMASI ADMIN + iPaymu (Cloudflare Pages)
========================================================
Domain: https://wenzzstore.my.id
Alur: pelanggan pesan -> admin cek stok/harga -> admin klik konfirmasi -> sistem membuat invoice iPaymu -> admin mengirim link melalui WhatsApp.

ISI PAKET
- index.html: katalog dan form pesanan; tidak langsung menagih.
- admin.html: panel admin untuk memeriksa pesanan dan membuat tagihan.
- payment-status.html, privacy.html, refund.html, terms.html.
- functions/api/create-order.js: simpan pesanan WAITING_ADMIN.
- functions/api/admin/orders.js: daftar pesanan, dilindungi ADMIN_TOKEN.
- functions/api/admin/confirm.js: membuat invoice iPaymu setelah persetujuan admin.
- functions/api/ipaymu/callback.js: callback pembayaran.
- functions/api/order-status.js: status pesanan.

SETUP CLOUDFLARE
1. Deploy seluruh isi ZIP ke project Cloudflare Pages untuk wenzzstore.my.id.
2. Buat KV Namespace bernama ORDERS.
3. Pages > Settings > Functions > KV namespace bindings: Variable name ORDERS, pilih namespace tersebut.
4. Pages > Settings > Variables and Secrets, tambahkan sebagai Secret: ADMIN_TOKEN (token acak panjang), IPAYMU_VA (VA merchant), IPAYMU_API_KEY (API Key). Tambahkan IPAYMU_ENV sebagai variable: sandbox untuk tes atau production setelah tes.
5. Deploy ulang setelah binding dan secrets disimpan.
6. Atur callback iPaymu ke https://wenzzstore.my.id/api/ipaymu/callback. Pastikan format signature callback sesuai dokumentasi resmi dan uji sandbox.
7. Panel admin: https://wenzzstore.my.id/admin.html. Masukkan ADMIN_TOKEN. Jangan berikan token kepada pelanggan.
8. Uji: pelanggan pesan -> pesanan muncul di admin -> admin isi harga final dan klik konfirmasi -> sistem membuat link iPaymu -> admin kirim ke WhatsApp -> callback memperbarui status. Jangan live sebelum callback sandbox tervalidasi.

HARGA KATALOG AWAL SERVER
Telegram Premium Rp230.000; Netflix Premium Rp65.000; Spotify Premium Rp45.000; ChatGPT Premium Rp90.000 per item. Admin dapat mengganti harga final per item saat konfirmasi. X Premium masih melalui WhatsApp karena harga belum ditetapkan. Pastikan durasi/paket tiap harga jelas sebelum produksi.

KEAMANAN
Jangan pernah memasukkan VA/API Key ke HTML atau browser. Callback saat ini fail-closed; validasi signature harus dicocokkan dengan payload callback aktual dari akun iPaymu sebelum produksi. KV cocok untuk volume ringan; untuk skala besar gunakan database dan autentikasi admin yang lebih kuat.
