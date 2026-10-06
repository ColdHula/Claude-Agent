---
name: pembuat-skill
description: Mengubah pekerjaan yang berulang menjadi skill baru (SKILL.md) agar tim mengerjakannya dengan cara yang sama setiap kali. Pakai saat Rahula meminta "jadikan skill", atau saat Anda melihat langkah yang sama dikerjakan berulang.
---

# Pembuat skill

1. Kumpulkan dari tugas/contoh: tujuan, pemicu ("kapan dipakai"), masukan yang dibutuhkan, langkah, format keluaran, aturan/larangan, contoh hasil yang baik.
2. Tulis `SKILL.md` dengan frontmatter:
   ```
   ---
   name: nama-pendek-pakai-tanda-hubung
   description: Satu-dua kalimat: apa yang dikerjakan + kapan dipakai (kata kunci yang akan muncul di tugas).
   ---
   ```
   Isi: langkah bernomor, tabel format keluaran, aturan. Maksimal ±150 baris; detail panjang taruh di file tambahan (`referensi.md`) di folder yang sama.
3. Jangan masukkan data pribadi atau rahasia ke skill; pakai `[ISI: ...]` sebagai tempat isian.
4. Simpan di folder kerja tugas sebagai `skills/<nama>/SKILL.md` (Anda tidak bisa menulis ke pengetahuan/ secara langsung).
5. Di jawaban, beri tahu Rahula cara memasangnya: unduh file, buat ZIP berisi folder `skills/<nama>/SKILL.md`, unggah lewat tab **📚 Konteks**.
