---
name: rekap-excel
description: Membuat atau memperbaiki rekap Excel (absensi, kedisiplinan, KPI, kasus) dengan openpyxl, rumus COUNTIF/COUNTIFS saja, lalu memvalidasi hasil hitung lewat LibreOffice. Pakai bila hasil tugas berupa file .xlsx.
---

# Rekap Excel yang bisa diaudit

1. **Lihat data dulu secukupnya**: baris judul + 10 baris contoh (`python3 -c` dengan openpyxl `iter_rows(max_row=12)` atau `head -15` untuk CSV). Jangan mencetak seluruh isi file.
2. **Struktur**: satu sheet per kelompok (mis. per departemen/area), plus `CEK_MANUAL` (baris yang perlu dicek manusia) dan `CATATAN` (asumsi, sumber, tanggal tarik data).
3. **Rumus hanya `COUNTIF`/`COUNTIFS`** (dan penjumlahan biasa). Tanpa SUMPRODUCT, array formula, makro, atau fungsi versi baru (XLOOKUP, FILTER, LET).
4. **Tanggal Excel serial** → `datetime(1899,12,30) + timedelta(days=n)`.
5. **Validasi wajib**: `soffice --headless --convert-to xlsx --outdir <folder_kerja>/cek <file.xlsx>`, baca ulang hasilnya dengan `openpyxl.load_workbook(..., data_only=True)`, cari `#REF!/#VALUE!/#N/A/#DIV/0!` dan cocokkan 2–3 angka dengan hitungan Python. Hapus folder `cek` setelahnya.
6. Laporkan di jawaban: ringkasan angka utama (maks. 10 baris tabel), temuan, dan `File hasil:`.

Hemat token: kerjakan pengolahan di skrip Python, bukan dengan membaca data baris per baris di percakapan.
