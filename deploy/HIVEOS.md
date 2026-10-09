# Tutorial lengkap: memasang Kantor PGA di rig HiveOS (dari nol)

Hasil akhirnya:
- Kantor PGA berjalan 24 jam di rig mining Anda, otomatis menyala lagi setelah rig reboot.
- Bisa dibuka dari HP, Chromebook, atau laptop di mana saja, dan bisa dipasang di layar utama HP dengan logonya sendiri.
- **Memperbarui diri otomatis**: setiap ada perubahan baru di GitHub (misalnya dari sesi Claude Code Anda),
  rig menariknya dalam ±5 menit dan halaman di HP memuat ulang sendiri.
- Tanpa biaya VPS. Pemakaian Claude diambil dari kredit Agent SDK langganan Claude Pro/Max Anda.

Waktu yang dibutuhkan: ±30 menit, sekali saja.

---

## Bagian 0 — Siapkan akun (5 menit, dari HP)

1. **Akun Claude Pro atau Max** yang aktif.
2. **Klaim kredit Agent SDK** bulanan di akun Claude Anda. Panduan resmi:
   https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
3. **Jangan aktifkan "usage credits"** (kredit tambahan berbayar) di pengaturan akun Claude. Dengan begitu,
   bila kredit bulanan habis, tugas berhenti sendiri dan tidak ada tagihan tambahan.
4. **Akun Tailscale** (gratis untuk pribadi): buka https://tailscale.com → *Get started* → login dengan akun Google.
5. **Pasang aplikasi Tailscale** di setiap perangkat yang akan membuka Kantor PGA, lalu login dengan akun yang sama:
   - HP Android dan Chromebook: Play Store → cari **Tailscale** → Pasang → Login.
   - iPhone: App Store → **Tailscale** → Login.
   Biarkan Tailscale dalam keadaan **Connected/Aktif**.
6. Di HP, buka https://login.tailscale.com/admin/dns lalu nyalakan **MagicDNS** dan **HTTPS Certificates**
   (gulir ke bawah, klik *Enable HTTPS*). Ini membuat alamat aman `https://kantor-pga.xxxx.ts.net`.

---

## Bagian 1 — Buka terminal rig (Hive Shell)

1. Di HP atau Chromebook buka https://the.hiveos.farm dan login.
2. Pilih **farm** Anda → klik nama **worker/rig** Anda.
3. Klik ikon **terminal / Remote access** di bagian atas halaman rig → pilih **Hive Shell** → **Start**.
4. Tunggu ±10 detik sampai muncul tautan, lalu klik tautan itu. Terbuka jendela hitam (terminal) yang
   tersambung ke rig. Di sinilah semua perintah berikut ditempel.

> Alternatif bila HP/Chromebook satu jaringan dengan rig: `ssh user@<IP-rig>` (kata sandi bawaan HiveOS: `1`,
> segera ganti dengan perintah `passwd`).

Cek cepat (tempel, lalu Enter):

```
uname -m; ldd --version | head -1; df -h / | tail -1; free -m | head -2
```

- Baris pertama harus `x86_64`.
- Versi glibc harus **2.28 atau lebih baru**. Bila lebih lama, perbarui image HiveOS dulu (`hive-replace --list`, pilih yang berbasis Ubuntu 22.04).
- Sisa disk sebaiknya **minimal 2 GB** (aplikasi ±600 MB + LibreOffice ±400 MB).

---

## Bagian 2 — Pasang Kantor PGA (satu perintah, ±10 menit)

Tempel perintah ini di Hive Shell, lalu Enter:

```
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-hiveos.sh | sudo bash
```

Skrip berjalan 5 langkah dan beberapa kali bertanya. Jawab seperti ini:

| Pertanyaan | Jawaban |
|---|---|
| *Pasang LibreOffice Writer agar hasil surat/BA juga jadi PDF?* | Tekan **Enter** (Ya). |
| *Buat token sekarang di rig ini? [Y/n]* | Tekan **Enter** (Ya). Lihat penjelasan di bawah. |
| *Tempel token sk-ant-oat01-...* | Hanya muncul bila token tidak tertangkap otomatis: tempel token, Enter. |
| *Kata sandi aplikasi* | Ketik kata sandi minimal 12 karakter, atau kosongkan agar dibuatkan. **Catat kata sandinya.** |
| *Pasang Tailscale?* | Tekan **Enter** (Ya). |

**Membuat token Claude (langkah paling penting):**
1. Setelah menjawab Ya, terminal menampilkan **kode QR**. Pindai dengan kamera HP (tidak perlu menyalin tautan).
2. Di HP: login dengan akun Claude Pro/Max → klik **Authorize**.
3. Halaman menampilkan **kode**. Salin kode itu di HP, lalu tempel di Hive Shell pada baris `Paste code here if prompted >` dan tekan Enter.
   (Menempel ke Hive Shell bisa dilakukan walau menyalin dari Hive Shell sulit.)
4. Token `sk-ant-oat01-...` **diambil otomatis**; muncul `✓ Token tertangkap otomatis`. Tidak perlu disalin.
   Token ini setara kata sandi akun Claude: jangan dibagikan ke siapa pun.

**Login Tailscale di rig:** terminal menampilkan tautan `https://login.tailscale.com/a/...`. Buka di HP,
login dengan akun Tailscale yang sama, klik **Connect**. Rig muncul di daftar perangkat sebagai `kantor-pga`.

Bila berhasil, di akhir muncul:

```
✅ Kantor PGA terpasang.
   • Dari HP/laptop  : https://kantor-pga.xxxx.ts.net
```

Catat alamat itu.

---

## Bagian 3 — Buka dari HP dan pasang di layar utama

1. Pastikan aplikasi Tailscale di HP **aktif**.
2. Buka alamat `https://kantor-pga.xxxx.ts.net` di Chrome (Android/Chromebook) atau Safari (iPhone).
3. Masukkan **kata sandi aplikasi** → **Masuk**. Pil kanan atas harus bertuliskan **● Langganan**.
4. Pasang di layar utama agar muncul dengan logo Kantor PGA (plumbob hijau di atas lantai kantor):
   - **Android (Chrome)**: menu ⋮ → **Tambahkan ke layar utama** / **Instal aplikasi**.
   - **iPhone (Safari)**: tombol Bagikan ⬆ → **Tambahkan ke Layar Utama**.
   - **Chromebook (Chrome)**: menu ⋮ → **Simpan dan bagikan** → **Instal halaman sebagai aplikasi** (atau ★ untuk bookmark).

---

## Bagian 4 — Masukkan konteks ADM PGD

1. Unduh file `pengetahuan-kantor-pga.zip` (dikirim di percakapan Claude) ke HP/Chromebook.
2. Di Kantor PGA, buka tab **📚 Konteks** → **⬆ Unggah paket ZIP** → pilih file itu. Tunggu sampai muncul ✅.

**Data identitas karyawan (KTP, KK, NPWP, SIM, ijazah):** bila Anda ingin tim bisa memakainya, unggah sendiri sebagai ZIP kedua:
1. Di Chromebook, buat folder baru bernama **`berkas`**.
2. Pindahkan folder `03_DATA_SENSITIF_pribadi` (dari paket asli Anda) ke **dalam** folder `berkas`.
3. Klik kanan folder `berkas` → **Zip selection** → unggah `berkas.zip` lewat tab **📚 Konteks**.

Isinya disimpan di `pengetahuan/berkas/` di rig: tidak pernah ikut ke GitHub dan tidak ditempel ke setiap prompt.
Agent pembuat dokumen (Sari, Rina, Joko) membukanya hanya saat tugas memerlukannya. File itu ikut terbaca oleh Claude
ketika dipakai, jadi jaga kata sandi aplikasi dan akun Tailscale Anda.

---

## Bagian 5 — Uji tugas pertama

Tulis di kotak tugas, misalnya:

```
Buat BA kehilangan 2 karton produk di gudang cabang Bekasi, ditemukan saat stock opname 30 September 2026.
```

Klik **Kirim ke Bima**. Anda akan melihat Rahula mengantar berkas ke Bima, Bima membagi tugas, Sari berjalan ke
Rak Skill, dan laporan di tab **💬 Chat**. Hasil akhir muncul otomatis, lengkap dengan tautan unduhan DOCX/PDF.

---

## Bonus: AI lokal gratis di rig (Ollama + Ngobrol)

Selain Kantor PGA (yang memakai Claude), Anda bisa menjalankan model AI **lokal** di rig
untuk chat dan coding: gratis, tanpa kredit, data tidak keluar dari rig. Modelnya berjalan
di **CPU saja**, jadi **ketiga GPU tetap 100% untuk mining** — hashrate tidak terganggu.

> Syarat: CPU ber-AVX2 (mis. Core i5-10400F). Pentium Gold tidak bisa. RAM 16 GB cukup
> untuk model MoE seperti Qwen3-Coder 30B-A3B.

**Langkah 1 — pasang Ollama (CPU-only):**
```
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama.sh | sudo bash
```
Skrip ini memaksa Ollama memakai CPU (GPU tak tersentuh), memberi prioritas di bawah miner,
membatasi RAM, mengunci akses ke Tailscale, lalu mengunduh model coding.

Model untuk RAM 16 GB (CPU-only):
| Model | Perintah | Catatan |
|---|---|---|
| **Qwen2.5-Coder 14B abliterated** (bawaan, tanpa sensor) | — | Kualitas coding terbaik yang muat di 16 GB; rem keamanan dikurangi |
| 7B abliterated (lebih cepat) | `MODEL=huihui_ai/qwen2.5-coder-abliterate:7b` di depan `sudo` | Ringan & cepat |
| Qwen2.5-Coder 14B biasa (bersensor) | `MODEL=qwen2.5-coder:14b` di depan `sudo` | Bila ingin versi standar |
| Qwen3-Coder 30B | — | **TIDAK muat** di 16 GB (butuh ±19 GB / RAM 32 GB+) |

> Model abliterated tidak punya rem keamanan: ia akan menuruti apa pun, jadi **periksa sendiri**
> kode/keluarannya sebelum dijalankan. Risiko sepenuhnya di tangan Anda.

**Langkah 2 — pasang antarmuka "Nexa" (chat + coding):**
```
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ngobrol.sh | sudo bash
```
Nexa adalah aplikasi web (chat biasa + mode coding, riwayat tersimpan, lampiran file,
berpassword, bisa dipasang di layar utama HP dengan logonya). Dibuka di
`https://<nama-rig>.ts.net:8443` (port terpisah dari Kantor PGA).
Nyalakan tombol **💻 Coding** di pojok atas agar jawaban fokus kode yang benar.

**Kata sandi Nexa terpisah dari Kantor PGA**, jadi aman dibagi ke teman/pacar tanpa
memberi akses ke data PGD. Skrip mencetak kata sandinya saat pasang. Mengganti:
```
NEXA_PASSWORD=katasandibaru sudo -E bash -c 'curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ngobrol.sh | bash'
```

**Cek GPU aman:** saat model menjawab, di tab Hive Shell lain jalankan `nvidia-smi` — tidak boleh
ada proses `ollama` di daftar GPU, dan utilisasi GPU tetap penuh oleh miner.

Perintah harian:
| Perlu | Perintah |
|---|---|
| Tambah model | `OLLAMA_HOST=127.0.0.1:11434 ollama pull <model>` |
| Lihat daftar model | `ollama list` |
| Restart chat | `sudo systemctl restart ngobrol` |
| Matikan AI lokal | `sudo systemctl disable --now ngobrol ollama` |

> Catatan: kualitas model lokal 7B–30B jauh di bawah Claude untuk tugas rumit. Pakai untuk
> chat ringan, coding kecil, dan latihan. Untuk dokumen PGA yang ditandatangani, tetap Kantor PGA.

## Pembaruan otomatis

- Timer `kantor-pga-perbarui` memeriksa GitHub tiap 5 menit. Bila ada commit baru di branch
  `claude/bold-feynman-27cfgv`, rig menariknya, memasang dependensi baru bila perlu, lalu me-restart aplikasi.
- Bila tim sedang mengerjakan tugas, pembaruan ditunda sampai tugas selesai.
- Halaman yang sedang terbuka di HP memuat ulang sendiri ke versi baru (saat tim sedang tidak bekerja).
- Jadi cukup minta perubahan di sesi Claude Code untuk repo ini; setelah di-push, ±5 menit kemudian rig ikut berubah.
- Melihat riwayat pembaruan: `sudo journalctl -u kantor-pga-perbarui -n 20`
- Mematikan: `sudo systemctl disable --now kantor-pga-perbarui.timer`

## Sehari-hari

| Perlu | Perintah di Hive Shell |
|---|---|
| Melihat log aplikasi | `sudo journalctl -u kantor-pga -f` (keluar: Ctrl+C) |
| Restart aplikasi | `sudo systemctl restart kantor-pga` |
| Paksa cek pembaruan sekarang | `sudo systemctl start kantor-pga-perbarui` |
| Ganti token / kata sandi | `sudo nano /home/user/kantor-pga/.env` → ubah → Ctrl+O, Enter, Ctrl+X → restart |
| Pasang ulang dari awal | jalankan lagi perintah di Bagian 2 (`.env` lama tetap dipakai) |

## Bila ada masalah

| Gejala | Solusi |
|---|---|
| `glibc ... terlalu lama` | Perbarui image HiveOS ke versi berbasis Ubuntu 22.04 (`hive-replace --list`). |
| `Pengguna 'user' tidak ada` | Jalankan ulang dengan `APP_USER=<nama-user>` di depan `sudo bash`. |
| Pil kanan atas **● Demo** | Token belum terisi/salah. Buat token baru (`npx -y @anthropic-ai/claude-code setup-token` di Hive Shell), isi `CLAUDE_CODE_OAUTH_TOKEN=` di `.env`, hapus baris `DEMO=1`, restart. |
| Tugas gagal "Belum login ke akun Claude" | Token kedaluwarsa atau dicabut. Buat token baru seperti di atas. |
| Alamat `ts.net` tidak terbuka | Tailscale di HP belum aktif, atau HTTPS belum dinyalakan (Bagian 0 no. 6), lalu di rig: `sudo tailscale serve --bg 3000`. |
| "Rem pengaman tercapai" | Satu tugas memakai > $3 kredit. Naikkan `MAX_TASK_USD` di `.env` bila memang perlu. |
| Pembaruan otomatis berhenti dengan "ada perubahan lokal" | Ada file repo yang diubah langsung di rig. Kembalikan: `cd /home/user/kantor-pga && sudo -u user git checkout -- .` |

## Catatan keamanan

- Ganti kata sandi login rig HiveOS bila masih bawaan (`passwd`), karena rig kini menyimpan token Claude dan data PGD.
- Jangan membuka port 3000 ke internet (port forwarding router). Akses hanya lewat Tailscale.
- Aplikasi berjalan dengan prioritas di bawah miner (`Nice=10`) dan dibatasi memori 1,5 GB, sehingga hashrate tidak terganggu.
- Folder `pengetahuan/` dan `hasil/` (termasuk data identitas karyawan) hanya ada di rig, tidak pernah dikirim ke GitHub.
- Repo GitHub saat ini publik. Bila dijadikan private, buat *fine-grained token* (repo `Claude-Agent`, izin *Contents: Read-only*) lalu pasang dengan:
  ```
  export GH_TOKEN=github_pat_xxxxx
  curl -fsSL -H "Authorization: Bearer $GH_TOKEN" https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-hiveos.sh | sudo -E bash
  ```
