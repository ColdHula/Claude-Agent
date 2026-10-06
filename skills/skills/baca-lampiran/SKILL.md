---
name: baca-lampiran
description: Cara membaca lampiran (PDF, DOCX, XLSX, CSV, foto) dan berkas rujukan dengan hemat token - ambil bagian yang perlu saja. Pakai sebelum membuka file besar atau banyak file.
---

# Membaca lampiran dengan hemat

- **Ukur dulu**: `ls -la`, `wc -l`, `pdfinfo file.pdf | grep Pages`.
- **PDF**: `pdftotext -layout -f 1 -l 2 file.pdf -` untuk halaman awal; `grep -n` kata kunci pada hasil teks; render ke gambar (`pdftoppm -jpeg -r 60 -f N -l N`) hanya untuk halaman yang perlu dilihat (tanda tangan, tabel rumit, hasil scan).
- **DOCX**: `python3 -c "import docx;d=docx.Document('f.docx');print('\n'.join(p.text for p in d.paragraphs[:80]))"`.
- **XLSX/CSV**: nama sheet + dimensi + 10 baris contoh dulu; olah sisanya di skrip.
- **Foto**: baca gambar langsung (Read) bila perlu isi visualnya.
- **Folder pengetahuan**: baca file yang relevan dengan tugas saja (lihat daftar file di instruksi Anda); pakai `grep -rn "<kata kunci>" pengetahuan/<folder>` sebelum membuka file utuh.
- Jangan menyalin isi file mentah ke jawaban. Kutip seperlunya, sebutkan nama file dan halamannya.
