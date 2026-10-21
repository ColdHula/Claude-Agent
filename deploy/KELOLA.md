# Kelola & Update HvM AI — biar Local AI-mu selalu terbaru & lancar

Panduan operasional harian: cara update, cek kesehatan, ganti model/mesin, perawatan,
dan troubleshooting. Semua jalan di rig (CPU-only, GPU tetap untuk mining).

---

## 1) Update ke versi terbaru

```bash
cd /home/user/kantor-pga \
  && sudo -u user git fetch origin \
  && sudo -u user git reset --hard origin/claude/bold-feynman-27cfgv \
  && sudo systemctl restart ngobrol
```

- `reset --hard` memastikan rig **benar-benar sama** dengan GitHub (menghindari *"Already up to date"*
  palsu akibat perubahan lokal yang menyangkut).
- Restart `ngobrol` agar kode baru aktif.
- Kalau update menyentuh **config Ollama** (mis. keep-alive), jalankan ulang:
  `curl -fsSL …/deploy/pasang-ollama.sh | sudo bash`
- **Auto-update:** ada timer `perbarui` yang menarik update berkala + restart ngobrol.
  Cek: `systemctl status perbarui.timer`.

> Setelah update yang mengubah **Modelfile.hvm** (mis. ganti basis model), **rebuild persona**:
> `curl -fsSL …/deploy/buat-model-pribadi.sh | sudo bash`

---

## 2) Cek kesehatan

```bash
systemctl status ollama ngobrol ik-llama --no-pager   # status layanan
cek-model      # model Ollama siap? (status unduhan + daftar)
cek-ik         # ik_llama siap? (status build + /health)
free -h        # RAM & SWAP (Swap "used" tinggi = model kebesaran!)
df -h          # ruang disk
```

Dari aplikasi: **header HvM AI** menampilkan status rig (🌡️ suhu · 🧠 RAM bebas · ⚙️ beban ·
🟢 model termuat) + **indikator konteks** di atas kolom ketik.

---

## 3) Ganti / tambah model  (ingat aturan HDD: **harus muat penuh di RAM**)

```bash
# Tarik model (bawaan Q2_K ±11 GB, uncensored). Ganti varian dengan MODEL=...
curl -fsSL …/deploy/tarik-model.sh | sudo bash
# Rebuild persona 'hvm' (khusus mesin Ollama)
curl -fsSL …/deploy/buat-model-pribadi.sh | sudo bash
# Hapus model lama (hemat disk)
OLLAMA_HOST=127.0.0.1:11434 ollama rm <nama-model>
```

Pilih model di dropdown HvM AI setelah unduhan selesai.

---

## 4) Pilih mesin: **Ollama** (mudah) ⇄ **ik_llama** (kencang)

```bash
# Pakai ik_llama (kencang di CPU): build + alih-kan otomatis
curl -fsSL …/deploy/pasang-ik-llama.sh | sudo bash

# Balik ke Ollama
sudo rm -f /etc/systemd/system/ngobrol.service.d/backend.conf
sudo systemctl daemon-reload && sudo systemctl restart ngobrol
sudo systemctl disable --now ik-llama
```

Persona **HvM** aktif di kedua mesin: di Ollama lewat model `hvm`; di ik_llama **disuntik
otomatis** dari `Modelfile.hvm` (tombol 💻 Coding / 💭 Berpikir tetap jalan).

---

## 5) Perawatan biar tetap lancar

- **RAM:** setelah model dimuat, **RAM bebas rendah itu NORMAL** (model memang di RAM). Yang
  bahaya: **Swap "used" naik** (`free -h`) → model kebesaran, **turunkan quant** atau pasang SSD.
- **Disk (HDD):** model Ollama di `/usr/share/ollama/.ollama/models`; GGUF ik_llama di
  `/home/user/models`. Hapus yang tak terpakai bila penuh.
- **CPU/miner:** biarkan `Nice=15` & **6 thread**; jangan naikkan thread > 6 (ganggu sistem).
- **Log:** `journalctl -u ngobrol -n 50` · `-u ollama` · `-u ik-llama` · build ik di
  `/home/user/ik-build.log`.
- **Keamanan:** jangan commit kata sandi / kunci pemilik; bagikan hanya **app password** ke teman.

---

## 6) Troubleshooting cepat

| Gejala | Tindakan |
|---|---|
| "Tidak bisa menghubungi mesin LLM" | `sudo systemctl restart ollama` (atau `ik-llama`); pastikan model **muat di RAM** |
| Ollama tumbang / RAM penuh | Model kebesaran untuk HDD+16 GB → pakai quant lebih kecil (Q2_K ±11 GB) |
| Model tak muncul di dropdown | Tunggu unduhan selesai (`cek-model`/`cek-ik`), lalu refresh HvM AI |
| Jawaban lambat/tersendat | Model > RAM (paging HDD). Turunkan quant **atau pasang SSD** (dampak terbesar) |
| ik_llama gagal start | Jalankan ulang dengan `IK_FLAGS="-c 4096 -t 6 -fa"` (buang `-rtr -fmoe`); cek `ik-build.log` |
| Update tak terasa | `git reset --hard origin/claude/bold-feynman-27cfgv` lalu `systemctl restart ngobrol` |

---

## 7) Backup (opsional)
Chat & dokumen ada di `ngobrol/data/` (tidak ikut Git). Salin folder itu bila ingin cadangan.

---

## Perintah harian (ringkas)

| Mau… | Perintah |
|---|---|
| Update | `cd /home/user/kantor-pga && sudo -u user git reset --hard origin/claude/bold-feynman-27cfgv && sudo systemctl restart ngobrol` |
| Cek layanan | `systemctl status ollama ngobrol ik-llama --no-pager` |
| Cek model | `cek-model` / `cek-ik` |
| Daftar model | `OLLAMA_HOST=127.0.0.1:11434 ollama list` |
| Restart | `sudo systemctl restart ngobrol` |

Dokumen terkait: **OPTIMASI.md** (kinerja CPU/HDD + ik_llama), **LAPTOP.md** (pakai dari laptop
+ add-to-home), **HIVEOS.md** (pemasangan awal).
