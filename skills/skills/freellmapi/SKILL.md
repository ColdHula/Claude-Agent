---
name: freellmapi
description: Memakai LLM gratis lewat satu endpoint - FreeLLMAPI (gabungan 34 penyedia gratis), alternatifnya (Ollama lokal, LiteLLM, daftar awesome-free-llm-apis), dan pagar data kantornya. Pakai saat tugas menyebut "API gratis", "LLM gratis", "hemat biaya model", "base_url OpenAI-compatible", atau saat menyetel MoneyPrinterTurbo/alat lain agar tidak memakai API berbayar.
---

# LLM gratis lewat satu endpoint (FreeLLMAPI dan sejenisnya)

## 1. Pilih alat yang tepat
| Alat | Isi | Kapan dipakai | Data keluar mesin? |
|---|---|---|---|
| **Ollama** (`ollama/ollama`, ±186 rb ⭐) | Model jalan di laptop sendiri | **Satu-satunya pilihan untuk data kantor/rahasia** | Tidak |
| **FreeLLMAPI** (`tashfeenahmed/freellmapi`, ±47 rb ⭐, MIT) | Router: free tier 34 penyedia (Gemini, Groq, Cerebras, Mistral, OpenRouter, NVIDIA, …) di balik satu `/v1` | Eksperimen, konten publik, ide, draf tanpa data pribadi | **Ya**, ke penyedia gratis |
| **LiteLLM** (`BerriAI/litellm`, ±63 rb ⭐) | Gateway ke banyak penyedia (berbayar atau gratis) | Bila butuh satu gateway resmi untuk kunci berbayar | Ya |
| **awesome-free-llm-apis** (`mnfst/awesome-free-llm-apis`) | Daftar free tier dan batasnya | Cek kuota/syarat terbaru | n/a |

**Jangan pakai** alat "reverse engineering" atau "crack" yang memakai akun ChatGPT/Claude tanpa API resmi (mis. `free-one-api`, gpt4free). Itu melanggar ToS dan berisiko akun diblokir.

## 2. Pagar data (wajib, sebelum apa pun)
- Free tier penyedia sering boleh memakai prompt untuk melatih/memperbaiki model, dan tidak ada SLA. Anggap semua yang dikirim **bisa dibaca pihak lain**.
- **Dilarang** mengirim lewat FreeLLMAPI: data karyawan (nama+NIK, gaji, BPJS), isi kasus/PHI, dokumen izin MMEA, kontrak, angka internal Mayora, kata sandi.
- Matikan/hapus penyedia yang modelnya dijalankan sukarelawan (mis. **AI Horde**). Prompt bisa terbaca operator node.
- Untuk dokumen kantor: pakai Claude (paket Rahula) atau Ollama lokal.
- Kunci API penyedia dan kunci gabungan `freellmapi-…` **tidak boleh** masuk Git, `hasil/`, atau skill; pakai `[ISI: ...]`.
- Proyek ini sendiri menyatakan "personal experimentation, not production". Hormati ToS: satu akun per penyedia, jangan dijual atau dibagi ke orang lain. Cohere melarang pemakaian pribadi; Gemini, NVIDIA, dan Z.ai berstatus "hati-hati" (ulasan ToS proyek, Mei 2026).

## 3. Memasang FreeLLMAPI (dijalankan Rahula, bukan agent)
- **Windows/macOS (paling mudah):** unduh installer `.exe`/`.dmg` di Releases GitHub → jalankan → ikon tray → *Open Dashboard*.
- **Docker:** README menawarkan `curl -fsSL https://freellmapi.co/install.sh | bash`. **Baca dulu skripnya** (buka tautannya di browser), atau pakai `docker compose` dari repo (lihat `docs/en/install/01-install.md`).
- Buka `http://localhost:3001` → halaman **Keys**: tempel kunci free tier tiap penyedia → atur **Fallback Chain** → salin kunci gabungan.
- Katalog model diperbarui otomatis dari freellmapi.co (feed bertanda tangan). Paket berbayar ($19/thn) **tidak diperlukan**.
- Copot: hapus aplikasi/`docker compose down -v`, lalu hapus folder data (`%APPDATA%\FreeLLMAPI\`, `~/Library/Application Support/FreeLLMAPI/`, `~/.config/FreeLLMAPI/`).

## 4. Menyambungkan ke alat lain
Semua klien OpenAI-compatible: `base_url = http://localhost:3001/v1`, `api_key = [ISI: kunci freellmapi-…]`, model `auto`.
- **MoneyPrinterTurbo** (`config.toml`): `llm_provider = "openai"`, `openai_base_url = "http://localhost:3001/v1"`, `openai_api_key = "[ISI]"`, `openai_model_name = "auto"`. Cocok karena naskah video bersifat publik.
- **Claude Code:** `npx freellmapi setup-claude --url http://localhost:3001 --api-key [ISI]`. **Jangan** di repo Kantor PGA: sesi di sini menangani data kantor. Pakai hanya di folder eksperimen terpisah.
- Aplikasi web Kantor PGA (`server.js`) **tidak** disambungkan ke FreeLLMAPI.

## 5. Format keluaran
1. Alat yang dipilih + alasan (lihat tabel 1). 2. Klasifikasi data tugas: publik / internal / rahasia → rahasia = tolak FreeLLMAPI.
3. Langkah pasang + potongan konfigurasi dengan `[ISI: ...]`. 4. Batasan: kualitas di bawah model frontier, latensi naik-turun, kuota harian reset 00.00 UTC.
5. Risiko & yang belum pasti (ToS penyedia bisa berubah; cek ulang di freellmapi.co/models).
