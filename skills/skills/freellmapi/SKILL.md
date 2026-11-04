---
name: freellmapi
description: Memakai FreeLLMAPI (proxy gratis yang menggabungkan free tier Gemini, Groq, Cerebras, Mistral, OpenRouter, dll. di satu endpoint OpenAI-compatible) untuk pekerjaan ringan yang banyak - ringkas, terjemah, klasifikasi, ekstraksi, draf kasar, pendapat kedua - agar hemat kredit Claude. Pakai saat tugas berisi banyak potongan teks berulang, saat diminta "pakai AI gratis/freellmapi", atau untuk membandingkan jawaban model lain.
---

# FreeLLMAPI — AI gratis untuk pekerjaan ringan

FreeLLMAPI ([github.com/tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi)) berjalan di mesin sendiri
dan meneruskan permintaan ke free tier banyak penyedia. Model `auto` memilih penyedia yang kuotanya masih ada.
Kualitas dan kecepatan berubah-ubah sepanjang hari, jadi **hasilnya selalu diperiksa** sebelum dipakai.

## Kapan dipakai (dan kapan tidak)

| Cocok | Jangan |
|---|---|
| Ringkas/terjemah banyak dokumen atau email non-rahasia | Data pribadi: NIK, rekening, gaji, alamat, isi kasus/PB, nama karyawan bermasalah |
| Klasifikasi/label baris CSV, ekstraksi field dari teks | Keputusan hukum/sanksi final, angka yang masuk dokumen resmi tanpa dicek |
| Draf kasar, variasi kalimat, ide judul | Data yang tidak boleh keluar dari perusahaan (kebijakan IT Mayora) |
| Pendapat kedua dari model lain atas draf Anda | Tugas yang butuh membaca/mengubah file (pakai alat Anda sendiri) |

Data dikirim ke penyedia pihak ketiga (Google, Groq, dll.) yang free tier-nya boleh memakai data untuk pelatihan.
Bila ragu, **samarkan dulu** (ganti nama → `[KARYAWAN-1]`, NIK → `[NIK]`) atau jangan pakai skill ini.

## Cara memakai (alat Bash)

Skrip ada di folder skill ini: `skills/skills/freellmapi/scripts/tanya.mjs` (jalur dari folder aplikasi).

```bash
S=skills/skills/freellmapi/scripts/tanya.mjs
node $S --cek                                        # 1) selalu cek dulu: server menyala & kunci benar
node $S "Ringkas jadi 3 poin: ..."                   # model auto
node $S -m auto:fast -s "Terjemahkan ke Inggris formal" -f surat.txt
node $S --json -m auto:smart "Klasifikasikan: ..."   # keluaran JSON {via, text, usage}
node $S --models                                     # daftar model yang siap
```

Pilihan model: `auto` (rantai bawaan), `auto:smart` (paling pintar), `auto:fast` (paling cepat), `auto:reliable`,
`auto:balanced`, `fusion` (gabungan beberapa model, lambat), atau nama model tertentu dari `--models`
(mis. `gemini-2.5-flash`). Baris `[freellmapi: …]` di stderr menunjukkan penyedia yang benar-benar menjawab.

## Pola kerja

1. `--cek`. Bila gagal (server mati/kunci kosong), **jangan berhenti**: kerjakan sendiri seperti biasa dan
   catat "FreeLLMAPI tidak tersedia" di laporan.
2. Pecah pekerjaan besar menjadi potongan ≤ 8.000 karakter; satu panggilan per potongan, simpan hasil ke file kerja.
3. Instruksi singkat dan tegas di `-s`, minta format keluaran yang pasti (daftar bernomor, JSON, tabel Markdown).
4. Periksa hasil: angka, nama, tanggal, dan nomor peraturan dicocokkan dengan sumber. Model gratis sering mengarang.
5. Di laporan, sebut bagian mana yang dibantu FreeLLMAPI dan model apa (`via`).
6. Galat 429/kuota: ulang sekali dengan `-m auto:reliable`, lalu kerjakan sendiri.

## Menyalakan FreeLLMAPI (untuk Rahula, sekali saja)

```bash
git clone https://github.com/tashfeenahmed/freellmapi.git ~/freellmapi && cd ~/freellmapi
printf "ENCRYPTION_KEY=%s\nPORT=3011\n" "$(openssl rand -hex 32)" > .env
docker compose up -d        # tanpa Docker: npm install && npm run build && node server/dist/index.js
```

Buka `http://127.0.0.1:3011`, buat akun dasbor, tambahkan kunci gratis tiap penyedia (Gemini, Groq, Cerebras,
OpenRouter, Mistral, …), lalu salin **unified key** (`freellmapi-…`) dari halaman Keys ke
**Studio → ⚙️ Penyedia → FreeLLMAPI**, atau ke `.env`: `FREELLMAPI_URL=http://127.0.0.1:3011/v1` dan `FREELLMAPI_KEY=…`.
Port 3011 dipakai karena 3001 (bawaan FreeLLMAPI) sudah dipakai HvM AI di rig.
