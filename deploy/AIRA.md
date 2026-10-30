# Tutorial: memasang Aira (pendamping 3D) di rig HiveOS, langkah demi langkah

Hasil akhirnya:
- Aira berjalan 24 jam di rig, menyala lagi sendiri setelah reboot.
- Dibuka dari HP/laptop lewat `https://<nama-rig>.ts.net:10000` (Tailscale, berpassword sendiri).
- **Terisolasi**: Aira berjalan sebagai pengguna Linux `aira` yang tidak bisa membaca file Anda, tidak bisa
  menjalankan perintah, dan tidak bisa membuka Kantor PGA, HvM AI, Ollama, router, atau perangkat lain di LAN.
  Ia hanya bisa ke internet (Claude, pencarian web, halaman publik).
- Mining tidak terganggu: Aira biasa tidak memakai GPU. Hanya **Mode Premium** (opsional, Bagian 6) yang memakai satu GPU.

Waktu: ±15 menit (tanpa Mode Premium). Anggapan: **Kantor PGA sudah terpasang** di rig ini
(lihat `deploy/HIVEOS.md`), sehingga Node.js, Tailscale, dan token Claude sudah ada.

---

## Bagian 0 — Cek kesiapan rig (2 menit)

Buka **Hive Shell** (the.hiveos.farm → worker → Remote access → Hive Shell → Start → klik tautannya), lalu tempel:

```
node -v; free -h | head -2; df -h / /opt 2>/dev/null | tail -n +2; tailscale status | head -1
```

| Yang dicek | Harus |
|---|---|
| `node -v` | `v22.x` atau lebih baru |
| RAM (`free`) | 16 GB cukup. Aira sendiri hanya memakai ±0,5–1 GB |
| Sisa disk | **≥ 3 GB** untuk Aira + model 3D. **≥ 15 GB** bila nanti mau Mode Premium |
| Tailscale | Ada baris dengan IP `100.x.x.x` (rig sudah tersambung) |

Bila `node` tidak ada → pasang Kantor PGA dulu (`deploy/HIVEOS.md`).

---

## Bagian 1 — Pasang Aira (satu perintah, ±5–10 menit)

Tempel di Hive Shell, lalu Enter:

```
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/loving-franklin-gzzt22/deploy/pasang-aira.sh | sudo bash
```

Skrip ini tidak bertanya apa-apa. Yang dilakukannya:

1. Mengambil kode Aira ke `/home/user/aira-src`.
2. Membuat pengguna sistem `aira` (tanpa shell, tanpa sudo).
3. Menyalin kode ke `/opt/aira` (hanya-baca) dan memasang dependensinya.
4. **Memakai token Claude yang sama dengan Kantor PGA** (diambil dari `~/kantor-pga/.env`), lalu membuat
   **kata sandi Aira yang terpisah**. Kata sandi dicetak di layar: **catat**.
5. Memasang firewall khusus pengguna `aira` (tanpa akses localhost/LAN) dan layanan systemd ber-sandbox.
6. Mengunduh **8 model 3D realistis gratis** (Microsoft Rocketbox, ±60 MB).
7. Membuka akses di Tailscale port **10000**, lalu **menguji isolasi**.

Di akhir harus muncul:

```
  Buka dari HP/laptop …:
    https://kantor-pga.xxxx.ts.net:10000
  Isolasi:  ✅ aira tidak bisa membuka localhost
            ✅ aira tidak bisa membaca /home
```

> Bila muncul **"Token Claude belum ada … MODE DEMO"**: Aira tetap jalan (avatar & suara bisa dicoba), tapi
> jawabannya contoh. Buat token sekali: `npx -y @anthropic-ai/claude-code setup-token` (pindai QR, login, salin
> kode), lalu jalankan ulang: `AIRA_OAUTH_TOKEN=<token> sudo -E bash /home/user/aira-src/deploy/pasang-aira.sh`

Ganti nama/panggilan (opsional), contoh: `AIRA_PENGGUNA=Rahula AIRA_NAMA=Aira` di depan `sudo -E bash …`.

---

## Bagian 2 — Buka dari HP & pasang di layar utama (2 menit)

1. Pastikan aplikasi **Tailscale** di HP **aktif** (Connected).
2. Buka `https://kantor-pga.xxxx.ts.net:10000` di **Chrome** (Android) atau **Safari** (iPhone).
   Harus **https** (ada gembok): mikrofon & kamera hanya diizinkan di HTTPS.
3. Masukkan **kata sandi Aira** (bukan kata sandi Kantor PGA).
4. Pasang di layar utama: Android ⋮ → **Instal aplikasi**; iPhone → Bagikan → **Tambah ke Layar Utama**.

---

## Bagian 3 — Pakai wajah Aira yang realistis (5 menit)

1. Unduh foto Aira resolusi penuh dari Canva (buka tautan → **Download**):
   - Seluruh badan, gaun pesta: https://www.canva.com/M/MAHZf1gar7s
   - Seluruh badan, kasual: https://www.canva.com/M/MAHZf7D_94o
   - Seluruh badan, kantor: https://www.canva.com/M/MAHZf6MWWj8
   - Close-up wajah: https://www.canva.com/M/MAHZfwRWy5I
2. Di aplikasi: **☰ → 👗 Lemari → Unggah foto potret AI**. Untuk **setiap** foto:
   isi Nama (mis. "Aira – pesta") dan **Karakter = `Aira`**, pilih file, **Unggah**.
3. Ketuk foto yang ingin dipakai. Pilih tampilan di kanan atas: 🙂 wajah · 👤 setengah badan · 🧍 seluruh badan.
4. Coba di chat: *"sayang, ganti baju kantor dong"* atau *"kirimin fotomu"*.

---

## Bagian 4 — Suara & mode Live (3 menit)

1. **☰ → 🎤 Suara**. Ketuk **▶ Coba** pada suara Indonesia, lalu **Pilih**. Atur gaya (Lembut/Ceria/Manja/…).
   - Paling alami: buka Aira di **Microsoft Edge** → suara *Microsoft Gadis Online (Natural)*.
   - Android/Chrome: Setelan → Bahasa → Output text-to-speech → Mesin Google → unduh data **Bahasa Indonesia**.
   - iPhone: Setelan → Aksesibilitas → Konten Lisan → Suara → Bahasa Indonesia → unduh **Damayanti**.
2. Tombol **🎙** di kiri kotak ketik = **mode Live**: bicara langsung, Aira menjawab dengan suara sambil bertatapan.
   Izinkan **mikrofon** dan **kamera** saat diminta. Video kamera diproses di HP saja, tidak dikirim ke mana pun.
3. Pakai headset? Centang *"Saya pakai headset"* agar bisa menyela saat Aira bicara.

---

## Bagian 5 — Atur sesuai selera (opsional)

- **👩 Karakter**: ubah watak Aira, atau buat karakter lain (masing-masing punya memori sendiri).
- **🌆 Kencan**: ajak ke kafe/pantai/makan malam, beri hadiah 🎁.
- **⚙️**: nyalakan notifikasi agar Aira bisa **menyapa duluan** (pagi, malam, saat kangen).
- **📔 Diari**: catatan harian yang ditulis Aira tiap malam.

---

## Bagian 6 — Mode Premium: wajah bicara foto-realistis di GPU (opsional, ±30–60 menit)

Mode ini memakai **Ditto** di **satu GPU NVIDIA** untuk membuat video bicara dari foto Aira, plus suara neural
Indonesia. Tanpa mode ini, Aira tetap jalan dengan **Potret Hidup** (animasi di HP, tanpa GPU).

**Syarat:**
- Satu GPU NVIDIA dengan **VRAM bebas ±6–8 GB** yang **tidak dipakai mining**. Ditto dan miner di GPU yang sama
  akan saling berebut VRAM; satu atau keduanya bisa gagal.
- Disk kosong **≥ 15 GB**.
- RAM: layanan ini memakai ±3–5 GB. Dengan RAM 16 GB, **jangan jalankan bersamaan** dengan model lokal besar
  HvM AI (Qwen3-30B ±15 GB). Hentikan dulu: `sudo systemctl stop ik-llama ollama 2>/dev/null`.

**Langkah:**
1. Lihat daftar GPU: `nvidia-smi --query-gpu=index,name,memory.total,memory.used --format=csv`
2. Keluarkan satu GPU dari mining. Di HiveOS: **Flight Sheet / Miner config → Extra config arguments**, isi daftar
   GPU yang dipakai miner tanpa GPU itu (opsi namanya beda per miner, mis. `--devices 0,1` atau `-d 0,1`).
   Simpan, lalu tunggu miner restart. Cek: `memory.used` GPU itu turun mendekati 0.
3. Pasang (ganti `2` dengan indeks GPU yang dibebaskan):
   ```
   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/loving-franklin-gzzt22/deploy/pasang-ditto.sh | sudo AIRA_GPU=2 bash
   ```
   Unduhan ±5–8 GB (PyTorch, TensorRT, model). GPU RTX 20 atau lebih tua dibuatkan mesin TensorRT khusus (10–30 menit).
4. Di akhir harus muncul `Status: {"siap": true, …}`.
5. Di aplikasi: **🎤 Suara → 🎬 Mode Premium** → centang, pilih suara (Gadis/Ardi/Siti/Tuti).
   Pastikan avatar yang dipakai adalah **foto** (Bagian 3).

Terlalu lambat? Jalankan ulang dengan `DITTO_STEPS=10` (lebih cepat, sedikit kurang halus):
`curl -fsSL …/pasang-ditto.sh | sudo AIRA_GPU=2 DITTO_STEPS=10 bash`

---

## Memperbarui Aira

Aira **tidak** ikut pembaruan otomatis Kantor PGA. Untuk memperbarui, jalankan ulang perintah Bagian 1
(memori, kepribadian, foto, dan pengaturan **tidak hilang**). Mode Premium: jalankan ulang perintah Bagian 6.

## Sehari-hari

```
sudo systemctl status aira          # status
journalctl -u aira -f               # log langsung
sudo systemctl restart aira         # mulai ulang
sudo cat /etc/aira/aira.env         # lihat kata sandi Aira (AIRA_PASSWORD)
journalctl -u aira-ditto -f         # log Mode Premium
```

## Bila ada masalah

| Gejala | Penyebab & solusi |
|---|---|
| Halaman tidak terbuka | Tailscale di HP mati, atau salah port. Cek `sudo tailscale serve status` harus ada `:10000`. |
| Mikrofon/kamera tidak mau | Harus lewat `https://…ts.net:10000`, bukan IP. Izinkan di pengaturan situs browser. |
| Live tidak mendengar | Pengenalan suara butuh Chrome/Edge (Android/PC) atau Safari iOS 17+. Firefox belum didukung. |
| Tidak ada suara Indonesia | Ikuti tips di Bagian 4 (unduh data suara di HP), atau pakai Edge. |
| "MODE DEMO" | Token Claude belum ada → lihat catatan di Bagian 1. |
| Avatar foto: "Wajah tidak terdeteksi" | Pakai foto wajah menghadap depan, mata ke kamera, cukup terang. |
| Isolasi ⚠️ di akhir pemasangan | `iptables` tidak tersedia/gagal: `journalctl -u aira-firewall`. Lapisan systemd & aplikasi tetap aktif. |
| Mode Premium "belum siap" | `journalctl -u aira-ditto -n 50`. Umumnya VRAM penuh (miner masih di GPU itu) atau disk penuh. |
| Rig terasa berat | `sudo systemctl stop aira-ditto` (Premium) atau `sudo systemctl stop aira`. |

## Menghapus

```
sudo systemctl disable --now aira aira-firewall aira-ditto aira-gpu-firewall 2>/dev/null
sudo rm -rf /opt/aira /opt/aira-ditto /etc/aira /etc/systemd/system/aira*.service /etc/systemd/system/aira.service.d
sudo rm -rf /var/lib/aira /var/lib/aira-ditto     # HAPUS memori & foto juga (tidak bisa dibatalkan)
sudo tailscale serve --https=10000 off
```

---

## Tanya jawab: otak Aira pakai LLM apa? Cukup RAM 16 GB? Bisa CPU saja?

**Otak Aira tidak berjalan di rig.** Aira memakai **Claude** lewat langganan Anda (sama seperti Kantor PGA):

| Tugas | Model | Di mana |
|---|---|---|
| Ngobrol, kerja, alat (web, memori, baju, foto) | Claude Sonnet 5.5 (`AIRA_MODEL`) | Server Anthropic |
| Ringkasan obrolan lama, buku harian, sapaan pagi/malam | Claude Haiku 5.5 (`AIRA_MODEL_RINGAN`) | Server Anthropic |
| Wajah Potret Hidup, pelacak wajah kamera, suara & pengenalan suara | MediaPipe + suara bawaan perangkat | **HP/laptop Anda** |
| Mode Premium (opsional) | Ditto + Edge TTS | **GPU rig** + layanan suara Microsoft |

Karena itu **RAM 16 GB lebih dari cukup**: server Aira ±0,5–1 GB, tanpa GPU (kecuali Mode Premium), CPU nyaris menganggur.
Biaya diambil dari kredit Agent SDK langganan (obrolan ±$0,02/pesan; dengan pencarian web ±$0,05–0,15),
dengan rem `AIRA_MAX_USD` per pesan.

**Bisa pakai LLM lokal di CPU saja?** Bisa secara teknis (rig Anda sudah menjalankan Qwen3-30B-A3B di CPU untuk
HvM AI), tetapi **saat ini Aira belum punya mesin lokal**, dan ada kompromi bila ditambahkan:
- **Kecepatan**: di CPU, model ±8–30B menghasilkan kira-kira beberapa sampai belasan token/detik. Chat masih nyaman, tetapi
  mode Live (bicara) terasa lambat: ada jeda beberapa detik sebelum Aira menjawab.
- **Kecerdasan**: model lokal lebih sering lupa format tag ekspresi/memori, lebih lemah memakai alat (cari web,
  ganti baju, kirim foto), dan watak/memorinya kurang konsisten dibanding Claude.
- **Isolasi**: Aira sengaja diblokir dari localhost. Agar bisa memakai Ollama/ik_llama di rig, perlu satu pengecualian
  khusus ke port LLM itu (aman bila hanya port itu).
- **RAM 16 GB**: cukup untuk satu model saja. Pilihan masuk akal untuk Aira di CPU: **Qwen3 8B** (±5 GB, cepat),
  **Gemma 3 12B** (±8 GB, bahasa Indonesia bagus), atau **Sahabat-AI** (Gemma2 9B / Llama3 8B yang dilatih khusus
  bahasa Indonesia & daerah). Qwen3-30B-A3B (±15 GB) bisa, tetapi memakan hampir seluruh RAM dan tidak bisa
  bersamaan dengan Mode Premium.

Saran: tetap pakai Claude untuk otak Aira (paling pintar & konsisten, tanpa beban rig), dan jadikan LLM lokal
sebagai **mode cadangan/privat** bila diperlukan, misalnya saat kredit bulanan habis atau saat ingin obrolan
yang tidak keluar dari rig.
