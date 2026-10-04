# 🏢 Kantor PGA — tim agent Claude untuk Rahula (PGA PGD)

Satu **Pemimpin** (Bima) + **8 agent spesialis** dari dokumen *Paket Agent Claude — Rahula (PGA PGD)*,
lengkap dengan visualisasi kantor isometrik bergaya **The Sims**: plumbob di atas kepala, balon pikiran,
Sim yang berjalan mengantar berkas, dan bar kebutuhan (Energi, Fokus, Sosial, Semangat).

Anda cukup **mengirim satu tugas ke Bima**. Bima memilih agent yang tepat, mendelegasikan (paralel bila bisa),
**memeriksa hasil** tiap agent (minta revisi bila perlu), lalu menyerahkan **satu hasil akhir** siap pakai.

| Sim | Agent | Tugas | Cari di web |
|---|---|---|---|
| ⭐ Bima | Pemimpin | Delegasi + cek akhir | — |
| 📄 Sari | Surat & BA | BA, Surat Klarifikasi, memo, SK, surat instansi | — |
| ⚖️ Dimas | Kepatuhan & Perizinan | Izin MMEA, regulasi, kasus cabang | ✅ |
| 📊 Rina | Data & Rekap | Rekap absensi/KPI/kasus, temuan utama | — |
| 🦺 Joko | SOP, K3 & Vendor | SOP + HIRADC, evaluasi vendor (EVAS) | — |
| ✉️ Maya | Email & Kalender | Triase email yang ditempel, draf balasan | — |
| 🌐 Andi | Chrome & Portal | Rencana langkah portal Mayora/OSS/SIPP | — |
| 💰 Budi | Cari Cuan | Peluang sampingan dengan skenario untung-rugi | ✅ |
| 🔎 Laras | Riset | Riset bersumber primer | ✅ |

## Menjalankan dengan langganan Claude (tanpa biaya tambahan)

Aplikasi ini memakai **login akun Claude Anda** lewat Claude Agent SDK. Pemakaiannya diambil dari
**kredit Agent SDK bulanan** yang sudah termasuk dalam langganan (Pro $20, Max 5x $100, Max 20x $200 per bulan),
bukan dari API key berbayar, dan tidak memotong limit chat Anda.

**Sekali saja:**

1. Pasang **Node.js 22+** dari https://nodejs.org (versi LTS).
2. **Klaim kredit Agent SDK** di akun Claude Anda (lihat
   [panduan resmi](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
3. **Jangan aktifkan "usage credits"** (kredit tambahan berbayar) di pengaturan akun. Dengan begitu,
   bila kredit bulanan habis, tugas berhenti sampai kredit terisi ulang dan tidak ada tagihan.
4. Unduh repo ini, lalu di foldernya:

```bash
npm install
npm run login          # membuka Claude Code: ketik /login, masuk dengan akun Claude Pro/Max, lalu /exit
```

**Setiap kali dipakai:**

```bash
npm start              # buka http://127.0.0.1:3000
```

Bila berhasil, terminal menampilkan `✅ Mode LIVE (langganan)` dan pil kanan atas menjadi **● Langganan**.
Pil **§** menunjukkan perkiraan kredit yang terpakai untuk tugas itu. Ada rem pengaman per tugas
(`MAX_TASK_USD`, bawaan $3) agar satu tugas tidak menghabiskan kredit bulanan.

Tanpa login, jalankan `npm run demo` untuk melihat animasinya saja. `public/index.html` juga bisa dibuka
langsung tanpa server (mode demo).

Setiap hasil akhir disimpan ke `hasil/<tanggal>_<tugas>.md` di laptop Anda (folder ini tidak ikut ke Git).

### Pengetahuan kantor (seperti "Project knowledge" di claude.ai)

Taruh file `.md` atau `.txt` di folder `pengetahuan/`. Isinya otomatis dibaca Bima dan semua agent di setiap tugas,
tanpa restart. Folder ini **tidak ikut ke GitHub**, jadi aman untuk data internal. Batas total ±120.000 karakter.
Saat tugas dimulai, log aktivitas menampilkan "📚 Pengetahuan dimuat: …".

### Memilih model (Opus atau Sonnet)

Di bawah kotak tugas ada pilihan **Model tim** (diingat browser):

| Pilihan | Pemimpin | 8 agent | Pemakaian kredit |
|---|---|---|---|
| Bawaan | Sonnet 5.5 | Sonnet 5.5 | Paling hemat (bawaan mode langganan) |
| Campuran | Opus 5.5 | Sonnet 5.5 | Sedang: pemeriksaan akhir lebih teliti |
| Opus | Opus 5.5 | Opus 5.5 | Paling boros: untuk dokumen hukum/sanksi penting |

Perkiraan kasar: satu tugas dengan 2–3 agent memakai sekitar $0,15–0,75 kredit di Sonnet, kira-kira dua kali lipat di Opus.

### Pengaturan lain (`.env`)

Salin `.env.example` menjadi `.env` bila ingin mengubah bawaan:

| Variabel | Bawaan | Arti |
|---|---|---|
| `MAX_TASK_USD` | `3` | Rem pengaman kredit per tugas (USD perkiraan) |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | Model bawaan untuk semua |
| `LEADER_MODEL` / `WORKER_MODEL` | ikut `CLAUDE_MODEL` | Model bawaan khusus Pemimpin / agent |
| `LEADER_EFFORT` / `WORKER_EFFORT` | `high` / `medium` | Kedalaman berpikir |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Alternatif login: hasil `claude setup-token` |
| `ENGINE` | `langganan` | Isi `api` untuk memakai `ANTHROPIC_API_KEY` berbayar (opsional) |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Alamat server |

## Pakai langsung di Claude Code (juga tanpa biaya tambahan)

Tanpa aplikasi kantor, tim ini juga bisa dipakai di **Claude Code** (claude.ai/code, aplikasi desktop, atau CLI).
Pemakaian interaktif ini memakai limit langganan biasa. Pekerjaannya tampil sebagai chat, tanpa animasi.

1. Buka https://claude.ai/code → sesi baru → pilih repo **ColdHula/Claude-Agent**, branch `claude/bold-feynman-27cfgv`.
2. Pastikan connector **Google Drive** aktif agar konteks ADM PGD bisa dibaca.
3. Kirim tugas seperti biasa. `CLAUDE.md` membuat sesi itu bertindak sebagai Pemimpin dan mendelegasikan
   ke 8 subagent di `.claude/agents/`. Pilih Opus atau Sonnet lewat pemilih model di sesi (atau `/model`).

Agar terstruktur, buat satu sesi khusus Pemimpin dan, bila perlu, satu sesi per agent untuk chat langsung
dengan spesialisnya. Beri judul `Kantor PGA · <Nama> — <Peran>` dan buka dengan pesan:

```
Di sesi ini kamu adalah <nama-agent> (lihat .claude/agents/<nama-agent>.md) — ikuti file itu sebagai instruksi utama.
Sebelum tugas pertama, baca Google Doc "Konteks ADM PGD — Tim Agent Kantor PGA" di Google Drive saya.
Repo ini publik: jangan commit data pribadi (nama karyawan, NIK, nomor laporan, isi perjanjian).
```

Untuk sesi Pemimpin, ganti baris pertama dengan: `Di sesi ini kamu adalah Pemimpin sesuai CLAUDE.md dan prompts/pemimpin.md.`

### Konteks ADM PGD

Konteks kerja (profil, cabang, penandatangan, format BA dan Perjanjian Bersama, kode absensi, daftar file sumber)
disimpan di Google Doc pribadi **"Konteks ADM PGD — Tim Agent Kantor PGA"** di Drive Rahula, bukan di repo ini,
karena repo ini publik. Data yang berubah (kasus, absensi, lembur, outsourcing) dibaca langsung dari file sumbernya di Drive.

## Cara kerjanya

```
Anda ──tugas──▶ Bima (Pemimpin)
                  │ delegasikan_tugas(agent, instruksi)  ← bisa beberapa sekaligus (paralel)
                  ▼
          Sari / Dimas / … / Laras  ──hasil──▶ Bima memeriksa
                  ▲                               │ kurang? minta revisi (maks 2×/agent)
                  └───────────────────────────────┘
                                                  ▼
                                   Hasil akhir + "Hasil Pemeriksaan Pemimpin"
```

- `.claude/agents/*.md`: instruksi 8 agent (diambil dari dokumen paket agent). Ini satu-satunya sumber instruksi.
  Ubah aturan agent di sini, lalu restart server.
- `prompts/pemimpin.md`: instruksi Pemimpin (cara delegasi, daftar cek, format hasil akhir).
- `src/orchestrator-sdk.js`: mesin bawaan (langganan). Pemimpin berjalan lewat Claude Agent SDK dengan login akun Claude;
  8 agent menjadi subagent (web search hanya untuk Riset/Kepatuhan/Cuan), dengan rem pengaman `MAX_TASK_USD`.
- `src/orchestrator.js` (mesin API, hanya bila `ENGINE=api`): loop Pemimpin ↔ agent memakai Claude API (streaming, adaptive thinking,
  web search untuk Riset/Kepatuhan/Cuan, dan `fallbacks: "default"` agar permintaan yang ditolak
  klasifikasi keamanan otomatis diulang di model cadangan).
- `server.js`: server HTTP + Server-Sent Events ke browser.
- `public/index.html`: kantor Sims (canvas isometrik) + panel tim, aktivitas, dan hasil.

### Status plumbob

🟢 siap · 🟡 bekerja · 🔵 berpikir/memeriksa · 🔴 ada masalah. Klik Sim (atau namanya di panel Tim)
untuk melihat tugas, progres, bar kebutuhan, dan hasil terakhirnya. Tombol ❚❚ ▶ ▶▶ ▶▶▶ mengatur kecepatan animasi.

### Batasan yang perlu diketahui

- **Email & Kalender** tidak terhubung ke Gmail/Thunderbird. Tempel isi email di tugas.
- **Chrome & Portal** tidak mengendalikan browser. Ia menyusun langkah yang Anda jalankan sendiri
  (atau tempel ke Claude in Chrome). Patuhi kebijakan IT Mayora soal alat AI.
- **Data & Rekap** belum bisa menerima unggahan file lewat UI. Tempel isi CSV di tugas (atau pakai Claude Code/Cowork untuk file besar).
- Samarkan data pribadi (NIK, rekening) bila tidak perlu, sesuai bagian Keamanan di dokumen paket agent.
