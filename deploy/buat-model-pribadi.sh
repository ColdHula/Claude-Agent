#!/usr/bin/env bash
# Membuat model pribadi dari Modelfile (persona + aturan), tanpa training/GPU.
# Model hasilnya muncul di HvM AI untuk dipilih. Jalankan SETELAH pasang-ollama.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/buat-model-pribadi.sh | sudo bash
#
# Pilihan (tulis di depan perintah):
#   NAMA=hvm                           nama model yang muncul di HvM AI
#   MODELFILE=Modelfile.hvm          file persona di ngobrol/model-pribadi/
#   APP_USER=user  APP_DIR=/home/user/kantor-pga
set -euo pipefail
APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"
NAMA="${NAMA:-hvm}"
MODELFILE="${MODELFILE:-Modelfile.hvm}"
DIR="${APP_DIR}/ngobrol/model-pribadi"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
command -v ollama >/dev/null 2>&1 || die "Ollama belum terpasang. Jalankan deploy/pasang-ollama.sh dulu."
[ -f "${DIR}/${MODELFILE}" ] || die "File ${DIR}/${MODELFILE} tidak ada. Pastikan repo sudah terbaru."

# Pastikan model basis (baris FROM) sudah ada. Basis Qwen3 MoE ±15 GB — jangan diunduh
# inline di sini (berisiko putus di Hive Shell). Kalau belum ada, tarik dulu secara
# terpisah (tahan putus) lewat tarik-model.sh, baru jalankan skrip ini lagi.
BASE="$(grep -iE '^FROM ' "${DIR}/${MODELFILE}" | head -1 | awk '{print $2}')"
if ! OLLAMA_HOST="127.0.0.1:11434" ollama list 2>/dev/null | awk '{print $1}' | grep -qxF "${BASE}"; then
  die "Model basis '${BASE}' belum ada. Tarik dulu (tahan Hive Shell putus):
    curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/tarik-model.sh | MODEL='${BASE}' sudo bash
  Tunggu 'cek-model' menampilkan '${BASE}' selesai, lalu jalankan skrip ini lagi."
fi
say "Membuat model '${NAMA}' dari ${MODELFILE} (basis: ${BASE})…"
OLLAMA_HOST="127.0.0.1:11434" ollama create "${NAMA}" -f "${DIR}/${MODELFILE}"

say "Selesai. Model '${NAMA}' siap dipakai."
cat <<EOF

  Buka HvM AI → pilih model "${NAMA}" di pojok kiri atas.
  Ubah kepribadian/aturan kapan saja: edit ${DIR}/${MODELFILE}
  lalu jalankan skrip ini lagi (model dengan nama sama akan diperbarui).

EOF
