#!/usr/bin/env bash
# Mode Premium Aira: wajah foto-realistis yang bicara (Ditto) + suara neural Indonesia, di GPU NVIDIA rig.
# Jalankan SETELAH deploy/pasang-aira.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/loving-franklin-gzzt22/deploy/pasang-ditto.sh | sudo bash
#   (atau dari repo: sudo bash deploy/pasang-ditto.sh)
#   (opsional) AIRA_GPU=1 AIRA_SUARA=id-ID-GadisNeural DITTO_STEPS=25 sudo -E bash deploy/pasang-ditto.sh
#
# Yang dipasang:
#  - pengguna sistem 'aira-gpu' (tanpa shell), kode di /opt/aira-ditto, data di /var/lib/aira-ditto
#  - Python 3.10 (uv) + PyTorch CUDA + TensorRT 8.6.1 + Ditto + model dari HuggingFace (±5 GB)
#  - layanan systemd aira-ditto: hanya Unix socket /run/aira-ditto/ditto.sock (tidak membuka port)
#  - firewall: aira-gpu tidak bisa membuka koneksi ke localhost/LAN (hanya internet untuk suara Edge TTS)
#
# Catatan: GPU yang dipakai sebaiknya TIDAK sedang mining (VRAM ±6–8 GB). Pilih dengan AIRA_GPU=<indeks>.
set -euo pipefail

APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"
OPT=/opt/aira-ditto
STATE=/var/lib/aira-ditto
GPU="${AIRA_GPU:-0}"
DITTO_REPO="https://github.com/antgroup/ditto-talkinghead"
HF_REPO="digital-avatar/ditto-talkinghead"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
command -v nvidia-smi >/dev/null 2>&1 || die "nvidia-smi tidak ada. Driver NVIDIA belum terpasang?"
id aira >/dev/null 2>&1 || die "Pasang Aira dulu: sudo bash deploy/pasang-aira.sh"
[ -f "$APP_DIR/aira/ditto/layanan.py" ] || APP_DIR="/home/${APP_USER}/aira-src"   # kode dari pasang-aira.sh
[ -f "$APP_DIR/aira/ditto/layanan.py" ] || die "Kode Aira tidak ditemukan. Jalankan pasang-aira.sh dulu (ia mengambil kodenya)."
FREE_GB="$(df -BG --output=avail /opt | tail -1 | tr -dc 0-9)"
[ "${FREE_GB:-0}" -ge 15 ] || die "Sisa disk di /opt hanya ${FREE_GB} GB. Mode Premium butuh ±15 GB (PyTorch, TensorRT, model Ditto)."

say "GPU yang terdeteksi:"
nvidia-smi --query-gpu=index,name,memory.total,memory.used,compute_cap --format=csv,noheader
CC="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader -i "$GPU" | tr -d ' ')"
NAMA="$(nvidia-smi --query-gpu=name --format=csv,noheader -i "$GPU")"
[ -n "$CC" ] || die "GPU indeks $GPU tidak ada. Pilih dengan AIRA_GPU=<indeks>."
say "Memakai GPU $GPU: $NAMA (compute capability $CC)"
USED="$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -i "$GPU" | tr -d ' ')"
[ "${USED:-0}" -gt 2000 ] && warn "GPU $GPU sedang memakai ${USED} MB VRAM (mining?). Ditto butuh ±6 GB bebas; hentikan mining di GPU ini atau pilih AIRA_GPU lain."

say "1/6 Paket sistem (ffmpeg, git-lfs)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || true
apt-get install -y -qq ffmpeg git git-lfs curl ca-certificates >/dev/null

say "2/6 Pengguna 'aira-gpu'…"
id aira-gpu >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin aira-gpu
for g in video render; do getent group $g >/dev/null && usermod -aG $g aira-gpu; done
usermod -aG aira-gpu aira          # agar server Aira boleh membuka socket
mkdir -p "$OPT" "$STATE"
chown -R aira-gpu:aira-gpu "$STATE"; chmod 750 "$STATE"

say "3/6 Python 3.10 + PyTorch + TensorRT (beberapa GB, sabar)…"
export UV_INSTALL_DIR="$OPT/bin" UV_PYTHON_INSTALL_DIR="$OPT/python"
[ -x "$OPT/bin/uv" ] || curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
UV="$OPT/bin/uv"
[ -d "$OPT/venv" ] || "$UV" venv --python 3.10 "$OPT/venv" >/dev/null
PY="$OPT/venv/bin/python"
"$UV" pip install --python "$PY" -q torch --index-url https://download.pytorch.org/whl/cu121
"$UV" pip install --python "$PY" -q tensorrt==8.6.1 librosa tqdm filetype imageio opencv_python_headless scikit-image \
  cython cuda-python imageio-ffmpeg colored polygraphy "numpy==2.0.1" edge-tts huggingface_hub

say "4/6 Kode Ditto + model…"
if [ -d "$OPT/ditto-talkinghead/.git" ]; then git -C "$OPT/ditto-talkinghead" pull -q || true
else git clone -q "$DITTO_REPO" "$OPT/ditto-talkinghead"; fi
CK="$OPT/ditto-talkinghead/checkpoints"
"$PY" - <<PYEOF
from huggingface_hub import snapshot_download
snapshot_download("$HF_REPO", local_dir="$CK", allow_patterns=["ditto_cfg/*", "ditto_onnx/*", "ditto_trt_Ampere_Plus/*"])
PYEOF
MAJOR="${CC%%.*}"
if [ "$MAJOR" -ge 8 ]; then
  DATA_ROOT="$CK/ditto_trt_Ampere_Plus"
else
  DATA_ROOT="$CK/ditto_trt_custom"
  if [ ! -f "$DATA_ROOT/decoder_fp16.engine" ]; then
    say "GPU lebih tua dari Ampere: membangun mesin TensorRT khusus (10–30 menit)…"
    (cd "$OPT/ditto-talkinghead" && CUDA_VISIBLE_DEVICES="$GPU" "$PY" scripts/cvt_onnx_to_trt.py --onnx_dir "$CK/ditto_onnx" --trt_dir "$DATA_ROOT")
  fi
fi
install -m 644 "$APP_DIR/aira/ditto/layanan.py" "$OPT/layanan.py"
chown -R root:root "$OPT"; chmod -R go-w "$OPT"

say "5/6 Firewall aira-gpu (tanpa localhost/LAN)…"
DNS_IPS="$(awk '/^nameserver/{print $2}' /etc/resolv.conf | tr '\n' ' ')"
cat > /usr/local/sbin/aira-gpu-firewall <<EOF
#!/usr/bin/env bash
set -e
U=\$(id -u aira-gpu)
iptables -N AIRAGPU-OUT 2>/dev/null || iptables -F AIRAGPU-OUT
iptables -C OUTPUT -m owner --uid-owner \$U -j AIRAGPU-OUT 2>/dev/null || iptables -I OUTPUT 1 -m owner --uid-owner \$U -j AIRAGPU-OUT
iptables -A AIRAGPU-OUT -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for d in ${DNS_IPS}; do case "\$d" in *:*) ;; *) iptables -A AIRAGPU-OUT -d "\$d" -p udp --dport 53 -j RETURN; iptables -A AIRAGPU-OUT -d "\$d" -p tcp --dport 53 -j RETURN;; esac; done
for n in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do iptables -A AIRAGPU-OUT -d \$n -j REJECT; done
EOF
chmod 755 /usr/local/sbin/aira-gpu-firewall
if command -v iptables >/dev/null 2>&1; then
  cat > /etc/systemd/system/aira-gpu-firewall.service <<'EOF'
[Unit]
Description=Firewall layanan GPU Aira
Before=aira-ditto.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/aira-gpu-firewall
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload; systemctl enable aira-gpu-firewall >/dev/null 2>&1; systemctl restart aira-gpu-firewall || warn "Firewall gagal."
fi

say "6/6 Layanan systemd…"
cat > /etc/systemd/system/aira-ditto.service <<EOF
[Unit]
Description=Aira Premium - Ditto talking head (GPU)
After=network-online.target aira-gpu-firewall.service
Wants=network-online.target

[Service]
Type=simple
User=aira-gpu
Group=aira-gpu
RuntimeDirectory=aira-ditto
RuntimeDirectoryMode=0750
Environment=HOME=${STATE}
Environment=CUDA_VISIBLE_DEVICES=${GPU}
Environment=DITTO_DIR=${OPT}/ditto-talkinghead
Environment=DITTO_DATA_ROOT=${DATA_ROOT}
Environment=DITTO_SOCK=/run/aira-ditto/ditto.sock
Environment=DITTO_STATE=${STATE}
Environment=AIRA_SUARA=${AIRA_SUARA:-id-ID-GadisNeural}
Environment=DITTO_STEPS=${DITTO_STEPS:-25}
ExecStart=${OPT}/venv/bin/python ${OPT}/layanan.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=${STATE}
ProtectHome=yes
PrivateTmp=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
IPAddressDeny=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10
IPAddressAllow=localhost ${DNS_IPS}

[Install]
WantedBy=multi-user.target
EOF
# Server Aira: boleh membuka socket Ditto
mkdir -p /etc/systemd/system/aira.service.d
cat > /etc/systemd/system/aira.service.d/ditto.conf <<'EOF'
[Service]
SupplementaryGroups=aira-gpu
Environment=AIRA_DITTO_SOCK=/run/aira-ditto/ditto.sock
EOF
systemctl daemon-reload
systemctl enable aira-ditto >/dev/null 2>&1
systemctl restart aira-ditto
systemctl restart aira

say "Menunggu model dimuat (bisa 1–2 menit)…"
for i in $(seq 1 60); do
  S="$(curl -s --unix-socket /run/aira-ditto/ditto.sock http://x/status || true)"
  echo "$S" | grep -q '"siap": true' && break
  echo "$S" | grep -q '"galat": "[^"]' && break
  sleep 3
done
echo "Status: ${S:-tidak ada jawaban}"
cat <<EOF

  Selesai. Di aplikasi Aira: 🎤 Suara → nyalakan "Mode Premium (GPU)".
  Mode ini bekerja untuk avatar Potret (foto). Tiap kalimat dibuat jadi klip video bicara.

  Perintah:
    journalctl -u aira-ditto -f
    sudo systemctl restart aira-ditto
    sudo systemctl disable --now aira-ditto        # matikan mode premium
  Kecepatan vs kualitas: DITTO_STEPS=10 (cepat) … 50 (paling halus), lalu jalankan ulang skrip ini.
EOF
