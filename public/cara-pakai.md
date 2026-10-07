# Cara Pakai Kantor PGA

**Intinya:** tulis tugas sekali, lampirkan bahan aslinya, kirim ke Bima. Bima membagi ke agent yang tepat, agent memakai skill dan pengetahuan kantor, lalu Bima memeriksa dan menyerahkan hasil akhir beserta file DOCX/PDF/Excel.

## 1. Cara kerja tim

| Langkah | Yang terjadi |
|---|---|
| 1. Anda kirim tugas | Teks tugas + lampiran (📎) masuk ke meja Bima |
| 2. Bima membagi | Bima memilih agent: Sari (surat/BA), Rina (rekap/Excel), Dimas (izin/kasus), Joko (GA/K3/aset/vendor), Maya (email/jadwal), Andi (IT/portal), Laras (riset) |
| 3. Agent bekerja | Membaca lampiran + pengetahuan kantor, memakai skill (mis. dokumen-resmi, rekap-excel, hukum-pengadilan), membuat file |
| 4. Bima memeriksa | Mengecek nama, angka, tanggal, format; minta revisi bila perlu |
| 5. Hasil akhir | Ringkasan + hasil + **daftar yang perlu Anda lengkapi/putuskan** + tautan unduhan file |

Pantau prosesnya di tab **💬 Chat**. Klik Sim mana pun untuk melihat tugas dan progresnya.

## 2. Langkah memberi tugas

1. Tulis tugas di kotak **Kirim tugas ke Bima** (pakai rumus di bawah).
2. Klik **📎 Lampirkan file**, pilih semua bahan (boleh beberapa file sekaligus, maks. 60 MB per file).
3. Pilih **Model**: biarkan *Bawaan/Hemat* untuk pekerjaan rutin; pilih *Opus semua* untuk dokumen hukum, PHK, atau sanksi.
4. Klik **Kirim ke Bima** (atau Ctrl + Enter).
5. Tunggu hasil akhir terbuka otomatis → unduh file di bagian **File hasil**. Semua hasil tersimpan di tab **📁 Hasil**.

**Beberapa tugas sekaligus:** tidak perlu menunggu. Kirim tugas berikutnya kapan saja; bawaannya 3 tugas dikerjakan bersamaan, sisanya antre otomatis. Daftar **Tugas berjalan** di bawah kotak tugas menampilkan status tiap tugas (berjalan/antre/selesai), tombol **Batal**, dan **Buka** hasil. Pesan di chat diberi label `#1`, `#2`, dst. sesuai tugasnya.

**Lampiran cepat:** seret & lepas file ke halaman (boleh banyak sekaligus), atau tempel screenshot dengan **Ctrl+V** di kotak tugas. Paket ZIP pengetahuan: buka tab **📚 Konteks**, lalu seret ZIP ke sana.

## 3. Rumus menulis tugas (APA – UNTUK APA – DATA – KEPUTUSAN – BENTUK)

```
APA      : Buat BA Pengajuan Advance Kasbon listrik, air, telepon
PERIODE  : Oktober 2026, kantor DIK Jakarta
DATA     : tagihan terlampir (3 file); total sesuai tagihan
KEPUTUSAN: penanda tangan seperti BA kasbon bulan lalu; nomor BA lanjut dari yang terakhir
BENTUK   : DOCX + PDF siap tanda tangan
```

- Tulis **keputusan yang sudah Anda ambil** (NIK mana yang dipakai, siapa penanda tangan, libur nasional), supaya agent tidak berhenti untuk bertanya.
- Data yang tidak ada akan ditulis `[ISI: ...]`, bukan dikarang. Lengkapi lalu kirim tugas revisi.
- Satu tugas = satu tujuan. Pekerjaan besar boleh sekaligus, tetapi sebutkan urutannya.

## 4. Lampiran per jenis tugas

| Jenis tugas | Wajib dilampirkan | Sebaiknya ditambahkan | Tulis di teks tugas | Hasil |
|---|---|---|---|---|
| **BA Pengajuan Advance Kasbon** (ATK, listrik, air, telepon, servis, parkir, sewa) | Tagihan/invoice/penawaran (foto atau PDF) | BA kasbon bulan lalu sebagai acuan | Bulan, cabang, rincian bila tagihan tidak jelas, penanda tangan | DOCX + PDF |
| **BA Penyelesaian Advance Kasbon** | **Bukti bayar**: struk, bukti transfer, nota, tanda terima | BA Pengajuan yang terkait | Nominal aktual bila beda dari pengajuan | DOCX + PDF |
| **Rekap absensi / kedisiplinan karyawan** | Export fingerprint (CSV/TXT/XLSX asli dari mesin) | Master karyawan (XLSX), daftar izin/cuti/sakit, jadwal shift/roster | Periode, area (DKI/Banten), libur nasional, keputusan NIK ganda/baru | XLSX (COUNTIF) + temuan |
| **Absensi outsourcing & cek tagihan vendor** | Export fingerprint + invoice vendor | Kontrak/tarif vendor, daftar personel vendor | Vendor, periode | XLSX rekonsiliasi + selisih |
| **Lembur & insentif** | Rekap absensi/fingerprint | Surat perintah lembur, skema insentif, upah/gaji pokok | Periode, aturan yang dipakai | XLSX perhitungan |
| **Data gaji (validasi)** | Draf payroll/komponen gaji | Rekap absensi, lembur, potongan | Bulan, cut-off | XLSX + daftar selisih |
| **Karyawan baru (onboarding)** | — | Berkas yang sudah ada (KTP, ijazah, CV) | Nama, jabatan, cabang, tanggal masuk, atasan | Checklist + jadwal induction + surat |
| **Karyawan keluar (SPPHK/SPHK/PB/paklaring)** | Surat resign / dasar PHK | PKWT/kontrak, data upah, sisa cuti, daftar aset yang dipegang | Nama, NIK, jabatan, tanggal masuk & efektif keluar, alasan, nomor surat terakhir | DOCX + PDF + BAST aset |
| **Izin karyawan / surat keterangan** | — | Form izin/cuti, surat dokter | Nama, jenis izin, tanggal, keperluan surat | DOCX + PDF |
| **Tracker izin & kasus cabang** | Rekap izin (XLSX) atau foto/PDF izin | Laporan kasus/issue dari cabang | Cabang yang dicek, tenggat yang dipantau | Tracker urut tenggat |
| **Kasus / somasi / sengketa (Skill COURT)** | Bukti: foto, chat, nota, data AR/tagihan | Kronologi tertulis, surat sebelumnya, kontrak | Pihak, nilai, kejadian, apa yang sudah dilakukan, hasil yang diinginkan | Kronologi, matriks bukti, opsi, draf somasi/PB |
| **Verifikasi rumah sales baru** | Foto rumah/lokasi + data sales (alamat KTP & domisili) | Titik lokasi (share-loc), hasil tanya tetangga/RT | Nama sales, cabang, tanggal kunjungan | BA Klarifikasi Verifikasi (Valid/Fiktif) |
| **Kunjungan sales kasus** | Data AR/setoran yang bermasalah | Foto kunjungan, pernyataan sales | Kronologi singkat, hasil kunjungan | BA kunjungan + rekomendasi |
| **Kecelakaan / BAK vendor sewa** | Formulir vendor asli (PDF) + foto kejadian | Foto STNK/nopol, data driver & helper | Waktu, lokasi, kronologi, kerusakan, kendaraan pengganti | Formulir terisi DOCX/PDF |
| **SOP / IK / HIRADC** | — | Foto area/aktivitas, SOP lama | Aktivitas, lokasi, masalah yang mau dicegah | SOP + tabel HIRADC |
| **APAR & pest control** | Daftar APAR (lokasi, jenis, tgl isi ulang) atau foto label | Laporan vendor pest control, kontrak | Lokasi yang dicakup | Jadwal + checklist |
| **Aset & sewa** | Daftar aset / perjanjian sewa | BAST lama, foto aset | Aset yang dicek, jatuh tempo | Register aset + BAST |
| **Pemenuhan tenaga kerja / vendor outsourcing** | — | Data headcount, laporan vendor | Posisi, jumlah, cabang, tanggal dibutuhkan | Surat permintaan + evaluasi vendor |
| **Masalah IT (printer, komputer, wifi)** | Foto/screenshot pesan error | Merek/tipe perangkat | Apa yang sudah dicoba | Langkah perbaikan + kapan eskalasi |
| **MOR IRGA bulanan** | Format MOR bulan lalu (XLSX) | Rekap absensi, biaya GA, kasus, izin bulan itu | Bulan laporan, tenggat | Draf MOR + ringkasan |
| **Email & jadwal** | Tempel isi email atau screenshot (tidak terhubung ke inbox) | — | Siapa pengirim, apa yang mau dijawab | Triase + draf balasan |
| **Riset regulasi/vendor** | — | Dokumen yang mau dibandingkan | Pertanyaan spesifik, lingkup | Ringkasan bersumber + yang belum pasti |

## 5. Tips agar hasil tepat

- **File asli lebih baik dari foto**: CSV/XLSX dari mesin/sistem > screenshot; PDF asli > hasil scan.
- **Foto**: tegak, terang, seluruh dokumen terlihat; satu dokumen satu foto.
- **Nama file jelas**, mis. `tagihan_listrik_okt2026.pdf`, `fingerprint_DIK_1-5okt.csv`.
- **Revisi**: kirim tugas baru, lampirkan file hasil sebelumnya, tulis yang harus diubah. Koreksi berlaku untuk semua dokumen sejenis dalam tugas itu.
- **Dokumen yang sudah ditandatangani** jangan diminta dibuat ulang; minta "tambal halaman X" atau "buat lampiran baru".
- **Memori kantor**: fakta tetap (nomor surat terakhir, keputusan Anda) disimpan otomatis dari hasil akhir dan dipakai tugas berikutnya.
- **Data rutin** (template, master karyawan, daftar cabang) cukup diunggah sekali lewat tab **📚 Konteks** sebagai ZIP, tidak perlu dilampirkan tiap tugas.

## 6. Yang tidak dilakukan tim

- Tidak mengirim email/WA, tidak login atau submit di portal, tidak menandatangani. Semua hasil berupa **draf untuk Anda periksa**.
- Tidak membaca data yang tidak dilampirkan atau tidak ada di pengetahuan (mis. absensi setelah tanggal file).
- Tidak mengarang NIK, nominal, nomor surat, atau tanggal.

## 7. Biaya & batas

- Pemakaian diambil dari kredit Agent SDK langganan Claude; pil **§** menunjukkan pemakaian tugas saat ini, pil **⚡** jumlah token.
- Ada rem pengaman per tugas (bawaan $3). Tugas berat (rekap besar + banyak dokumen) sebaiknya dipecah.
- Bawaan 3 tugas berjalan bersamaan (atur `MAX_TUGAS_PARALEL` di `.env`), maksimal 10 antre. Tiap tugas punya rem pengaman sendiri; makin banyak tugas paralel, makin cepat kredit terpakai.
