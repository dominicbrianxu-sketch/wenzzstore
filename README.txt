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

Tema visual: Orange (#F97316), orange gelap (#EA580C), dan latar lembut (#FFF7ED).


PEMBARUAN KATALOG WENZZSTORE
- Katalog website memuat 10 produk: Telegram Premium, Netflix Premium, Spotify Premium, ChatGPT Premium, X Premium, VIU Premium, YouTube Premium, iQIYI Premium, Canva Pro, dan Disney+ Premium. Telegram Stars tidak dimasukkan.
- Setiap produk memiliki deskripsi manfaat, keterangan tipe akses/durasi yang perlu dikonfirmasi, serta harga mulai dari yang diberikan pemilik toko.
- Telegram Premium menampilkan paket rekomendasi 3 bulan Rp259.000, 6 bulan Rp369.000, dan 12 bulan Rp599.000. Harga ini adalah rekomendasi katalog, bukan harga modal supplier terverifikasi.
- Produk dengan pilihan private/sharing dan variasi durasi diarahkan ke WhatsApp admin untuk memastikan tipe akses, stok, durasi, harga final, serta garansi sebelum pembayaran. Form order otomatis tidak digunakan untuk produk katalog variatif agar tidak menghitung harga yang belum dikonfirmasi.
- Alamat usaha yang diminta untuk ditampilkan: Jalan Iman Bonjol No. 23, Tanjung Balai. Pastikan ejaan dan alamat ini sama persis dengan dokumen usaha serta data yang disampaikan ke iPaymu sebelum website dipublikasikan.
- Target margin 20% belum dapat dihitung secara nyata karena harga modal supplier belum tersedia. Rumus harga jual untuk margin 20% dari harga jual adalah: harga modal / 0,80. Contoh: modal Rp80.000 -> harga jual minimum Rp100.000 (belum termasuk biaya pembayaran/pajak/operasional).
- Data fitur produk ditulis berdasarkan fungsi layanan secara umum. Ketersediaan fitur, kualitas, jumlah perangkat, batas penggunaan, dan ketentuan dapat berubah mengikuti paket resmi, wilayah, dan jenis akses.


PEMBARUAN KATALOG & DEPLOYMENT
- Upload ISI folder wenzz_final ke ROOT repository GitHub, bukan folder wenzz_final sebagai subfolder. Root harus berisi index.html, admin.html, wrangler.toml, dan folder functions/.
- Pastikan Cloudflare Pages Build output directory = . dan root directory kosong. Deployment harus mendeteksi /functions.
- Form checkout kini meminta jenis akses (Private/Sharing/Voucher-Aktivasi), durasi, dan data pelanggan. Semua 10 produk dikenali backend.
- Harga awal yang dipakai adalah harga mulai yang diberikan pemilik toko. Selain Telegram Premium, durasi tambahan belum diberi harga otomatis karena modal dan harga supplier per varian belum tersedia. Admin wajib menetapkan harga final sebelum membuat tagihan iPaymu.
- Telegram Premium memuat usulan katalog 3/6/12 bulan; harga jual ini adalah rekomendasi toko, bukan harga resmi Telegram.
- Jangan mengaktifkan Production sebelum KV ORDERS, Secrets IPAYMU_VA/IPAYMU_API_KEY/ADMIN_TOKEN, callback, dan transaksi Sandbox berhasil diuji.


PEMBARUAN PILIHAN PAKET
- Checkout kini menampilkan daftar paket yang dapat dipilih satu per satu (radio/centang pilihan tunggal).
- Harga ditampilkan hanya untuk varian yang sudah memiliki harga acuan; varian lain tertulis 'Harga final dikonfirmasi admin' agar tidak mengarang harga supplier.
- Backend menyimpan label paket, durasi, jenis akses, dan harga referensi. Admin tetap menetapkan harga final sebelum membuat invoice.
- Harga mulai dari pemilik toko bukan otomatis harga resmi brand. Periksa harga supplier dan hak distribusi sebelum mengubah harga final.
