---
name: claude-mem
description: Memakai plugin claude-mem (memori persisten antar sesi Claude Code) - cara memasang, mencari riwayat kerja lewat alat search/timeline/get_observations, dan pagar privasi untuk data kantor. Pakai saat tugas menyebut "ingat sesi lalu", "apa yang sudah dikerjakan kemarin", atau saat Rahula ingin memasang/mengatur claude-mem.
---

# claude-mem — memori antar sesi Claude Code

Plugin open-source (Apache-2.0) `thedotmack/claude-mem` (versi di README: 15.9.0, dicek Nov 2026).
Ia merekam aktivitas alat di sesi Claude Code lewat hook (SessionStart, UserPromptSubmit, PreToolUse,
PostToolUse, Stop, SessionEnd), meringkasnya, menyimpannya di SQLite + Chroma (lokal, `~/.claude-mem/`),
lalu menyuntikkan konteks relevan di awal sesi berikutnya.

**Beda dengan `memori-kantor`:** memori kantor = fakta tetap yang sudah dipastikan (nomor surat, keputusan) dan
tetap jadi sumber utama. claude-mem = riwayat kerja otomatis (apa yang dibuka/diubah/diputuskan di sesi lalu).
Bila keduanya bertentangan, ikuti memori kantor dan tugas saat ini, lalu sebutkan perbedaannya.

## 1. Memasang (dijalankan Rahula di laptop, bukan oleh agent)
Syarat: Node.js ≥ 20, Claude Code dengan dukungan plugin (Bun dan uv dipasang otomatis bila belum ada).

Di dalam Claude Code:
```
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```
lalu mulai ulang Claude Code. Alternatif: `npx claude-mem install` (pemasang interaktif).
**Jangan** `npm install -g claude-mem`: itu hanya memasang library, hook tidak terdaftar.
Windows bila muncul `Executable not found in $PATH: "claude-mem"`: jalankan `npx claude-mem doctor`.

## 2. Pagar privasi untuk data Mayora (wajib)
- Saat pemasang menawarkan penyedia ringkasan, pilih **paket Anthropic milik Rahula**; jangan memakai kunci
  pihak ketiga (OpenRouter/Gemini) untuk data kantor.
- **Cloud Sync (cmem.ai) dan screenshot: biarkan mati.** Untuk melewati pendaftaran online:
  `CLAUDE_MEM_ONLINE_OPTIN=false` (env saat instal, atau di `~/.claude-mem/settings.json`).
- Bungkus data sensitif dengan tag `<private> ... </private>` (NIK, gaji, isi kasus, kata sandi, nomor rekening)
  agar tidak disimpan.
- Jangan pernah menyalin isi `~/.claude-mem/` ke `hasil/`, Git, atau lampiran email.
- Aplikasi web Kantor PGA (`server.js`) **tidak** memakai claude-mem; plugin ini hanya untuk sesi Claude Code langsung.

## 3. Mencari riwayat (bila alat MCP claude-mem tersedia di sesi)
Hemat token, tiga langkah (skill bawaan plugin: `mem-search`):
1. `search(query="...", type=..., limit=10)` → daftar ringkas + ID. Filter tipe/tanggal/proyek bila bisa.
2. `timeline(...)` → konteks kronologis di sekitar temuan yang relevan.
3. `get_observations(ids=[...])` → detail lengkap **hanya** untuk ID yang benar-benar dibutuhkan.

Kutip temuan sebagai `(claude-mem #ID, tanggal)`. Riwayat bukan dokumen resmi: nomor surat, nominal, dan
tanggal tetap dicek ke dokumen/memori kantor sebelum dipakai di surat.
Bila alat tidak tersedia, katakan saja dan lanjut tanpa riwayat; jangan menebak isi sesi lalu.

## 4. Pengaturan & masalah
- File: `~/.claude-mem/settings.json` (dibuat otomatis). Contoh kunci: `CLAUDE_MEM_MODE` (mis. `"code"`),
  `CLAUDE_MEM_ONLINE_OPTIN`. Mulai ulang Claude Code setelah mengubah.
- Penampil web: alamat worker dicetak saat mulai; memori/sesi/pengaturan di `/viewer`.
- Menonaktifkan/mencopot: lewat `/plugin` di Claude Code; detail di docs.claude-mem.ai (troubleshooting).

## 5. Format keluaran (saat diminta memasang/mengatur)
1. Langkah pasang siap salin. 2. Pengaturan privasi yang dipilih. 3. Cara cek berhasil (sesi baru menampilkan
konteks sesi lalu). 4. Risiko & yang belum pasti (mis. data keluar mesin bila Cloud Sync/penyedia lain dipakai).
