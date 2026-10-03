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

## Menjalankan

Butuh Node.js 22 atau lebih baru.

```bash
npm install
cp .env.example .env      # lalu isi ANTHROPIC_API_KEY
npm start                 # buka http://127.0.0.1:3000
```

Tanpa API key, aplikasi berjalan dalam **mode demo**: animasi dan alur kerjanya sama, tetapi hasilnya contoh.
`public/index.html` juga bisa dibuka langsung tanpa server (otomatis masuk mode demo).

Setiap hasil akhir disimpan ke `hasil/<tanggal>_<tugas>.md`, termasuk lampiran hasil kerja tiap agent.

### Pengaturan (`.env`)

| Variabel | Default | Arti |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Kunci API dari console.anthropic.com |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model untuk Pemimpin dan agent |
| `LEADER_EFFORT` | `high` | Kedalaman berpikir Pemimpin (`low`–`max`) |
| `WORKER_EFFORT` | `medium` | Kedalaman berpikir agent |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Alamat server |

Biaya API per tugas ditampilkan di pil **§** pada bar atas (perkiraan, USD).

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
