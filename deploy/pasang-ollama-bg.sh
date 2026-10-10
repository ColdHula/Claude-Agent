#!/usr/bin/env bash
# "Nyalakan lalu tinggalkan": menjalankan SELURUH pemasangan Ollama + unduh model
# sebagai LAYANAN systemd di rig (unit 'hvm-setup'). Hive Shell / laptop boleh langsung
# ditutup — pemasangan & unduhan tetap jalan di rig. Perintah ini kembali dalam beberapa detik.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama-bg.sh | sudo bash
#
# Opsi: MODEL=huihui_ai/qwen2.5-coder-abliterate:7b (bawaan 14B, kualitas lebih baik)
set -euo pipefail
MODEL="${MODEL-huihui_ai/qwen2.5-coder-abliterate:14b}"
LOG=/home/user/hvm-pull.log
RAW=https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ollama.sh

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
grep -qw avx /proc/cpuinfo || die "CPU tidak punya AVX. Pasang CPU ber-AVX2 dulu (mis. i5-10400F)."

: > "$LOG"; chown user:user "$LOG" 2>/dev/null || true

# Pintasan 'cek-model' (ringkas) dan 'progress-model' (pantau live)
cat > /usr/local/bin/cek-model <<EOF
#!/usr/bin/env bash
echo "=== status (hvm-setup): \$(systemctl is-active hvm-setup 2>/dev/null) ==="
echo "--- progres unduhan terakhir ---"
# ambil potongan progres terakhir (ollama pakai \\r, jadi ganti ke baris baru lalu ambil 3 terakhir)
tr '\\r' '\\n' < "$LOG" 2>/dev/null | grep -vE '^\$' | tail -n 3
echo "--- model yang sudah selesai ---"
OLLAMA_HOST=127.0.0.1:11434 ollama list 2>/dev/null || echo "(ollama belum siap)"
EOF
chmod +x /usr/local/bin/cek-model
# pantau live (keluar: Ctrl+C)
cat > /usr/local/bin/progress-model <<EOF
#!/usr/bin/env bash
echo "Pantau progres (Ctrl+C untuk keluar)…"; tail -f "$LOG"
EOF
chmod +x /usr/local/bin/progress-model

# Jalankan seluruh pemasangan+unduh sebagai layanan transient (tahan putus)
systemctl reset-failed hvm-setup 2>/dev/null || true
systemd-run --unit=hvm-setup --collect --setenv=HOME=/root --property=Nice=15 --property=IOWeight=20 \
  /bin/bash -c "export HOME=/root; curl -fsSL '$RAW' | MODEL='$MODEL' bash >> '$LOG' 2>&1"

cat <<EOF

  ✅ Pemasangan + unduhan berjalan di rig sebagai layanan 'hvm-setup'.
     Hive Shell / laptop BOLEH DITUTUP sekarang — proses tetap lanjut di rig.

  Model : $MODEL
  GPU   : TIDAK dipakai (semua tetap untuk mining)

  CEK KEMAJUAN (buka Hive Shell kapan saja, ketik):
    cek-model          # ringkas: status + % unduhan terakhir + model selesai
    progress-model     # pantau live (Ctrl+C untuk keluar)

  SELESAI bila 'cek-model' menampilkan model di atas + nomic-embed-text.
  Lalu pasang aplikasinya:
    curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ngobrol.sh | sudo bash

EOF
