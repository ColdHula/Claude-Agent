#!/usr/bin/env bash
# "Tarik model" — mengunduh SATU model Ollama di rig sebagai layanan systemd
# (unit 'hvm-pull'), sehingga Hive Shell / laptop boleh langsung ditutup — unduhan
# tetap jalan di rig. Perintah ini kembali dalam beberapa detik.
#
# Pakai (bawaan: Qwen3-30B-A3B abliterated / tanpa sensor, coder, Q3_K_M ±15 GB):
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh | sudo bash
#
# Pilih varian/quant lewat MODEL= (lihat tabel di deploy/LAPTOP.md). Contoh:
#   ...tarik-model.sh | MODEL=huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_K_M sudo bash
#
# Catatan RAM 16 GB (MoE 3B aktif → tetap gesit di CPU):
#   q2_K      ±11 GB  muat penuh di RAM (paling mulus, kualitas paling rendah)
#   q3_K_M    ±15 GB  BAWAAN — paling seimbang untuk 16 GB (sedikit mmap dari SSD)
#   q4_K_M    ±19 GB  kualitas terbaik, TAPI > 16 GB → andalkan NVMe (mmap dari disk)
set -euo pipefail

MODEL="${MODEL-huihui_ai/qwen3-coder-abliterated:30b-a3b-instruct-q3_K_M}"
LOG=/home/user/hvm-pull.log

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
command -v ollama >/dev/null 2>&1 || die "Ollama belum terpasang. Jalankan dulu: deploy/pasang-ollama-bg.sh"

# Pastikan layanan Ollama hidup (model ditarik lewat API lokalnya di 127.0.0.1).
systemctl is-active --quiet ollama || systemctl start ollama 2>/dev/null || true
sleep 1

: > "$LOG"; chown user:user "$LOG" 2>/dev/null || true

# Pintasan cek progres (sama seperti pasang-ollama-bg.sh; dibuat bila belum ada).
if [ ! -x /usr/local/bin/cek-model ]; then
  cat > /usr/local/bin/cek-model <<EOF
#!/usr/bin/env bash
echo "=== status unduhan (hvm-pull): \$(systemctl is-active hvm-pull 2>/dev/null) ==="
tr '\\r' '\\n' < "$LOG" 2>/dev/null | grep -vE '^\$' | tail -n 3
echo "--- model yang sudah selesai ---"
OLLAMA_HOST=127.0.0.1:11434 ollama list 2>/dev/null || echo "(ollama belum siap)"
EOF
  chmod +x /usr/local/bin/cek-model
fi
if [ ! -x /usr/local/bin/progress-model ]; then
  cat > /usr/local/bin/progress-model <<EOF
#!/usr/bin/env bash
echo "Pantau progres (Ctrl+C untuk keluar)…"; tail -f "$LOG"
EOF
  chmod +x /usr/local/bin/progress-model
fi

# Jalankan unduhan sebagai layanan transient (tahan putus). HOME wajib (ollama panic tanpa itu).
systemctl reset-failed hvm-pull 2>/dev/null || true
systemd-run --unit=hvm-pull --collect --setenv=HOME=/root --property=Nice=15 --property=IOWeight=20 \
  /bin/bash -c "export HOME=/root OLLAMA_HOST=127.0.0.1:11434; ollama pull '$MODEL' >> '$LOG' 2>&1"

cat <<EOF

  ✅ Unduhan model berjalan di rig sebagai layanan 'hvm-pull'.
     Hive Shell / laptop BOLEH DITUTUP sekarang — unduhan tetap lanjut.

  Model : $MODEL
  GPU   : TIDAK dipakai (semua tetap untuk mining)

  CEK KEMAJUAN (buka Hive Shell kapan saja):
    cek-model          # ringkas: status + % unduhan + model selesai
    progress-model     # pantau live (Ctrl+C untuk keluar)

  SELESAI bila 'cek-model' menampilkan model di atas.
  Lalu buka HvM AI dari laptop (lihat deploy/LAPTOP.md) dan pilih model ini di dropdown.

EOF
