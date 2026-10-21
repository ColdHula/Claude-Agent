#!/usr/bin/env bash
# Pasang ik_llama.cpp (fork llama.cpp, CPU/AVX2 kencang untuk MoE) sebagai mesin chat
# HvM AI, menggantikan Ollama untuk chat. GPU TIDAK disentuh (build CPU-only).
#
# Seluruh proses (pasang build tools → clone → build → unduh model GGUF → bikin service →
# alihkan HvM AI) berjalan sebagai LAYANAN systemd (unit 'hvm-ik'), jadi Hive Shell / laptop
# boleh ditutup. Perintah ini kembali dalam beberapa detik.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ik-llama.sh | sudo bash
#
# Opsi (tulis di depan 'sudo'):
#   MODEL_URL=<url .gguf>   GGUF yang diunduh (bawaan: Qwen3-Coder-30B-A3B abliterated Q2_K ±11 GB)
#   CTX=4096  THREADS=6     konteks & jumlah thread CPU
#   PORT_IK=11435           port lokal llama-server (OpenAI-compatible)
set -euo pipefail

MODEL_URL="${MODEL_URL-https://huggingface.co/mradermacher/Huihui-Qwen3-Coder-30B-A3B-Instruct-abliterated-GGUF/resolve/main/Huihui-Qwen3-Coder-30B-A3B-Instruct-abliterated.Q2_K.gguf}"
IK_DIR="${IK_DIR:-/home/user/ik_llama.cpp}"
MODELS_DIR="${MODELS_DIR:-/home/user/models}"
PORT_IK="${PORT_IK:-11435}"
CTX="${CTX:-4096}"
THREADS="${THREADS:-6}"
APP_DIR="${APP_DIR:-/home/user/kantor-pga}"
# Flag kinerja ik_llama: -fa flash-attn, -rtr repack ke _R4 (muat penuh di RAM, cepat),
# -fmoe fused-MoE, -ub ukuran batch prompt. Kalau service gagal start, kurangi (mis. buang -rtr -fmoe).
IK_FLAGS="${IK_FLAGS:--c ${CTX} -t ${THREADS} -fa -rtr -fmoe -ub 2048}"
LOG=/home/user/ik-build.log

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
grep -qw avx2 /proc/cpuinfo || die "CPU tanpa AVX2 — ik_llama tidak optimal/di-support. Batalkan."

: > "$LOG"; chown user:user "$LOG" 2>/dev/null || true
MODEL_FILE="${MODELS_DIR}/$(basename "$MODEL_URL")"

# Worker berat ditulis ke file, lalu dijalankan sebagai layanan transient (tahan putus).
cat > /usr/local/bin/hvm-ik-setup <<WORKER
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/root
echo "[1/6] Pasang build tools…"
apt-get update -y || true
apt-get install -y build-essential git cmake libcurl4-openssl-dev ccache || true
# cmake HiveOS kadang terlalu tua (butuh >=3.14). Pakai pip bila perlu.
CMAKE=cmake
if ! cmake --version 2>/dev/null | grep -qE '3\.(1[4-9]|[2-9][0-9])'; then
  echo "cmake terlalu tua → pasang via pip…"; pip3 install --quiet cmake || python3 -m pip install --quiet cmake || true
  command -v cmake >/dev/null && CMAKE=cmake || CMAKE="\$(python3 -c 'import cmake,os;print(os.path.join(os.path.dirname(cmake.__file__),\"data\",\"bin\",\"cmake\"))' 2>/dev/null || echo cmake)"
fi

echo "[2/6] Ambil ik_llama.cpp…"
if [ -d "${IK_DIR}/.git" ]; then git -C "${IK_DIR}" pull --ff-only || true; else
  git clone --depth 1 https://github.com/ikawrakow/ik_llama.cpp "${IK_DIR}"; fi
chown -R user:user "${IK_DIR}" 2>/dev/null || true

echo "[3/6] Build (CPU-only, AVX2)… (bisa 15-30 menit di HDD)"
"\$CMAKE" -B "${IK_DIR}/build" -S "${IK_DIR}" -DGGML_CUDA=OFF -DGGML_NATIVE=ON -DGGML_VULKAN=OFF -DLLAMA_CURL=ON
# Nama target server beda antar versi (llama-server / server) → coba berurutan, terakhir build semua.
"\$CMAKE" --build "${IK_DIR}/build" --config Release -j"\$(nproc)" --target llama-server \
  || "\$CMAKE" --build "${IK_DIR}/build" --config Release -j"\$(nproc)" --target server \
  || "\$CMAKE" --build "${IK_DIR}/build" --config Release -j"\$(nproc)"
SRV="${IK_DIR}/build/bin/llama-server"
[ -x "\$SRV" ] || SRV="${IK_DIR}/build/bin/server"
[ -x "\$SRV" ] || { echo "GAGAL: binary llama-server tidak ditemukan"; exit 1; }

echo "[4/6] Unduh model GGUF (bila belum ada): ${MODEL_FILE}"
mkdir -p "${MODELS_DIR}"; chown user:user "${MODELS_DIR}" 2>/dev/null || true
if [ ! -s "${MODEL_FILE}" ]; then
  curl -L --fail -C - -o "${MODEL_FILE}" "${MODEL_URL}" || { echo "GAGAL unduh model. Cek MODEL_URL."; exit 1; }
fi
chown user:user "${MODEL_FILE}" 2>/dev/null || true

echo "[5/6] Buat layanan ik-llama.service (port ${PORT_IK}, CPU-only)…"
cat > /etc/systemd/system/ik-llama.service <<UNIT
[Unit]
Description=ik_llama.cpp llama-server (mesin chat HvM AI, CPU-only)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# GPU tidak tersentuh (binary memang di-build tanpa CUDA)
Environment=CUDA_VISIBLE_DEVICES=
ExecStart=\${SRV} -m ${MODEL_FILE} --host 127.0.0.1 --port ${PORT_IK} ${IK_FLAGS}
Restart=on-failure
RestartSec=5
Nice=15
CPUWeight=20
IOWeight=20

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ik-llama

echo "[6/6] Alihkan HvM AI ke ik_llama + lepas model besar dari Ollama…"
mkdir -p /etc/systemd/system/ngobrol.service.d
cat > /etc/systemd/system/ngobrol.service.d/backend.conf <<DROP
[Service]
Environment="HVM_BACKEND=openai"
Environment="LLM_URL=http://127.0.0.1:${PORT_IK}"
DROP
systemctl daemon-reload
systemctl restart ngobrol || true
# Ollama tetap hidup HANYA untuk embedding RAG; restart agar model chat besar dilepas dari RAM.
systemctl restart ollama || true

echo "SELESAI. ik_llama.cpp melayani chat di http://127.0.0.1:${PORT_IK} ; HvM AI sudah dialihkan."
WORKER
chmod +x /usr/local/bin/hvm-ik-setup

# Pintasan pantau
cat > /usr/local/bin/cek-ik <<EOF
#!/usr/bin/env bash
echo "=== build/pasang (hvm-ik): \$(systemctl is-active hvm-ik 2>/dev/null) ==="
tail -n 6 "$LOG" 2>/dev/null
echo "=== ik-llama.service: \$(systemctl is-active ik-llama 2>/dev/null) ==="
curl -s http://127.0.0.1:${PORT_IK}/health 2>/dev/null || echo "(llama-server belum siap)"
EOF
chmod +x /usr/local/bin/cek-ik
cat > /usr/local/bin/progress-ik <<EOF
#!/usr/bin/env bash
echo "Pantau build (Ctrl+C untuk keluar)…"; tail -f "$LOG"
EOF
chmod +x /usr/local/bin/progress-ik

systemctl reset-failed hvm-ik 2>/dev/null || true
systemd-run --unit=hvm-ik --collect --setenv=HOME=/root --property=Nice=18 --property=IOWeight=20 \
  /bin/bash -c "/usr/local/bin/hvm-ik-setup >> '$LOG' 2>&1"

cat <<EOF

  ✅ Pemasangan ik_llama.cpp berjalan sebagai layanan 'hvm-ik'.
     Hive Shell / laptop BOLEH DITUTUP — proses lanjut di rig (build 15-30 mnt + unduh ±11 GB).

  Model : $(basename "$MODEL_URL")
  Port  : 127.0.0.1:${PORT_IK}  (OpenAI-compatible; GPU tidak dipakai)

  PANTAU:
    cek-ik          # status build + kesehatan server
    progress-ik     # log live (Ctrl+C keluar)

  SELESAI bila 'cek-ik' menunjukkan ik-llama.service = active + /health "ok".
  HvM AI otomatis dialihkan ke ik_llama. (Model besar dilepas dari Ollama; Ollama tetap
  hidup hanya untuk embedding RAG.)

  KEMBALI ke Ollama kapan saja:
    sudo rm /etc/systemd/system/ngobrol.service.d/backend.conf && sudo systemctl daemon-reload && sudo systemctl restart ngobrol
    sudo systemctl disable --now ik-llama

EOF
