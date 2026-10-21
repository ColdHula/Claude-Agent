# HvM AI dari Laptop — pakai Qwen3-30B-A3B abliterated + Add to Home

Panduan memakai HvM AI dari laptop (Windows / Mac / Linux / Chromebook), termasuk
mengganti model ke **Qwen3-30B-A3B versi abliterated (tanpa sensor)** dan memasang
HvM AI sebagai **aplikasi di layar utama/desktop**.

> Alamat HvM AI: **https://hvm-ai.taile6dcd6.ts.net**
> (cadangan: `https://kantor-pga.taile6dcd6.ts.net:8443`) — hanya terbuka saat **Tailscale aktif**.

---

## 0) Prasyarat: Tailscale aktif di laptop

1. Pasang Tailscale: **https://tailscale.com/download** (Windows/Mac/Linux), atau Play Store untuk Chromebook.
2. Masuk dengan akun yang sama dengan tailnet rig, lalu **Connect** (status **Connected**).
3. Pastikan rig menyala dan `ngobrol.service` jalan. (Detail: `deploy/HIVEOS.md`, `deploy/CHROMEBOOK.md`.)

---

## 1) Tarik model Qwen3-30B-A3B abliterated di rig

Model MoE ini hanya **3B parameter aktif** per token, jadi **lebih cepat di CPU** daripada
model dense 14B — sekaligus lebih pintar. Jalankan **sekali** di Hive Shell rig:

```bash
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh | sudo bash
```

Unduhan jalan sebagai layanan (`hvm-pull`) — **Hive Shell boleh ditutup**. Cek progres:
`cek-model` (ringkas) atau `progress-model` (live). Selesai bila model muncul di `ollama list`.

### Pilih quant sesuai RAM 16 GB

| Tag model (pakai `MODEL=…`) | Ukuran | RAM 16 GB? |
|---|---|---|
| `huihui_ai/qwen3-coder-abliterated:30b-a3b-instruct-q3_K_M` | ±15 GB | ✅ **BAWAAN** — paling seimbang (coding) |
| `huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_K_M` | ±19 GB | ⚠️ perlu NVMe (mmap dari disk) — kualitas top |
| `huihui_ai/qwen3-abliterated:30b-a3b-thinking-2507-q3_K_M` | ±15 GB | ✅ varian "berpikir" (nalar lebih dalam, agak lebih lambat) |
| *(lebih ringan)* `…-q2_K` bila tersedia | ±11 GB | ✅ muat penuh RAM, paling mulus, kualitas lebih rendah |

Contoh memilih varian lain:

```bash
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh \
  | MODEL=huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_K_M sudo bash
```

> **Catatan:** `q4_K_M` (±19 GB) melewati 16 GB RAM, jadi sebagian bobot dibaca dari **SSD**
> (mmap). Lancar bila rig pakai **NVMe**; di HDD akan tersendat. Untuk aman & gesit, pakai
> `q3_K_M` (bawaan). Model embedding RAG (`nomic-embed-text`) sudah terpasang sebelumnya.

---

## 2) Pakai dari laptop (lewat browser)

1. Buka **https://hvm-ai.taile6dcd6.ts.net** di **Chrome / Edge** (atau Safari/Firefox).
2. Masukkan **kata sandi** HvM AI (salin–tempel agar tidak salah ketik).
3. Isi **nama** saat diminta.
4. Di pojok atas, pilih model **`huihui_ai/qwen3-coder-abliterated:30b-a3b-instruct-q3_K_M`**
   (atau varian yang kamu tarik) dari dropdown model.
5. Mulai ngobrol. Tombol **💻 Coding** dan **💭 Berpikir** bisa diaktifkan sesuai kebutuhan;
   lihat **indikator konteks** di atas kolom ketik — jika mendekati penuh, buka **Obrolan baru**.

Di header juga ada **status rig** (🌡️ suhu CPU · 🧠 RAM bebas · ⚙️ beban CPU · 🟢 model termuat)
supaya kamu tahu kondisi rig saat model berpikir.

---

## 3) Add to Home — pasang sebagai aplikasi di laptop

Supaya HvM AI punya **ikon + nama sendiri** dan terbuka seperti aplikasi (bukan tab browser):

### Chrome / Edge (Windows, Mac, Linux, Chromebook) — disarankan
1. Buka **https://hvm-ai.taile6dcd6.ts.net** dan login.
2. Di **kanan kolom alamat**, klik ikon **install** (monitor dengan panah ↓) —
   atau menu **⋮** → **Cast, save, and share** → **Install HvM AI…**
   (di Edge: menu **⋯** → **Apps** → **Install this site as an app**).
3. Klik **Install**. Ikon **HvM AI** muncul di Desktop/Start Menu (Windows),
   Launchpad/Applications (Mac), atau laci aplikasi (Chromebook/Linux).
4. Buka dari ikon itu → terbuka sebagai jendela app tersendiri, logo & nama HvM AI tampil.

> Kalau ikon install tak muncul: pastikan sudah **login** dan halaman termuat penuh,
> lalu refresh sekali. PWA hanya aktif di alamat **https** (alamat `ts.net` sudah https).

### Firefox
Firefox desktop tidak punya "Install app". Alternatif: **Bookmark** halaman, atau
**Pin Tab** (klik kanan tab → Pin Tab) agar selalu siap. Untuk pengalaman seperti app,
pakai Chrome/Edge.

### Mac — Safari
Safari di macOS: menu **File → Add to Dock** (Sonoma ke atas) untuk memasang sebagai app.

---

## 4) Kalau ada masalah

| Masalah | Solusi |
|---|---|
| Alamat tidak terbuka | Pastikan Tailscale **Connected**; rig menyala; `sudo systemctl status ngobrol`. |
| Model tak ada di dropdown | Tunggu `cek-model` menampilkan model selesai, lalu refresh HvM AI. |
| Jawaban lambat/tersendat (q4_K_M) | Model > 16 GB sedang mmap dari disk. Pakai `q3_K_M`, atau pastikan GGUF di NVMe. |
| Rig panas / RAM penuh (lihat header) | Turunkan ke quant lebih kecil; biarkan `Nice=15` + `MemoryMax` seperti bawaan. |

---

Semua berjalan di rig-mu, lewat Tailscale (privat). GPU tetap 100% untuk mining —
model LLM berjalan **CPU-only**.
