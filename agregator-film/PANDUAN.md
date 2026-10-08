# Panduan: deploy, monetisasi, dan promosi

## 1. Persiapan
1. Edit `config.json`: `siteName`, `siteUrl` (domain asli Anda), `tagline`.
2. Uji lokal: `SAMPLE=1 ALLOW_PLACEHOLDER=1 ./deploy.sh build`, lalu `npx serve dist`.
3. Data asli: `./deploy.sh build` (mengambil film dari Internet Archive). Periksa beberapa film
   dan lisensinya sebelum terbit.

## 2. Deploy ke Cloudflare Pages
1. Buat akun Cloudflare dan proyek Pages: `npx wrangler pages project create layar-klasik`.
2. Buat API Token (My Profile → API Tokens, izin *Cloudflare Pages: Edit*) dan catat Account ID.
3. Jalankan:
   ```bash
   export CLOUDFLARE_API_TOKEN=...   CLOUDFLARE_ACCOUNT_ID=...
   ./deploy.sh pages
   ```
4. Domain sendiri: proyek Pages → Custom domains → tambahkan. Arahkan nameserver ke Cloudflare.
5. Update harian (cron di VPS, `crontab -e`):
   ```
   0 3 * * * cd /path/agregator-film && CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./deploy.sh pages >> deploy.log 2>&1
   ```
   Jangan commit token ke Git. Lebih aman simpan di file `chmod 600` yang di-`source`.

## 3. Alternatif: self-host di VPS/rig
```bash
sudo apt install -y caddy rsync
./deploy.sh local /var/www/layar-klasik
```
`/etc/caddy/Caddyfile`:
```
domainanda.com {
    root * /var/www/layar-klasik
    file_server
    encode gzip
}
```
`sudo systemctl reload caddy`. Tanpa IP publik atau tanpa membuka port: pakai Cloudflare Tunnel.
Aktifkan firewall (`ufw allow 80,443/tcp`). Rig rumah punya risiko uptime dan keamanan jaringan rumah;
Pages lebih disarankan.

## 4. Iklan dan pembayaran crypto
Pilihan (angka dari ulasan pihak ketiga, cek ulang di dashboard):

| Jaringan | Crypto | Catatan |
|---|---|---|
| **Adsterra** (utama) | USDT, BTC (min. sekitar $100) | Persetujuan relatif mudah, formatnya lengkap |
| **Monetag** (tambahan) | tidak terkonfirmasi; e-wallet/Payoneer | Bayar mingguan, minimum rendah |
| **A-ADS** (opsional) | BTC | Dari ingatan saya, tanpa persetujuan rumit tetapi bayaran kecil; verifikasi sendiri |

Prinsip: jaringan "paling longgar" biasanya membayar rendah dan iklannya berkualitas rendah
(redirect, malware), yang menurunkan reputasi domain dan trafik. Mulai dengan Adsterra, tambah Monetag
bila perlu, dan batasi format agresif (popunder).

Langkah:
1. Situs harus live di domain sendiri dengan beberapa puluh halaman.
2. Daftar sebagai publisher, tambahkan situs, ambil kode iklan.
3. Tempel di `config.json` (`ads.slots.*.html`, `ads.headHtml`, `ads.bodyEndHtml`) lalu deploy ulang.
4. Dashboard → Payment: masukkan alamat wallet **Anda sendiri** (USDT: pilih jaringan yang sama dengan
   wallet, mis. TRC20). Kirim tes kecil dulu. Aktifkan 2FA.
5. Jangan pernah meminta atau mewajibkan pengunjung mengklik iklan.

## 5. Promosi
- Daftarkan situs di Google Search Console dan Bing Webmaster; kirim `/sitemap.xml`.
- Tulis sinopsis bahasa Indonesia asli untuk tiap film (kunci SEO dan persetujuan iklan).
- Buat halaman tematik ("film horor klasik 1960-an", "film bisu terbaik").
- Bagikan di Telegram, Pinterest (poster), Shorts/Reels (cuplikan domain publik), dan komunitas film
  klasik secara wajar, bukan spam.
- Tambah film dan perbarui konten rutin. Jangan beli trafik bot atau jasa klik.

## 6. Kepatuhan
Status domain publik berbeda per negara. Cantumkan kontak penurunan konten, simpan lisensi per film
(sudah ditampilkan di halaman), dan segera hapus film bila ada keberatan.
