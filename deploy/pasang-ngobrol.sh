#!/usr/bin/env bash
# Pasang antarmuka chat "Ngobrol" untuk model lokal (Ollama) di rig HiveOS.
# Berjalan sebagai layanan systemd, berpassword, dan dibuka aman lewat Tailscale (port 8443).
# Jalankan SETELAH deploy/pasang-ollama.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-ngobrol.sh | sudo bash
set -euo pipefail

APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"   # repo tempat folder ngobrol/ berada
PORT="${PORT:-3001}"
SERVE_PORT="${SERVE_PORT:-8443}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
id "$APP_USER" >/dev/null 2>&1 || die "Pengguna '$APP_USER' tidak ada. Jalankan ulang dengan APP_USER=<nama> di depan sudo."
[ -d "$APP_DIR/ngobrol" ] || die "Folder $APP_DIR/ngobrol tidak ada. Pastikan repo Kantor PGA sudah terpasang & terbaru."
command -v node >/dev/null 2>&1 || die "Node.js belum ada. Pasang Kantor PGA dulu (deploy/pasang-hiveos.sh)."

# Kata sandi Nexa TERPISAH dari Kantor PGA (bisa dibagi ke teman tanpa memberi akses data PGA).
# Urutan: NEXA_PASSWORD dari env  >  kata sandi lama di ngobrol.service  >  dibuatkan baru.
PW="${NEXA_PASSWORD:-${NGOBROL_PASSWORD:-}}"
if [ -z "$PW" ] && [ -f /etc/systemd/system/ngobrol.service ]; then
  PW="$(grep -oE 'NGOBROL_PASSWORD=.*' /etc/systemd/system/ngobrol.service | head -1 | cut -d= -f2-)"
  [ -n "$PW" ] && say "Memakai kata sandi Nexa yang sudah ada."
fi
if [ -z "$PW" ]; then
  PW="$(head -c 9 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
  say "Kata sandi Nexa (TERPISAH dari Kantor PGA) dibuatkan:"
  printf '    \033[1m%s\033[0m\n' "$PW"
  say "CATAT kata sandi di atas. Ganti kapan saja dengan: NEXA_PASSWORD=... jalankan ulang skrip ini."
fi

say "Membuat layanan systemd…"
cat > /etc/systemd/system/ngobrol.service <<EOF
[Unit]
Description=Ngobrol - antarmuka chat model lokal
After=network-online.target ollama.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/ngobrol
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
Environment=OLLAMA_URL=http://127.0.0.1:11434
Environment=NGOBROL_PASSWORD=${PW}
ExecStart=/usr/bin/env node ${APP_DIR}/ngobrol/server.js
Restart=on-failure
Nice=10
MemoryMax=400M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ngobrol
sleep 2
systemctl is-active --quiet ngobrol || die "Ngobrol gagal menyala. Lihat: journalctl -u ngobrol -n 30"

# Buka lewat Tailscale (HTTPS) di port terpisah dari Kantor PGA.
if command -v tailscale >/dev/null 2>&1; then
  say "Menyajikan lewat Tailscale di port ${SERVE_PORT}…"
  tailscale serve --bg --https="${SERVE_PORT}" "${PORT}" || say "Gagal tailscale serve; jalankan manual: sudo tailscale serve --bg --https=${SERVE_PORT} ${PORT}"
fi

HOSTN="$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"
say "Selesai."
cat <<EOF

  Ngobrol berjalan sebagai layanan (nyala lagi otomatis setelah reboot).
  Buka dari HP/laptop (Tailscale aktif):
    https://${HOSTN:-<nama-rig>.ts.net}:${SERVE_PORT}
  Kata sandi: TERPISAH dari Kantor PGA (yang tercetak di atas / yang Anda set).
  Aman dibagi ke teman: mereka hanya bisa membuka Nexa, bukan data Kantor PGA.

  Perintah:
    sudo systemctl restart ngobrol
    journalctl -u ngobrol -f
    sudo systemctl disable --now ngobrol    # matikan

  Catatan: pilih model di pojok kiri atas. Bila kosong, jalankan dulu:
    OLLAMA_HOST=127.0.0.1:11434 ollama pull qwen3-coder:30b

EOF
