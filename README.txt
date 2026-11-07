WENZZSTORE — WEBSITE + ADMIN + IPAYMU (CLOUDFLARE PAGES)
========================================================
Domain: https://wenzzstore.my.id
Alur: pelanggan membuat pesanan -> admin memeriksa pesanan/stok -> admin menentukan harga final -> backend membuat invoice iPaymu -> admin mengirim link pembayaran via WhatsApp -> callback terverifikasi memperbarui status.

ISI PAKET
- index.html: katalog, FAQ, dan formulir pesanan.
- admin.html: panel admin untuk melihat pesanan dan membuat tagihan.
- payment-status.html: halaman status pembayaran.
- terms.html, refund.html, privacy.html: halaman kebijakan.
- functions/api/create-order.js: menyimpan pesanan.
- functions/api/admin/orders.js: daftar pesanan (wajib ADMIN_TOKEN).
- functions/api/admin/confirm.js: membuat invoice iPaymu setelah persetujuan admin.
- functions/api/ipaymu/callback.js: menerima callback JSON/form-urlencoded, memvalidasi HMAC, mencocokkan nominal, dan memperbarui status secara idempotent.
- functions/api/order-status.js: status pesanan untuk halaman pelanggan.

PENTING SEBELUM DEPLOY
1. Buat KV Namespace di Cloudflare, misalnya bernama ORDERS.
2. Di Cloudflare Pages > Settings > Functions > KV namespace bindings, buat binding Variable name: ORDERS dan pilih namespace yang dibuat.
3. Di Settings > Variables and Secrets, tambahkan:
   - ADMIN_TOKEN (Secret): buat token acak panjang dan rahasiakan.
   - IPAYMU_VA (Secret): VA merchant.
   - IPAYMU_API_KEY (Secret): API Key merchant.
   - IPAYMU_ENV (Variable): sandbox untuk uji Sandbox atau production setelah akun disetujui.
4. Deploy seluruh isi folder ini sebagai root project Pages. Jangan mengunggah folder induk yang membungkus file-file ini.
5. File wrangler.toml berisi placeholder KV ID. Jika Anda menggunakan Dashboard binding seperti langkah 2, binding ORDERS di Dashboard yang dipakai. Jika deploy dengan Wrangler CLI, ganti placeholder id dengan ID KV Namespace Anda.
6. Atur callback di dashboard iPaymu ke https://wenzzstore.my.id/api/ipaymu/callback. Pilih application/json bila tersedia; handler juga mendukung application/x-www-form-urlencoded.
7. Panel admin ada di https://wenzzstore.my.id/admin.html. Masukkan ADMIN_TOKEN yang sama dengan Secret Cloudflare.

PENGUJIAN
- Uji pembuatan pesanan dan kemunculannya di panel admin.
- Uji konfirmasi admin dengan kredensial Sandbox.
- Uji callback Sandbox asli dari iPaymu dan pastikan signature diterima serta nominal cocok.
- Pastikan status berubah menjadi PAID hanya setelah callback valid.
- Jangan gunakan Production sebelum iPaymu menyetujui akun dan pengujian Sandbox berhasil.

KEAMANAN DAN BATASAN
- Jangan pernah memasukkan VA, API Key, atau ADMIN_TOKEN ke HTML, JavaScript browser, atau repository publik.
- Callback menolak signature yang tidak valid dan menolak nominal yang tidak sama dengan total order.
- KV tidak menyediakan transaksi/lock atomik untuk mencegah dua permintaan admin bersamaan. Untuk volume besar atau kebutuhan konkurensi ketat, pindahkan order ke database dengan operasi atomik.
- Pastikan harga katalog, durasi paket, hak distribusi, dan ketentuan layanan tiap produk benar sebelum menerima pembayaran.

KATALOG SERVER SAAT INI
Telegram Premium Rp230.000; Netflix Premium Rp65.000; Spotify Premium Rp45.000; ChatGPT Premium Rp90.000 per item. X Premium masih diarahkan ke admin karena harga belum ditetapkan.
