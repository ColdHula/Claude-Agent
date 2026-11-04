---
name: moneyprinterturbo
description: Membuat video pendek otomatis (Reels/TikTok/Shorts 9:16, YouTube 16:9, 1:1) dengan MoneyPrinterTurbo - naskah LLM, footage stok, suara TTS, subtitle, musik. Pakai saat tugas meminta video pendek, konten media sosial, video sosialisasi/K3, atau ide konten sampingan; juga untuk menyiapkan instalasi, config.toml, dan perintah CLI/API-nya.
---

# MoneyPrinterTurbo — video pendek otomatis

Proyek open-source (MIT) `harry0703/MoneyPrinterTurbo` (versi terakhir yang dicek: v1.3.9, Okt 2026).
Dari satu topik: LLM menulis naskah → cari footage (Pexels/Pixabay/dll.) → suara TTS → subtitle → musik → MP4.
Agent **tidak menjalankan** aplikasinya di sini; agent menyiapkan naskah, config, dan perintah untuk Rahula jalankan di laptopnya.

## 1. Pahami brief dulu
Tanyakan/isi: topik, tujuan (sosialisasi internal, K3, promosi usaha sampingan), penonton, rasio
(9:16 = 1080x1920, 16:9 = 1920x1080, 1:1 = 1080x1080), durasi (±30–60 detik), bahasa & suara, perlu subtitle atau tidak.

## 2. Naskah (kerjakan sendiri, lebih terkontrol daripada naskah otomatis)
- 80–150 kata untuk ±45 detik; kalimat pendek; 1 pesan utama; ajakan di akhir.
- Bahasa Indonesia baku santai. Jangan sebut data rahasia, nama karyawan, nomor izin, atau angka internal Mayora.
- Buat juga 5–8 **kata kunci footage dalam bahasa Inggris** (Pexels/Pixabay mencari dalam Inggris), mis. `warehouse safety`, `forklift`, `office teamwork`.
- Video atas nama perusahaan/K3: tandai **perlu persetujuan atasan/Corporate Communication** sebelum diunggah.

## 3. Instalasi (pilih satu)
| Cara | Perintah |
|---|---|
| pip (paling mudah, Python 3.11+) | `python3 -m venv .venv` → `source .venv/bin/activate` (Windows: `.venv\Scripts\Activate.ps1`) → `python -m pip install mpt` → `mpt webui` |
| Docker | `git clone https://github.com/harry0703/MoneyPrinterTurbo.git` → `cd MoneyPrinterTurbo` → salin `config.example.toml` ke `config.toml` → `docker compose -f docker-compose.release.yml up` → WebUI http://127.0.0.1:8501, API http://127.0.0.1:8080/docs |
| Windows sekali klik | unduh paket `.7z` di Releases → `update.bat` → `start.bat` (folder tanpa spasi/karakter khusus) |
| Dari sumber (uv) | `uv python install 3.11` → `uv sync --frozen` → WebUI `sh webui.sh` / `.\webui.bat`, API `uv run python main.py` |

Paket PyPI resmi bernama `mpt`; paket `MoneyPrinterTurbo` di PyPI **bukan** resmi. Spesifikasi minimum: 4 core, RAM 4 GB, GPU opsional.

## 4. config.toml — yang wajib diisi
```toml
llm_provider = "[ISI: openai/anthropic/gemini/deepseek/ollama/...]"
# kunci sesuai provider, mis. openai_api_key / anthropic_api_key + _model_name
video_source = "pexels"          # atau "pixabay", "local" (footage sendiri)
pexels_api_keys = ["[ISI: kunci dari pexels.com/api]"]
subtitle_provider = "edge"       # cepat, tanpa GPU; "whisper" lebih akurat tapi berat
# api_key = "[ISI]"              # bila API dibuka di jaringan: klien kirim header x-api-key
```
- TTS bawaan Edge TTS gratis tanpa kunci; suara Indonesia: `id-ID-ArdiNeural` (pria) / `id-ID-GadisNeural` (wanita).
- Error `No ffmpeg exe could be found`: unduh FFmpeg (gyan.dev) lalu isi `ffmpeg_path` atau env `IMAGEIO_FFMPEG_EXE`.
- Kunci API **jangan** ditulis di hasil/skill/Git; pakai `[ISI: ...]`.
- Sumber video berbayar (wavespeed, seedance, dll.) minta konfirmasi per pembuatan — sebutkan perkiraan biaya bila dipakai.

## 5. Cara menjalankan
- **WebUI**: tempel naskah sendiri di kolom naskah (jangan biarkan kosong bila naskah sudah dibuat), isi kata kunci, pilih rasio, suara, subtitle, musik → Generate.
- **CLI**: `uv run python cli.py --video-subject "[topik]"` (opsi lengkap: `--help`); batch: `--batch-file ./tasks.json` (maks. 100 tugas).
- **API**: buka `http://127.0.0.1:8080/docs` untuk daftar endpoint & field terbaru — jangan menebak nama field.
- Hasil: `storage/tasks/<task_id>/` (instal pip: folder data, Linux `~/.local/share/MoneyPrinterTurbo`, bisa diubah lewat `MPT_HOME`).
- Unggah otomatis ke TikTok/Instagram/YouTube (Upload-Post) biarkan **mati** (`upload_post_enabled = false`); unggah manual setelah ditinjau.

## 6. Format keluaran
1. **Brief**: topik, tujuan, rasio, durasi, suara.
2. **Naskah final** + perkiraan durasi.
3. **Kata kunci footage** (Inggris).
4. **Potongan config.toml** dengan `[ISI: ...]`.
5. **Langkah jalan** (WebUI atau perintah CLI siap salin).
6. **Cek sebelum unggah**: ejaan subtitle, footage tidak menampilkan merek pesaing/hal tidak pantas, musik bebas hak cipta, persetujuan bila atas nama perusahaan.
7. Untuk ide cuan (konten sampingan): serahkan hitungan biaya & potensi ke agent `cari-cuan`; jangan menjanjikan penghasilan.
