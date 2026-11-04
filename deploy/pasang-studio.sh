#!/usr/bin/env bash
# Pasang Studio (chat ala claude.ai + mode Code ala Claude Code) sebagai layanan di rig/VPS.
# Berjalan sebagai layanan systemd, berpassword, dan dibuka aman lewat Tailscale (port 8444).
# Jalankan SETELAH Kantor PGA terpasang (deploy/pasang-hiveos.sh), karena memakai repo & Node yang sama.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/happy-goldberg-vjemhr/deploy/pasang-studio.sh | sudo bash
#
# Setelah terpasang, semua diatur dari aplikasi: login Claude, AI gratis, impor claude.ai, sinkron GitHub.
set -euo pipefail

APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"
PORT="${STUDIO_PORT:-3002}"
SERVE_PORT="${SERVE_PORT:-8444}"
DATA_DIR="${STUDIO_DATA:-/home/${APP_USER}/studio-data}"   # arsip chat, di luar repo (aman saat repo diperbarui)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
id "$APP_USER" >/dev/null 2>&1 || die "Pengguna '$APP_USER' tidak ada. Jalankan ulang dengan APP_USER=<nama> di depan sudo."
[ -f "$APP_DIR/studio/server.js" ] || die "Folder $APP_DIR/studio tidak ada. Perbarui repo Kantor PGA dulu (git pull)."
command -v node >/dev/null 2>&1 || die "Node.js belum ada. Pasang Kantor PGA dulu (deploy/pasang-hiveos.sh)."

say "Memasang alat pendukung (git, unzip, poppler-utils untuk PDF)…"
if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y -qq git unzip poppler-utils bsdutils >/dev/null 2>&1 || say "Lewati: pasang manual 'git unzip poppler-utils' bila perlu."
fi
[ -d "$APP_DIR/node_modules/@anthropic-ai/claude-agent-sdk" ] || (cd "$APP_DIR" && sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund --loglevel=error)

mkdir -p "$DATA_DIR" && chown "$APP_USER":"$APP_USER" "$DATA_DIR" && chmod 700 "$DATA_DIR"

# Kata sandi Studio. Urutan: STUDIO_PASSWORD dari env > yang lama di studio.service > dibuatkan baru.
PW="${STUDIO_PASSWORD:-}"
if [ -z "$PW" ] && [ -f /etc/systemd/system/studio.service ]; then
  PW="$(grep -oE 'STUDIO_PASSWORD=.*' /etc/systemd/system/studio.service | head -1 | cut -d= -f2-)"
  [ -n "$PW" ] && say "Memakai kata sandi Studio yang sudah ada."
fi
if [ -z "$PW" ]; then
  PW="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
  say "Kata sandi Studio dibuatkan:"
  printf '    \033[1m%s\033[0m\n' "$PW"
  say "CATAT kata sandi di atas. Ganti kapan saja: STUDIO_PASSWORD=... jalankan ulang skrip ini."
fi

say "Membuat layanan systemd…"
cat > /etc/systemd/system/studio.service <<EOF
[Unit]
Description=Studio - chat Claude & AI gratis + mode Code
After=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=HOME=/home/${APP_USER}
Environment=STUDIO_PORT=${PORT}
Environment=HOST=127.0.0.1
Environment=STUDIO_DATA=${DATA_DIR}
Environment=STUDIO_PASSWORD=${PW}
Environment=TZ=Asia/Jakarta
ExecStart=/usr/bin/env node --env-file-if-exists=${APP_DIR}/.env ${APP_DIR}/studio/server.js
Restart=on-failure
Nice=5
MemoryMax=1500M

[Install]
WantedBy=multi-user.target
EOF
chmod 600 /etc/systemd/system/studio.service

systemctl daemon-reload
systemctl enable --now studio
systemctl restart studio
sleep 2
systemctl is-active --quiet studio || die "Studio gagal menyala. Lihat: journalctl -u studio -n 30"

if command -v tailscale >/dev/null 2>&1; then
  say "Menyajikan lewat Tailscale di port ${SERVE_PORT}…"
  tailscale serve --bg --https="${SERVE_PORT}" "${PORT}" || say "Gagal tailscale serve; jalankan manual: sudo tailscale serve --bg --https=${SERVE_PORT} ${PORT}"
fi

HOSTN="$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"
say "Selesai."
cat <<EOF

  Studio berjalan sebagai layanan (nyala lagi otomatis setelah reboot).
  Buka dari HP/laptop (Tailscale aktif):
    https://${HOSTN:-<nama-rig>.ts.net}:${SERVE_PORT}

  Saat pertama dibuka, panduan awal membantu:
    1. Masuk dengan akun Claude (langganan Pro/Max) — langsung dari aplikasi.
    2. Memilih AI gratis (Gemini, Groq, OpenRouter, FreeLLMAPI, Ollama).
    3. Impor chat, Project & memori dari claude.ai (ZIP "Export data").
    4. Menyimpan chat: lokal di ${DATA_DIR} dan/atau repo GitHub privat.

  Perintah:
    sudo systemctl restart studio
    journalctl -u studio -f
    sudo systemctl disable --now studio    # matikan

EOF
