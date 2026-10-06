# 🏢 Kantor PGA — tim agent Claude untuk Rahula (PGA PGD)

Satu **Pemimpin** (Bima) + **8 agent spesialis** dari dokumen *Paket Agent Claude — Rahula (PGA PGD)*,
lengkap dengan kantor isometrik hidup ala *Claude Office* × **The Sims**: jendela kaca dengan skyline kota
(siang/malam mengikuti jam), pod meja dengan monitor ganda, **Rak Skill**, pantry, lounge, plumbob di atas kepala,
balon pikiran, dan panel chat ala Slack **#kantor-pga** tempat tim melapor. Anda punya avatar sendiri (Rahula):
klik lantai untuk berjalan, klik Sim untuk menyapa. Kamera bisa digeser, di-zoom, dan mengikuti Sim.

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

**Cara memberi tugas & lampiran per jenis tugas:** [public/cara-pakai.md](public/cara-pakai.md) (juga tombol **📖 Cara Pakai** di aplikasi).

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

Taruh file `.md` atau `.txt` di folder `pengetahuan/`: `umum/` untuk semua, `<id-agent>/` khusus satu agent
(mis. `surat-ba/`), `pemimpin/` khusus Bima. Dibaca otomatis di setiap tugas, tanpa restart (lihat `pengetahuan/README.md`). Folder ini **tidak ikut ke GitHub**, jadi aman untuk data internal. Batas total ±120.000 karakter.
Saat tugas dimulai, log aktivitas menampilkan "📚 Pengetahuan dimuat: …".
Di rig/server, paket pengetahuan bisa diunggah sebagai **ZIP** lewat kartu **Pengetahuan kantor** di panel kanan.
Subfolder `pengetahuan/berkas/` berisi template, toolkit, dan dokumen sumber: tidak dimuat ke prompt, tetapi dibaca
dan dijalankan oleh agent pembuat file saat diperlukan.

### Lampiran dan hasil berupa file (mode langganan)

- Tombol **📎 Lampirkan file** di bawah kotak tugas: unggah CSV/XLSX/PDF/DOCX/foto (maks. 60 MB per file).
  File disimpan di `hasil/tugas-<id>/masukan/` dan dibaca tim.
- **Sari (Surat & BA), Rina (Data & Rekap), dan Joko (SOP, K3 & Vendor)** bisa membuat file: DOCX + PDF untuk surat/BA,
  XLSX untuk rekap. Mereka hanya menulis di folder tugas itu; `pengetahuan/berkas/` hanya dibaca.
- File hasil muncul sebagai tautan unduhan di jendela **Hasil akhir**.
- Untuk PDF, server perlu LibreOffice Writer (`sudo apt install libreoffice-writer-nogui`); skrip pemasangan HiveOS menawarkannya.

### Memilih model

Di bawah kotak tugas ada pilihan **Model** (diingat browser):

| Pilihan | Pemimpin | 8 agent | Pemakaian kredit |
|---|---|---|---|
| Hemat (bawaan) | Sonnet 5.5, berpikir sedang | Sonnet 5.5 | Paling hemat |
| Sonnet, Bima lebih dalam | Sonnet 5.5, berpikir dalam | Sonnet 5.5 | Hemat |
| Campuran | Opus 5.5 | Sonnet 5.5 | Sedang: pemeriksaan akhir lebih teliti |
| Opus semua | Opus 5.5 | Opus 5.5 | Paling boros: dokumen hukum/sanksi penting |

### Skill dan penghematan token

- **Claude Skills**: `skills/` berisi plugin lokal `kantor` dengan 10 skill:
  `hukum-pengadilan` (**Skill COURT**: PHI, mediasi Disnaker, somasi, gugatan, laporan polisi), `dokumen-resmi`,
  `periksa-dokumen`, `rekap-excel`, `baca-lampiran`, `sop-hiradc`, `riset-sumber`, `rencana-kerja`,
  `memori-kantor`, dan `pembuat-skill`. Agent hanya melihat daftar nama + deskripsinya; isi skill
  baru dimuat saat dipakai. Di kantor, Sim berjalan ke **Rak Skill** dan mengambil buku saat memakai skill.
  Skill pribadi: taruh di `pengetahuan/skills/<nama>/SKILL.md` (ikut paket ZIP, tidak ke GitHub).
- **Memori kantor**: bila hasil akhir Bima berisi bagian "## Catatan untuk Diingat", poin-poinnya otomatis disimpan ke
  `pengetahuan/umum/99-memori-kantor.md` dan dipakai di tugas berikutnya (nomor surat terakhir, keputusan, status kasus).
- **Pengetahuan sesuai kebutuhan**: hanya ±16.000 karakter per agent yang ditempel ke prompt; file lain
  muncul sebagai indeks dan dibaca agent dengan Read bila relevan (`KNOWLEDGE_INLINE_CHARS`).
- **Pemadatan konteks otomatis**: percakapan dipadatkan saat konteks mendekati 100 rb token (`KONTEKS_MAKS_TOKEN`),
  tampil di chat sebagai 🗜️.
- **Prompt caching** dari Claude Agent SDK: instruksi dan pengetahuan yang sama dibaca ulang dari cache (±10% harga).
  Pil ⚡ di atas menampilkan jumlah token dan persentase cache; tab **🧰 Skill** merangkum penghematannya.
- **Pemimpin berpikir secukupnya**: preset hemat memakai effort medium untuk Bima; semua agent tetap Sonnet 5.5.

Perkiraan kasar: satu tugas dengan 2–3 agent memakai sekitar $0,15–0,75 kredit di Sonnet, kira-kira dua kali lipat di Opus.

### Pengaturan lain (`.env`)

Salin `.env.example` menjadi `.env` bila ingin mengubah bawaan:

| Variabel | Bawaan | Arti |
|---|---|---|
| `MAX_TASK_USD` | `3` | Rem pengaman kredit per tugas (USD perkiraan) |
| `CLAUDE_MODEL` | — | Paksa satu model untuk semua (mematikan preset hemat) |
| `LEADER_MODEL` / `WORKER_MODEL` / `LIGHT_MODEL` | preset hemat | Model khusus Pemimpin / agent / agent ringan |
| `LEADER_EFFORT` / `WORKER_EFFORT` | `medium` / `medium` | Kedalaman berpikir |
| `KNOWLEDGE_INLINE_CHARS` | `16000` | Pengetahuan yang ditempel ke prompt per agent |
| `KONTEKS_MAKS_TOKEN` | `100000` | Batas konteks sebelum dipadatkan otomatis |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Alternatif login: hasil `claude setup-token` |
| `ENGINE` | `langganan` | Isi `api` untuk memakai `ANTHROPIC_API_KEY` berbayar (opsional) |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Alamat server |

## Pasang di rig HiveOS (bisa dibuka dari HP/laptop mana saja)

Ikuti tutorial langkah demi langkah di [deploy/HIVEOS.md](deploy/HIVEOS.md): satu perintah memasang aplikasi sebagai
layanan yang selalu menyala, akses aman lewat Tailscale + kata sandi (`APP_PASSWORD`), dan **pembaruan otomatis**:
rig mengecek GitHub tiap 5 menit, menarik perubahan baru (ditunda bila tim sedang bekerja), dan halaman di HP memuat ulang sendiri.
Aplikasi punya logo dan manifest, jadi bisa dipasang di layar utama HP seperti aplikasi biasa.

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

### Kantor dan kontrolnya

- Plumbob: 🟢 siap · 🟡 bekerja · 🔵 berpikir/memeriksa · 🔴 ada masalah.
- **Seret** untuk menggeser, **gulir/cubit** untuk zoom, tombol ⟲ untuk melihat seluruh kantor, 🎯 agar kamera mengikuti Sim terpilih.
  Di keyboard: panah/WASD dan +/−.
- **Klik lantai**: avatar Rahula berjalan ke sana. **Klik Sim**: Rahula menghampiri dan panel kiri atas menampilkan tugas,
  bar kebutuhan, dan hasil terakhirnya.
- Saat tugas dikirim, Rahula mengantar berkas ke meja Bima; Bima mengantar tugas ke tiap agent, agent mengantar hasil
  kembali, dan Bima menyerahkan hasil akhir ke Rahula. Papan kanban di dinding menampilkan tugas aktif per Sim.
- Saat santai, Sim ngopi di pantry, ngobrol di meja rapat, atau rehat di lounge.
- 🌗 mengatur pencahayaan (otomatis/siang/malam), ◐ tema terang/gelap, ❚❚ ▶ ▶▶ kecepatan animasi.
- Panel bertab: 💬 Chat #kantor-pga, 👥 Tim (dengan model tiap agent), 🧰 Skill, 📚 Konteks (pengetahuan), 📁 Hasil.

### Batasan yang perlu diketahui

- **Email & Kalender** tidak terhubung ke Gmail/Thunderbird. Tempel isi email di tugas.
- **Chrome & Portal** tidak mengendalikan browser. Ia menyusun langkah yang Anda jalankan sendiri
  (atau tempel ke Claude in Chrome). Patuhi kebijakan IT Mayora soal alat AI.
- Lampiran dan file hasil hanya tersedia di mode langganan (bawaan), bukan `ENGINE=api`.
- Samarkan data pribadi (NIK, rekening) bila tidak perlu, sesuai bagian Keamanan di dokumen paket agent.
