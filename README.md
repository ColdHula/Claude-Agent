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

## Menjalankan (mode live)

1. **Pasang Node.js 22+** dari https://nodejs.org (pilih versi LTS).
2. **Buat API key** di https://console.anthropic.com → *API Keys* → *Create Key*. Isi saldo di *Billing*,
   karena API ditagih terpisah dari langganan Claude.ai (Pro/Max).
3. **Unduh repo ini** (git clone, atau *Code → Download ZIP* di GitHub), lalu di folder repo:

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# buka .env, isi ANTHROPIC_API_KEY=sk-ant-...
npm start                 # buka http://127.0.0.1:3000
```

Bila berhasil, terminal menampilkan `✅ Mode LIVE` dan pil di kanan atas layar berubah hijau **● Mode live**.
Tanpa API key, aplikasi berjalan dalam **mode demo**: animasi dan alurnya sama, tetapi hasilnya contoh.
`public/index.html` juga bisa dibuka langsung tanpa server (otomatis masuk mode demo).

Setiap hasil akhir disimpan ke `hasil/<tanggal>_<tugas>.md`, termasuk lampiran hasil kerja tiap agent.

### Memilih model (Opus atau Sonnet)

Di bawah kotak tugas ada pilihan **Model tim** (diingat browser):

| Pilihan | Pemimpin | 8 agent | Cocok untuk |
|---|---|---|---|
| Opus | Opus 5.5 | Opus 5.5 | Dokumen hukum/sanksi, kepatuhan, analisis penting |
| Campuran | Opus 5.5 | Sonnet 5.5 | Seimbang: pemeriksaan akhir teliti, pengerjaan lebih hemat |
| Sonnet | Sonnet 5.5 | Sonnet 5.5 | Tugas rutin, draf cepat, biaya paling rendah |
| Bawaan (.env) | `LEADER_MODEL` | `WORKER_MODEL` | Mengikuti `.env` (default: Opus untuk semua) |

Harga per 1 juta token: Opus 5.5 $4 masuk / $20 keluar, Sonnet 5.5 $2 / $10.
Biaya tiap tugas tampil di pil **§** pada bar atas (perkiraan, USD).

### Pengaturan lain (`.env`)

| Variabel | Default | Arti |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Kunci API dari console.anthropic.com |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model bawaan untuk semua (`claude-opus-5-5` / `claude-sonnet-5-5`) |
| `LEADER_MODEL` / `WORKER_MODEL` | ikut `CLAUDE_MODEL` | Model bawaan khusus Pemimpin / agent |
| `LEADER_EFFORT` | `high` | Kedalaman berpikir Pemimpin (`low`–`max`) |
| `WORKER_EFFORT` | `medium` | Kedalaman berpikir agent |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Alamat server |

## Pakai dengan langganan Claude (tanpa biaya API)

Mode live di atas memakai API dan ditagih terpisah. Bila ingin memakai **langganan Claude Pro/Max** saja,
jalankan tim ini di **Claude Code** (claude.ai/code, aplikasi desktop, atau CLI). Pemakaiannya masuk kuota langganan.
Kantor Sims (`public/index.html`) tetap butuh API; di Claude Code pekerjaannya tampil sebagai chat biasa.

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
- `src/orchestrator.js`: loop Pemimpin ↔ agent memakai Claude API (streaming, adaptive thinking,
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

## Pakai dari Claude Code

Agent di `.claude/agents/` juga terbaca otomatis sebagai subagent Claude Code. Buka repo ini di Claude Code
dan kirim tugas biasa. `CLAUDE.md` meminta sesi utama bertindak sebagai Pemimpin dan mendelegasikan ke subagent.
