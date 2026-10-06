---
name: periksa-dokumen
description: Daftar periksa mutu sebelum menyerahkan dokumen atau rekap - nama, NIK, tanggal dan hari, nomor surat, nominal dan terbilang, penandatangan, sisa isian, serta hasil render. Pakai di akhir setiap tugas yang menghasilkan dokumen resmi atau angka.
---

# Periksa sebelum menyerahkan

Centang semuanya; tulis hasil cek singkat di jawaban (✅ / ⚠️ + alasan).

| Cek | Cara |
|---|---|
| Nama & jabatan | sama persis dengan sumber (lampiran/pengetahuan), ejaan dan gelar |
| NIK / nomor induk | 16 digit untuk NIK KTP; cocokkan dengan sumber, jangan dikarang |
| Tanggal ↔ hari | hitung hari dari tanggal (`python3 -c "import datetime;print(datetime.date(2026,9,30).strftime('%A'))"`), tulis dalam bahasa Indonesia |
| Nomor surat | format sesuai katalog penomoran; nomor urut tidak bentrok |
| Nominal | angka = terbilang; total = jumlah rincian |
| Penandatangan | sesuai matriks penandatangan di pengetahuan |
| Isian tersisa | cari `[ISI` / `[VERIFIKASI` / `xxx` → sebutkan di jawaban |
| Dasar hukum | nomor & tahun peraturan benar; pasal tidak dikarang |
| Render | PDF dibuka sebagai gambar: tidak ada baris tumpah, tanda tangan tidak terpotong |
| Data pribadi | hanya yang diperlukan dokumen ini |
