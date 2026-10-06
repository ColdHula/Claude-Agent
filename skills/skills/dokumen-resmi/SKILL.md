---
name: dokumen-resmi
description: Membuat dokumen resmi PGD (BA, surat, PB, SOP) sebagai DOCX + PDF dari generator/template di pengetahuan/berkas, lalu memeriksa hasil render. Pakai setiap kali hasil tugas berupa dokumen yang akan dicetak atau ditandatangani.
---

# Dokumen resmi → DOCX + PDF

1. **Cari generator yang cocok dulu** (lihat katalog di pengetahuan agent Anda). Ubah isi spec/kasus JSON, bukan kode generator.
   - BA biaya/kasbon: `pengetahuan/berkas/04_toolkit_ba/make_ba.js <spec.json>`
   - PB, SPPHK, SPHK, PKWT: `pengetahuan/berkas/05_kit_hr/generator/gen_pb.js` / `gen_surat.js <kasus.json> <folder_keluaran>`
   - Tidak ada generator: tulis skrip kecil memakai paket `docx` (sudah tersedia lewat NODE_PATH) di folder kerja.
2. **Spec/kasus disimpan di folder kerja tugas**, bukan di `pengetahuan/berkas/` (hanya baca). Karena jalur relatif dihitung dari lokasi spec, isi jalur logo/lampiran dengan jalur absolut (`$PWD/pengetahuan/berkas/...`) dan arahkan keluaran ke folder kerja.
3. **Konversi**: `soffice --headless --convert-to pdf --outdir <folder_kerja> <file.docx>`. Bila `soffice` tidak ada, serahkan DOCX saja dan katakan PDF belum dibuat.
4. **Periksa sebelum menyerahkan**:
   - `pdftotext -layout file.pdf - | head -80` untuk cek teks, nomor, tanggal, nominal.
   - `pdftoppm -jpeg -r 60 file.pdf <folder_kerja>/cek` lalu baca gambar halaman (Read). Cek baris tumpah, tanda tangan terpotong, halaman kosong.
   - Hapus gambar cek setelah selesai agar folder hasil bersih.
5. Data yang belum pasti tulis `[ISI: ...]`, jangan dikarang. Sebutkan di jawaban.
6. Akhiri jawaban dengan daftar `File hasil:`.

Hemat token: jangan menampilkan isi DOCX/JSON panjang di jawaban. Cukup ringkasan isi + nama file.
