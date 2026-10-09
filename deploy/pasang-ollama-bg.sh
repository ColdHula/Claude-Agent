#!/usr/bin/env bash
# "Nyalakan lalu tinggalkan": pasang Ollama (CPU-only) + konfigurasi, lalu unduh model
# sebagai LAYANAN systemd di rig. Hive Shell boleh langsung ditutup / laptop mati —
# unduhan tetap jalan di rig dan melanjutkan dari posisi terakhir.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama-bg.sh | sudo bash
#
# Opsi (tulis di depan perintah): MODEL=huihui_ai/qwen2.5-coder-abliterate:7b  THREADS=6  RAM_MAX=13G
set -euo pipefail
MODEL="${MODEL-huihui_ai/qwen2.5-coder-abliterate:14b}"
EMBED="${EMBED-nomic-embed-text}"
THREADS="${THREADS:-6}"
RAM_MAX="${RAM_MAX:-13G}"
LOG=/home/user/hvm-pull.log

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
grep -qw avx /proc/cpuinfo || die "CPU tidak punya AVX. Pasang CPU ber-AVX2 dulu (mis. i5-10400F)."

# 1) Pasang Ollama bila binary/service belum ada
if ! command -v ollama >/dev/null 2>&1 || ! systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
  say "Memasang Ollama (installer resmi)…"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# 2) Konfigurasi CPU-only, localhost, hemat RAM, prioritas di bawah miner
say "Menulis konfigurasi…"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/rig.conf <<EOF
[Service]
Environment="CUDA_VISIBLE_DEVICES="
Environment="OLLAMA_LLM_LIBRARY=cpu_avx2"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_THREADS=${THREADS}"
Environment="OLLAMA_NUM_PARALLEL=1"
Nice=15
CPUWeight=20
IOWeight=20
MemoryHigh=12G
MemoryMax=${RAM_MAX}
EOF

systemctl daemon-reload
systemctl enable --now ollama >/dev/null 2>&1 || true
systemctl restart ollama
sleep 3
systemctl is-active --quiet ollama || die "Ollama gagal menyala. Lihat: journalctl -u ollama -n 30"

# 3) Unduh model sebagai layanan transient (tahan putus). Bisa diulang; akan lanjut.
say "Memulai unduhan di latar belakang (tahan putus)…"
: > "$LOG"; chown user:user "$LOG" 2>/dev/null || true
systemctl reset-failed hvm-unduh-model 2>/dev/null || true
systemd-run --unit=hvm-unduh-model --collect \
  --property=Nice=15 --property=IOWeight=20 \
  /bin/bash -c "exec >>'$LOG' 2>&1; echo '[\$(date)] mulai unduh $MODEL'; OLLAMA_HOST=127.0.0.1:11434 ollama pull '$MODEL' && echo '[\$(date)] mulai unduh $EMBED' && OLLAMA_HOST=127.0.0.1:11434 ollama pull '$EMBED' && echo '[\$(date)] SELESAI semua model'"

cat <<EOF

  ✅ Unduhan berjalan di rig sebagai layanan 'hvm-unduh-model'.
     Hive Shell / laptop BOLEH DITUTUP sekarang — unduhan tetap lanjut.

  Model      : $MODEL  (+ $EMBED)
  GPU        : TIDAK dipakai (semua tetap untuk mining)

  CEK KEMAJUAN (buka Hive Shell kapan saja):
    cek-model                       # ringkas (bila sudah ada perintahnya)
    tail -n 5 $LOG                  # progres unduhan
    ollama list                     # model yang sudah selesai
    systemctl status hvm-unduh-model --no-pager   # status layanan unduh

  SELESAI bila 'ollama list' menampilkan:
    $MODEL
    $EMBED

  Lalu lanjut pasang aplikasi HvM AI:
    curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ngobrol.sh | sudo bash

EOF

# Pintasan 'cek-model' agar mudah memeriksa nanti
cat > /usr/local/bin/cek-model <<EOF
#!/usr/bin/env bash
echo "=== status layanan unduh ==="; systemctl is-active hvm-unduh-model 2>/dev/null || true
echo "=== 5 baris log terakhir ==="; tail -n 5 "$LOG" 2>/dev/null
echo "=== model yang sudah ada ==="; OLLAMA_HOST=127.0.0.1:11434 ollama list 2>/dev/null
EOF
chmod +x /usr/local/bin/cek-model
