# Optimasi HvM AI — CPU i5-10400F + RAM 16 GB + HDD (tanpa GPU)

Target: HvM AI berjalan **mulus & stabil** di rig CPU-only (GPU tetap 100% untuk mining).
Dokumen ini menjelaskan kenapa sebelumnya Ollama tumbang, apa yang sudah dioptimasi, dan
teknik lanjutan yang sedang populer (riset 2026).

---

## ⛔ Aturan emas di HDD: model HARUS muat penuh di RAM

Kemarin Ollama mati dengan pesan *"Tidak bisa menghubungi Ollama"* karena model **q3_K_M
±15 GB** lebih besar dari RAM 16 GB. Akibatnya bobot model dibaca bolak-balik dari **HDD**
(paging/thrashing) — di HDD ini sangat lambat (ratusan kali lebih lambat dari RAM), sistem
kehabisan napas, lalu proses Ollama tumbang. (Di layar terlihat **CPU cuma 85% tapi RAM bebas
1.3 GB** → bottleneck-nya **memori/disk**, bukan CPU.)

**Hukum untuk HDD + 16 GB:** ukuran file model + KV cache + sistem + miner ≤ 16 GB.
Sisakan ±4–5 GB untuk OS + miner + KV. Jadi **file model ≤ ~11 GB**.

> Catatan: setelah model dimuat, **RAM bebas yang rendah itu NORMAL dan bagus** — artinya
> model memang berada di RAM (bukan di-paging dari HDD). Yang berbahaya adalah **swap aktif**
> atau lampu HDD menyala terus saat menjawab.

---

## ✅ Model yang dipilih (muat penuh di RAM 16 GB)

| Model (uncensored) | Ukuran | Cocok HDD? | Catatan |
|---|---|---|---|
| `huihui_ai/qwen2.5-coder-abliterate:14b` (dense) | ±9 GB | ✅ **paling andal** | Headroom lega, stabil; lebih lambat (~3–5 t/s) |
| ⭐ `…Qwen3-Coder-30B-A3B…abliterated-GGUF:Q2_K` (MoE) | ±11 GB | ✅ **bawaan** | 3B aktif → gesit (~8–12 t/s), lebih pintar; headroom tipis |
| `…:IQ3_XXS` (bila tersedia) | ±12 GB | ⚠️ pas-pasan | Sedikit lebih bagus dari Q2_K |
| `…q3_K_M` / `…q4_K_M` | ±15–19 GB | ❌ **jangan di HDD** | Hanya aman bila ada SSD/NVMe (lihat §Lanjutan) |

Menariknya di HDD: **14B dense (9 GB)** sering terasa lebih mulus daripada 30B yang dipaksa
Q2 — karena headroom RAM lebih lega. Coba keduanya, pilih yang paling enak.

---

## ⚙️ Yang sudah dioptimasi (ada di repo, tinggal update rig)

- **`num_ctx` 4096** (dari 256K iklan Qwen3) → KV cache kecil, token pertama cepat, hemat RAM.
- **`OLLAMA_KEEP_ALIVE=-1`** → model **tetap residen** di RAM. Di HDD, cold-load makan menit;
  dengan ini kamu bayar **sekali saja**, sesudahnya instan.
- **Flash attention** + **KV cache q8_0** → hemat memori KV.
- **6 thread** (= core fisik) + **NUM_PARALLEL=1** + **Nice=15** → CPU cukup, **miner tak terganggu**.
- **`CUDA_VISIBLE_DEVICES=` kosong** → Ollama **tidak menyentuh GPU** sama sekali.
- Persona **`hvm`** memakai basis Q2_K yang muat.

### Cara menerapkan di rig

```bash
# 1) Pulihkan Ollama yang tumbang
sudo systemctl restart ollama

# 2) Ambil update repo + restart HvM AI (num_ctx 4096, dll)
cd /home/user/kantor-pga && sudo -u user git pull origin claude/bold-feynman-27cfgv && sudo systemctl restart ngobrol

# 3) Terapkan config Ollama baru (KEEP_ALIVE=-1 dll) + tarik model yang MUAT
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama.sh | sudo bash
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh | sudo bash   # Q2_K ±11 GB

# 4) (opsional) bangun persona hvm di atas model itu
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/buat-model-pribadi.sh | sudo bash
```

Lalu di HvM AI pilih model **hvm** (atau model Q2_K) di dropdown.

---

## 🚀 Optimasi lanjutan (riset 2026, dipakai banyak orang)

1. **#1 paling berdampak — SSD/NVMe murah.** HDD adalah batu sandungan utama di sini.
   Inferensi CPU dibatasi **bandwidth memori**; HDD memperburuk tiap cold-load & paging.
   SATA SSD 240 GB (±Rp150–300 rb) mengubah segalanya: cold-load jadi detik, dan model
   **q4_K_M (±19 GB) pun bisa jalan via mmap** (hanya bobot aktif yang dibaca). Ini lompatan
   terbesar yang bisa kamu lakukan tanpa menyentuh GPU.
2. **RAM dual-channel 2666 MHz.** Pastikan **2 keping** RAM (bukan 1) → bandwidth ~2×.
   i5-10400F mentok di DDR4-2666; aktifkan profil XMP/rated di BIOS bila ada.
3. **KV cache lebih kecil (`q4_0`).** Bila RAM masih sesak, ganti `OLLAMA_KV_CACHE_TYPE=q4_0`
   (dari `q8_0`) → KV separuh, sedikit turun akurasi.
4. **ik_llama.cpp** — fork llama.cpp khusus CPU: prompt-processing **~2–5× lebih cepat** untuk
   MoE di AVX2 (persis i5-10400F), plus quant SOTA `IQ_K`/row-interleaved `_R4`.
   **Sudah disiapkan** (lihat §ik_llama di bawah).
5. **Unsloth Dynamic (UD) quant** — kualitas lebih baik per-GB (mis. `UD-Q3_K_XL`), bisa
   ditarik via `ollama pull hf.co/unsloth/…`. Cocok untuk memuat kualitas lebih tinggi
   dalam batas RAM yang sama.
6. **Speculative decoding (draft model)** — klaim 2–2.6× lebih cepat, **tapi** butuh RAM
   ekstra untuk model draft → kurang cocok di 16 GB yang sudah sesak.
7. **BitNet 1.58-bit** — tren baru untuk CPU (bobot ternary, sangat hemat), tapi pilihan
   model masih terbatas; pantau saja.

> **GPU tidak disentuh** di semua langkah ini (`CUDA_VISIBLE_DEVICES` kosong + miner tetap jalan).

---

## 📉 Ekspektasi jujur (HDD)

- **Pesan pertama = memuat model dari HDD** (beberapa menit untuk ±11 GB). Dengan
  `KEEP_ALIVE=-1`, ini hanya sekali selama layanan hidup.
- Setelah residen: **~8–12 t/s** (MoE Q2) atau **~3–5 t/s** (14B dense). Tugas besar
  (mis. "buat website scraper lengkap") tetap makan beberapa menit — **pecah jadi bertahap**.
- **Fitur Dokumen (RAG) di HDD rawan:** memuat model embedding bisa **menggusur** model utama
  (`MAX_LOADED_MODELS=1`) → reload lambat dari HDD. Di HDD, hindari RAG berat — atau pasang SSD.
- Tugas yang sedang berjalan **tetap lanjut di latar** walau tab/laptop ditutup (fitur
  background), hasil tersimpan saat selesai.

---

## 🔧 ik_llama.cpp — mesin chat tercepat di CPU (opsional)

HvM AI bisa memakai **ik_llama.cpp** (bukan Ollama) sebagai mesin chat. Server-nya
(`llama-server`) memakai API **OpenAI-compatible**; HvM AI sudah punya **adapter** yang
menormalkan keduanya, jadi UI tetap sama. Dengan `-rtr`, model **dimuat penuh ke RAM** saat
service start (cold-load HDD cuma sekali), lalu dieksekusi dengan kernel CPU ik_llama yang
lebih cepat — cocok untuk HDD.

**Pasang** (build + unduh model + alih-kan HvM AI berjalan sebagai layanan, Hive Shell boleh ditutup):
```bash
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ik-llama.sh | sudo bash
```
Pantau: `cek-ik` (status + health) atau `progress-ik` (log live). Build makan **15–30 menit**
di HDD + unduh GGUF **±12.7 GB** (IQ3_XS). Selesai → HvM AI otomatis memakai ik_llama (port 11435).

**"Kencang maksimal tapi tetap bagus":** bawaan quant **IQ3_XS ±12.7 GB** (imatrix) — kualitas
jauh di atas Q2_K, dan **muat penuh di RAM** karena `--no-mmap` memaksa seluruh bobot residen
(tak ada paging dari HDD saat menjawab). Alternatif: `IQ3_XXS` (±11.9 GB, lebih aman) atau
`IQ3_M` (±13.6 GB, paling bagus tapi mepet) lewat `MODEL_URL=`.

**Cara kerja (RAM aman di 16 GB):** ik_llama memegang model chat (±12.7 GB, residen via `--no-mmap`).
Ollama tetap hidup **hanya untuk embedding RAG** (nomic, ±0.3 GB); model chat besar dilepas dari
Ollama saat beralih.

**Flag kinerja** (di unit, ubah lewat `IK_FLAGS=`): `-fa` flash-attn · `-fmoe` fused-MoE (kencang
untuk MoE) · `-ub 2048` batch prompt · `--no-mmap` residen penuh di RAM. Kalau service gagal start,
sederhanakan: `IK_FLAGS="-c 4096 -t 6 -fa --no-mmap"`.

> **Persona HvM otomatis aktif** di ik_llama: HvM AI menyuntik SYSTEM dari `Modelfile.hvm`
> (karena GGUF mentah tak punya persona bawaan). Tombol 💻 Coding / 💭 Berpikir tetap jalan.

**Kembali ke Ollama** kapan saja:
```bash
sudo rm /etc/systemd/system/ngobrol.service.d/backend.conf
sudo systemctl daemon-reload && sudo systemctl restart ngobrol
sudo systemctl disable --now ik-llama
```

> Switch engine di HvM AI diatur 2 env pada layanan `ngobrol`: `HVM_BACKEND=openai` +
> `LLM_URL=http://127.0.0.1:11435` (untuk ik_llama), atau kosong/`ollama` untuk Ollama.

## Sumber riset
- [CPU-only LLM inference 2026 — bandwidth, model, engine](https://insiderllm.com/guides/cpu-only-llms-what-actually-works/)
- [Local LLM inference optimization (ik_llama.cpp, XMP, MTP)](https://carteakey.dev/blog/local-inference/local-llm-optimization/)
- [ik_llama.cpp — fork CPU/MoE + quant IQ_K](https://github.com/ikawrakow/ik_llama.cpp)
- [Unsloth: Qwen3-Coder run locally (kebutuhan RAM & UD quant)](https://unsloth.ai/docs/models/tutorials/qwen3-coder-how-to-run-locally)
- [Guide MoE offloading llama.cpp (flash-attn, batch tuning)](https://gist.github.com/DocShotgun/a02a4c0c0a57e43ff4f038b46ca66ae0)
