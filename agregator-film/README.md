# Layar Klasik — agregator film domain publik (prototipe)

Generator situs statis, tanpa dependensi (Node ≥ 22). Ringan: cocok dijalankan di rig mining
dengan `nice -n 19 node build.js`, lalu unggah `dist/` ke Cloudflare Pages/Netlify.

```
node build.js --sample        # uji offline
node build.js                 # ambil data asli dari sumber di config.json
npx serve dist                # pratinjau
```

## Ganti domain / merek
Edit `config.json`: `siteName`, `siteUrl` (domain Anda), `tagline`. Domain dipakai untuk
canonical, sitemap, dan robots.txt.

## Ganti sumber
Tambah adapter di `src/sources/` (ekspor `fetchFilms(cfg)`), daftarkan di `src/sources/index.js`,
lalu ubah `source.type`. Pakai hanya API/sumber berlisensi jelas, bukan menyalin situs lain.

## Iklan (Adsterra, Monetag, dll.)
Kode iklan dari dashboard jaringan ditempel di `config.json` → `ads`:

- `slots.preroll` / `slots.side`: `{ "width", "height", "html" }`. `html` = kode banner/native dari
  dashboard (mis. Adsterra "Banner"/"Native Banner"). Dimuat malas (lazy) di dalam iframe
  tersandbox, jadi tidak memperlambat halaman dan tidak bisa membaca situs Anda.
- `headHtml` / `bodyEndHtml`: untuk kode berbentuk skrip global, mis. Monetag (Vignette/In-Page Push/
  tag verifikasi situs) atau Adsterra Social Bar. Format iklan global ini bisa mengganggu
  pengunjung; pakai secukupnya dan hindari popunder agresif.
- Kosongkan `html` jika slot tidak dipakai. Pintu putar hanya hitung mundur, tanpa wajib klik.

### Pembayaran
Alamat wallet TIDAK ditaruh di kode. Masukkan di dashboard jaringan: Adsterra → Payment/Withdrawal
→ pilih USDT atau Bitcoin → isi alamat Anda sendiri (cek jaringan yang benar, mis. TRC20/ERC20,
dan kirim tes kecil dulu). Aktifkan 2FA. Monetag/PropellerAds → Payoneer untuk ke bank Indonesia.

## Catatan hukum
Status "domain publik" berbeda per negara. Filter `onlyPublicDomainLicense` hanya meloloskan item
yang menandai lisensi domain publik; tetap periksa sampel sebelum terbit dan sediakan jalur
penurunan konten.
