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

## Iklan
Isi `ads.prerollHtml` / `ads.sideHtml` dengan kode jaringan iklan Anda. Pintu putar hanya hitung
mundur, tidak mewajibkan klik iklan (klik paksa melanggar kebijakan hampir semua jaringan).
Cek kebijakan jaringan yang dipakai; AdSense menolak situs berisi sedikit konten asli, jadi tambahkan
sinopsis/ulasan bahasa Indonesia buatan sendiri.

## Catatan hukum
Status "domain publik" berbeda per negara. Filter `onlyPublicDomainLicense` hanya meloloskan item
yang menandai lisensi domain publik; tetap periksa sampel sebelum terbit dan sediakan jalur
penurunan konten.
