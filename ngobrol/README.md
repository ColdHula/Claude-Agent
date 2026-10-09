# HvM AI — antarmuka chat model lokal (RAG + persona)

Chatbot untuk model lokal (Ollama) di rig: chat, coding, Excel, dan baca dokumen Anda (RAG). Terpisah dari Kantor PGA.

- **Pengalaman seperti chatbot biasa**: ketik, jawaban mengalir, blok kode rapi.
- **Riwayat tersimpan**: tiap percakapan disimpan di `ngobrol/data/chats/` (JSON) dan muncul di sisi kiri.
- **Lampiran file**: seret & lepas atau tombol 📎. File teks/kode dibaca isinya; semua file disimpan di `ngobrol/data/berkas/`.
- **Aman**: berpassword (sama dengan Kantor PGA), browser tidak pernah mengakses Ollama langsung — server ini yang meneruskan. Dibuka hanya lewat Tailscale.
- **Privat**: tidak ada data yang keluar dari rig.

## Jalankan sendiri (lokal)
```
OLLAMA_URL=http://127.0.0.1:11434 NGOBROL_PASSWORD=rahasia node ngobrol/server.js
```
Buka http://127.0.0.1:3001

## Pasang di rig (layanan)
Lihat `deploy/pasang-ngobrol.sh` dan bagian "Ngobrol" di `deploy/HIVEOS.md`.

## Pengaturan (env)
| Variabel | Bawaan | Arti |
|---|---|---|
| `PORT` | 3001 | Port server |
| `HOST` | 127.0.0.1 | Alamat bind (biarkan lokal; akses via Tailscale serve) |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Alamat Ollama |
| `NGOBROL_PASSWORD` | (APP_PASSWORD) | Kata sandi; kosong = hanya aman di 127.0.0.1 |

`ngobrol/data/` tidak ikut Git.

## RAG (baca dokumen Anda)
Klik **📚 Dokumen** di aplikasi, unggah file teks/kode. Potongan relevan otomatis disisipkan saat menjawab (ditandai `[n]`). Butuh `ollama pull nomic-embed-text`. Index di `ngobrol/data/rag-index.json`.

## Model pribadi
Lihat `model-pribadi/Modelfile.hvm` dan `deploy/buat-model-pribadi.sh` (model `hvm`).
