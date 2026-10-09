#!/usr/bin/env bash
# Membuat model pribadi dari Modelfile (persona + aturan), tanpa training/GPU.
# Model hasilnya muncul di Nexa untuk dipilih. Jalankan SETELAH pasang-ollama.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/buat-model-pribadi.sh | sudo bash
#
# Pilihan (tulis di depan perintah):
#   NAMA=mager                         nama model yang muncul di Nexa
#   MODELFILE=Modelfile.mager          file persona di ngobrol/model-pribadi/
#   APP_USER=user  APP_DIR=/home/user/kantor-pga
set -euo pipefail
APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"
NAMA="${NAMA:-mager}"
MODELFILE="${MODELFILE:-Modelfile.mager}"
DIR="${APP_DIR}/ngobrol/model-pribadi"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
command -v ollama >/dev/null 2>&1 || die "Ollama belum terpasang. Jalankan deploy/pasang-ollama.sh dulu."
[ -f "${DIR}/${MODELFILE}" ] || die "File ${DIR}/${MODELFILE} tidak ada. Pastikan repo sudah terbaru."

# Pastikan model basis (baris FROM) sudah ada; kalau belum, Ollama akan mengunduhnya.
BASE="$(grep -iE '^FROM ' "${DIR}/${MODELFILE}" | head -1 | awk '{print $2}')"
say "Membuat model '${NAMA}' dari ${MODELFILE} (basis: ${BASE})…"
OLLAMA_HOST="127.0.0.1:11434" ollama create "${NAMA}" -f "${DIR}/${MODELFILE}"

say "Selesai. Model '${NAMA}' siap dipakai."
cat <<EOF

  Buka Nexa → pilih model "${NAMA}" di pojok kiri atas.
  Ubah kepribadian/aturan kapan saja: edit ${DIR}/${MODELFILE}
  lalu jalankan skrip ini lagi (model dengan nama sama akan diperbarui).

EOF
