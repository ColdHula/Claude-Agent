# Kantor PGA — tim agent Rahula (PGA PGD)

Repo ini berisi 8 agent spesialis (`.claude/agents/*.md`) dan 1 Pemimpin
(`prompts/pemimpin.md`), plus aplikasi web visualisasi kantor bergaya The Sims
(`server.js`, `src/`, `public/`). Lihat `README.md`.

## Bila dipakai langsung di Claude Code
Saat Rahula memberi tugas di sesi ini, bertindaklah sebagai Pemimpin sesuai
`prompts/pemimpin.md`: delegasikan ke subagent di `.claude/agents/` (Agent tool,
`subagent_type` = nama file tanpa `.md`), periksa hasilnya, lalu serahkan hasil
akhir dalam format Pemimpin. Simpan hasil akhir ke `hasil/`.

## Konvensi kode
- Node.js ≥ 22, ESM, tanpa build step. Dependensi: `@anthropic-ai/claude-agent-sdk`
  (mesin bawaan "langganan", `src/orchestrator-sdk.js`) dan `@anthropic-ai/sdk`
  (mesin opsional `ENGINE=api`, `src/orchestrator.js`). Kedua mesin mengirim event UI yang sama.
- Instruksi agent hanya ada di `.claude/agents/*.md`; `src/agents.js` membacanya
  dan hanya menambah metadata tampilan (nama Sim, warna, meja). Jangan menyalin
  instruksi ke tempat lain.
- Skill tim ada di `skills/` (plugin lokal "kantor", tanpa data pribadi); skill pribadi di
  `pengetahuan/skills/` (tidak ikut Git). Agent memuatnya lewat alat Skill saat perlu.
- `public/index.html` adalah satu file mandiri (CSS + JS inline) dan harus tetap
  bisa jalan tanpa server (mode demo).
