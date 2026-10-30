# 💗 Aira — pendamping 3D + asisten kerja (terisolasi)

Aira adalah avatar 3D yang bisa diajak ngobrol (ketik atau **bicara langsung sambil bertatapan**),
**mengingat** hal tentang Anda, punya **kepribadian yang berubah** dari interaksi, dan bisa **bekerja**:
mencari info terbaru di internet, membaca halaman web, lalu menyimpan hasilnya sebagai berkas.
Aplikasi ini **terpisah** dari Kantor PGA dan HvM AI: kata sandi, data, pengguna Linux, dan jaringannya sendiri.

| Fitur | Isi |
|---|---|
| 📸 Potret Hidup | **Foto wajah realistis hasil AI** (mis. wanita Asia) dianimasikan di browser: berkedip, bicara (mulut & gigi), tersenyum, alis, menoleh 3D semu, mengikuti wajah Anda |
| 🧍‍♀️ Avatar 3D | Model **realistis gratis** (Microsoft Rocketbox, MIT) dengan 52 blendshape ARKit, atau **VRM/GLB** milik Anda (VRoid Studio, MetaPerson, Avaturn), atau avatar bawaan |
| 🎥 Tampilan | 🙂 Fokus wajah · 👤 Setengah badan · 🧍 Seluruh badan (tombol di kanan atas, diingat per perangkat) |
| 👗 Lemari | Ganti model; **ganti baju** Rocketbox (wajah & rambut tetap, badan/baju dari model lain); unggah beberapa foto/model satu karakter sebagai "baju". **Aira bisa ganti baju sendiri** saat diminta di chat |
| 🎙 Mode Live | Bicara tanpa mengetik (pengenalan suara id-ID), Aira menjawab dengan suara, bibir bergerak, berekspresi, dan bisa disela |
| 👀 Kontak mata | Kamera depan dibaca **di browser** (MediaPipe): mata & kepala Aira mengikuti wajah Anda, tahu bila Anda tersenyum/menoleh. Video tidak dikirim ke mana pun |
| 🧠 Memori | Fakta penting disimpan otomatis (lihat/hapus/tambah di panel 🧠), ringkasan obrolan lama, pencarian di seluruh riwayat |
| 💗 Kepribadian | 6 sifat + kedekatan + suasana hati, berubah pelan (maks ±2 per pesan) dan tercatat alasannya di panel 💗 |
| 🌐 Kerja | Pencarian web, baca halaman publik, tulis berkas `.md/.txt/.csv/.json/.html` di folder kerjanya (unduh dari 📁) |
| 🔒 Isolasi | Tidak ada alat shell/file sistem; web hanya alamat publik; di rig berjalan sebagai pengguna `aira` dengan sandbox systemd + firewall |

Otaknya Claude lewat **Claude Agent SDK** (kredit langganan, sama seperti Kantor PGA). Rem biaya per pesan: `AIRA_MAX_USD` (bawaan $0,60).
Obrolan biasa ±$0,02/pesan; pesan dengan pencarian web ±$0,05–0,15.

## Pasang di rig (disarankan)

```bash
cd ~/kantor-pga && git pull
npx -y @anthropic-ai/claude-code setup-token      # sekali; salin tokennya
AIRA_OAUTH_TOKEN=<token> sudo -E bash deploy/pasang-aira.sh
```

Skrip membuat pengguna `aira`, menyalin kode ke `/opt/aira`, memasang layanan systemd terisolasi + firewall,
mengunduh 8 model realistis, dan membukanya di **https://<nama-rig>.ts.net:10000** (Tailscale; HTTPS wajib untuk mikrofon & kamera).
Di akhir, skrip menguji bahwa `aira` **tidak** bisa membuka localhost dan `/home`.

## Jalankan di laptop (coba-coba)

```bash
cd aira && npm install
npm run demo                       # tanpa Claude: avatar, suara, dan UI saja
node ambil-model.mjs pilihan       # unduh 8 model realistis (±7 MB/model setelah dikompres)
npm start                          # dengan Claude (login: npm run login di folder utama, atau CLAUDE_CODE_OAUTH_TOKEN)
```
Buka http://127.0.0.1:3002.

## Potret Hidup (wajah realistis dari foto AI)

1. Buat foto orang **fiktif** dengan generator gambar AI (mis. Canva, Ideogram, Leonardo). Prompt contoh:
   *"Photorealistic portrait photo of a fictional young Indonesian woman, facing the camera, eyes looking into the lens,
   mouth closed with a slight smile, even soft lighting, plain background, 85mm"*. Untuk tampilan seluruh badan:
   *"full-body photo … standing facing the camera, arms at her sides, head to shoes visible"*.
2. Unduh resolusi penuh (≥ 1024 px; seluruh badan ≥ 1600 px tinggi agar wajah tetap tajam saat di-zoom).
3. 👗 Lemari → unggah foto, isi **Karakter** (mis. "Aira"). Unggah foto orang yang sama dengan baju lain dengan Karakter yang sama → bisa ganti baju (juga oleh Aira sendiri).

Jangan memakai foto orang sungguhan tanpa izinnya. Foto dianalisis di browser (MediaPipe); titik wajah disimpan di browser.
Batasan: kepala hanya bisa menoleh sedikit (ilusi 3D), dan badan tidak bergerak selain napas.

## Pilihan model (gratis)

| Sumber | Gaya | Cara | Ganti baju |
|---|---|---|---|
| **Microsoft Rocketbox** (MIT) | Realistis | `node aira/ambil-model.mjs` (27 wanita dewasa: kasual, pesta, kantor, medis, dll.) | ✅ di Lemari: wajah tetap, baju dari model lain |
| **MetaPerson Creator** (avatarsdk.com) | Realistis, dari foto selfie | Buat avatar → ekspor **GLB** → unggah di Lemari | Ekspor tiap baju sebagai GLB, unggah dengan nama Karakter yang sama |
| **Avaturn** (avaturn.me) | Realistis, dari selfie, blendshape ARKit | Ekspor **GLB** → unggah | Sama seperti di atas |
| **VRoid Studio** (gratis, PC) | Anime | Ekspor **VRM** → unggah | Editor baju paling lengkap; ekspor tiap baju |

Model dengan blendshape ARKit (Rocketbox, Avaturn) mendapat ekspresi dan gerak bibir penuh. GLB tanpa blendshape tetap bergerak (napas, tatapan, angguk) tetapi wajahnya tidak berekspresi.
Ready Player Me sudah ditutup (Januari 2026).

## Suara Indonesia (gratis, di perangkat Anda)

Panel 🎤 menampilkan semua suara di perangkat (Indonesia di atas) dengan tombol **▶ Coba**, plus gaya Lembut/Ceria/Dewasa/Manja/Alami.
Yang paling alami: **Microsoft Gadis Online (Natural)** di browser Edge. Lainnya: Google Bahasa Indonesia (Chrome/Android), Damayanti (iPhone).
Pengenalan suara memakai layanan bawaan browser (Chrome/Edge mengirim audio ke Google/Microsoft untuk ditranskripsi).

## Pengaturan (`/etc/aira/aira.env` di rig, atau `aira/.env`)

| Variabel | Bawaan | Arti |
|---|---|---|
| `AIRA_PASSWORD` | — | Kata sandi (wajib bila tidak di 127.0.0.1) |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Token dari `claude setup-token` |
| `AIRA_NAMA` / `AIRA_PENGGUNA` | Aira / Rahula | Nama pendamping & nama Anda |
| `AIRA_MODEL` / `AIRA_MODEL_RINGAN` | claude-sonnet-5-5 / claude-haiku-5-5 | Model jawaban / model peringkas |
| `AIRA_MAX_USD` | 0.6 | Rem biaya per pesan |
| `AIRA_KEDEKATAN_AWAL` | 55 | Kedekatan awal (0–100) |
| `AIRA_PERSONA_FILE` | `persona.md` | Watak dasar. Bisa juga ditaruh di `<data>/persona.md` |
| `AIRA_DATA` | `aira/data` | Folder data (memori, riwayat, model) |
| `AIRA_DEMO` | 0 | 1 = tanpa Claude |
| `PORT` / `HOST` | 3002 / 127.0.0.1 | Alamat server |

## Lapisan isolasi

1. **Alat**: model hanya punya WebSearch + alat Aira (ambil_halaman, memori, berkas di folder kerjanya). Bash/Read/Write/WebFetch dimatikan dan dicegat hook.
2. **Web**: `jaring.js` menolak localhost, LAN, Tailscale (`*.ts.net`, 100.64/10), metadata cloud, dan domain yang resolve ke IP lokal, di setiap redirect.
3. **OS** (`deploy/pasang-aira.sh`): pengguna `aira` tanpa shell; `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateDevices`, tanpa capability; `IPAddressDeny` LAN; firewall iptables menolak koneksi baru `aira` ke localhost & LAN.
4. **Data**: `/var/lib/aira` hanya bisa dibaca `aira` (dan root). Kantor PGA, HvM AI, `.env`, dan `pengetahuan/` tidak terlihat olehnya.

## Struktur

```
aira/
  server.js        HTTP + stream NDJSON, kata sandi, unggah model, berkas
  otak.js          prompt (persona + kepribadian + memori), Claude Agent SDK, alat, pemilah tag [emosi] & <meta>
  memori.js        ingatan, kepribadian dinamis, riwayat, ringkasan (JSON di AIRA_DATA)
  jaring.js        akses web publik yang dipagari
  ambil-model.mjs  pengunduh & pengonversi model Rocketbox (TGA → PNG tanpa dependensi)
  persona.md       watak dasar (bisa diubah)
  public/          index.html, app.js (UI), avatar.js (three.js + three-vrm), potret.js (Potret Hidup),
                   suara.js (TTS/STT), kamera.js (MediaPipe)
```

Proyek yang dipelajari/dipakai: [pixiv/three-vrm](https://github.com/pixiv/three-vrm) (MIT),
[Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT), MediaPipe Tasks Vision (Apache-2.0),
serta pola tag emosi seperti di ChatVRM/Amica dan arsitektur pendamping seperti Project AIRI.
