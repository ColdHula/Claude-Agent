#!/usr/bin/env bash
# "Tarik model" — mengunduh SATU model Ollama di rig sebagai layanan systemd
# (unit 'hvm-pull'), sehingga Hive Shell / laptop boleh langsung ditutup — unduhan
# tetap jalan di rig. Perintah ini kembali dalam beberapa detik.
#
# Pakai (bawaan: Qwen3-Coder-30B-A3B abliterated / tanpa sensor, MoE, Q2_K ±11 GB —
# MUAT PENUH di RAM 16 GB, jadi mulus walau di HDD):
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh | sudo bash
#
# Pilih varian/quant lewat MODEL= (lihat deploy/OPTIMASI.md). Contoh:
#   ...tarik-model.sh | MODEL=huihui_ai/qwen2.5-coder-abliterate:14b sudo bash
#
# ATURAN HDD + RAM 16 GB: model HARUS muat penuh di RAM. Kalau tidak, bobot dibaca dari
# HDD terus-menerus → macet parah / Ollama tumbang. Sisakan ±4-5 GB utk OS+miner+KV.
#   ±9  GB  huihui_ai/qwen2.5-coder-abliterate:14b              dense, PALING ANDAL di HDD
#   ±11 GB  …Qwen3-Coder-30B-A3B…abliterated-GGUF:Q2_K          BAWAAN, MoE gesit, uncensored
#   ±12 GB  …:IQ3_XXS (bila ada)                                 sedikit lebih bagus dari Q2_K
#   ±15-19 GB  q3_K_M / q4_K_M                                   JANGAN di HDD — hanya bila ada SSD/NVMe
set -euo pipefail

MODEL="${MODEL-hf.co/mradermacher/Huihui-Qwen3-Coder-30B-A3B-Instruct-abliterated-GGUF:Q2_K}"
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
