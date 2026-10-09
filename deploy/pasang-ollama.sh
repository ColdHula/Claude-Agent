#!/usr/bin/env bash
# Pasang Ollama CPU-only di rig HiveOS, agar GPU tetap 100% untuk mining.
#
# Jalankan di Hive Shell:
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama.sh | sudo bash
#
# Pilihan lewat variabel lingkungan (opsional, tulis di depan perintah):
#   MODEL=qwen3-coder:30b   model yang langsung diunduh (kosongkan agar tidak mengunduh)
#   THREADS=8               jumlah thread CPU untuk LLM (sisakan sebagian untuk sistem & miner)
#   RAM_MAX=13G             batas RAM proses Ollama
set -euo pipefail

# Bawaan: Qwen2.5-Coder 14B versi "abliterated" (tanpa sensor), Q4 ±9 GB, muat di RAM 16 GB.
# Lebih ringan: qwen2.5-coder-abliterate:7b. Versi biasa (bersensor): qwen2.5-coder:14b.
# Qwen3-Coder 30B (±19 GB) TIDAK muat di 16 GB — hanya untuk RAM 32 GB+.
MODEL="${MODEL-huihui_ai/qwen2.5-coder-abliterate:14b}"
THREADS="${THREADS:-6}"  # i5-10400F punya 6 core fisik; untuk inferensi CPU biasanya paling optimal = core fisik
RAM_MAX="${RAM_MAX:-13G}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."

# 1) Syarat CPU: Ollama CPU-only butuh AVX (idealnya AVX2).
if ! grep -qw avx /proc/cpuinfo; then
  die "CPU tidak punya AVX. Ollama tidak akan jalan di CPU ini (mis. Pentium Gold). Pasang CPU ber-AVX2 lebih dulu (mis. Core i5-10400F)."
fi
grep -qw avx2 /proc/cpuinfo || say "Peringatan: CPU punya AVX tapi tidak AVX2. Model akan lebih lambat."

# 2) Alamat Tailscale rig (akses hanya dari perangkat Tailscale Anda, tidak ke internet).
IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
if [ -z "$IP" ]; then
  IP="127.0.0.1"
  say "Tailscale belum aktif. Sementara Ollama hanya bisa diakses dari rig sendiri (127.0.0.1)."
  say "Setelah Tailscale aktif, jalankan ulang skrip ini agar bisa diakses dari HP/laptop."
fi

# 3) Pasang Ollama (resmi).
if ! command -v ollama >/dev/null 2>&1; then
  say "Memasang Ollama…"
  curl -fsSL https://ollama.com/install.sh | sh
else
  say "Ollama sudah ada; memperbarui konfigurasi saja."
fi

# 4) Konfigurasi: CPU-only, prioritas di bawah miner, batas RAM, akses via Tailscale.
say "Menulis konfigurasi CPU-only…"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/rig.conf <<EOF
[Service]
# --- GPU tidak tersentuh: semua VGA tetap untuk mining ---
# CUDA_VISIBLE_DEVICES kosong => Ollama tidak melihat GPU sama sekali.
Environment="CUDA_VISIBLE_DEVICES="
Environment="OLLAMA_LLM_LIBRARY=cpu_avx2"

# --- Akses hanya dari jaringan Tailscale Anda ---
Environment="OLLAMA_HOST=${IP}:11434"

# --- Hemat RAM (penting di 16 GB) ---
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_MAX_LOADED_MODELS=1"

# --- Sisakan CPU untuk sistem & miner ---
Environment="OLLAMA_NUM_THREADS=${THREADS}"
Environment="OLLAMA_NUM_PARALLEL=1"

# --- Mengalah ke proses lain; miner (berat di GPU) tidak terganggu ---
Nice=15
CPUWeight=20
IOWeight=20

# --- Batas RAM agar rig tidak kehabisan memori lalu reboot ---
MemoryHigh=12G
MemoryMax=${RAM_MAX}
EOF

systemctl daemon-reload
systemctl enable --now ollama >/dev/null 2>&1 || true
systemctl restart ollama
sleep 3

systemctl is-active --quiet ollama || die "Ollama gagal menyala. Lihat: journalctl -u ollama -n 30"

# 5) Unduh model (opsional).
if [ -n "$MODEL" ]; then
  say "Mengunduh model: $MODEL (bisa beberapa GB, sekali saja)…"
  OLLAMA_HOST="${IP}:11434" ollama pull "$MODEL" || say "Gagal mengunduh $MODEL. Coba manual: OLLAMA_HOST=${IP}:11434 ollama pull $MODEL"
fi

# Model embedding untuk RAG (dokumen pribadi di HvM AI). Kecil (~270 MB).
say "Mengunduh model embedding untuk RAG: nomic-embed-text…"
OLLAMA_HOST="${IP}:11434" ollama pull nomic-embed-text || say "Lewati embedding (bisa nanti: OLLAMA_HOST=${IP}:11434 ollama pull nomic-embed-text)"

say "Selesai."
cat <<EOF

  Ollama (CPU-only) berjalan di : http://${IP}:11434
  Thread CPU untuk LLM          : ${THREADS}
  Batas RAM                     : ${RAM_MAX}
  GPU                           : TIDAK dipakai (semua tetap untuk mining)

  Cek GPU aman saat model menjawab (tab Hive Shell lain):
    nvidia-smi        # tidak boleh ada proses 'ollama' di daftar GPU

  Pakai dari laptop (Tailscale aktif), mis. VS Code + ekstensi Continue:
    Base URL : http://${IP}:11434
    Model    : ${MODEL:-<nama-model>}

  Perintah harian:
    ollama list                         # daftar model
    OLLAMA_HOST=${IP}:11434 ollama pull <model>   # tambah model
    sudo systemctl restart ollama       # restart
    journalctl -u ollama -f             # log

EOF
