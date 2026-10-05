#!/usr/bin/env bash
# Pasang Kantor PGA di rig HiveOS (atau server Ubuntu/Debian lain).
#
# Jalankan di rig:
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-hiveos.sh | sudo bash
#
# Yang dilakukan:
#   1. Memeriksa sistem (arsitektur, versi glibc) dan memasang Node.js 22 + git bila perlu.
#   2. Mengunduh/memperbarui aplikasi ke /home/user/kantor-pga.
#   3. Membuat .env (token langganan Claude + kata sandi aplikasi) bila belum ada.
#   4. Membuat layanan systemd "kantor-pga" (otomatis jalan saat rig menyala, prioritas di bawah miner).
#   5. (Opsional) Memasang Tailscale agar bisa dibuka aman dari HP/Chromebook di mana saja.
# Aman dijalankan ulang untuk memperbarui aplikasi.
set -euo pipefail

# Bila repo dijadikan private, isi GH_TOKEN (fine-grained token, izin "Contents: Read-only").
if [ -n "${GH_TOKEN:-}" ]; then
  REPO="https://x-access-token:${GH_TOKEN}@github.com/ColdHula/Claude-Agent.git"
else
  REPO="https://github.com/ColdHula/Claude-Agent.git"
fi
BRANCH="${BRANCH:-claude/bold-feynman-27cfgv}"
APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"
PORT="${PORT:-3000}"

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n\n' "$*"; exit 1; }
ask()  { local q="$1" def="${2:-}" a; read -r -p "  $q " a </dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" -eq 0 ] || die "Jalankan dengan sudo: ... | sudo bash"
id "$APP_USER" >/dev/null 2>&1 || die "Pengguna '$APP_USER' tidak ada. Jalankan ulang dengan APP_USER=<nama> di depan perintah."

say "1/5 Memeriksa sistem"
ARCH="$(uname -m)"
case "$ARCH" in x86_64|aarch64) ok "Arsitektur $ARCH" ;; *) die "Arsitektur $ARCH belum didukung." ;; esac
GLIBC="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || echo 0)"
if [ "$(printf '%s\n2.28\n' "$GLIBC" | sort -V | head -1)" != "2.28" ]; then
  die "glibc $GLIBC terlalu lama (butuh ≥ 2.28). Perbarui image HiveOS ke versi berbasis Ubuntu 20.04/22.04 (perintah: hive-replace --list)."
fi
ok "glibc $GLIBC"
FREE_MB="$(df -Pm "/home/${APP_USER}" | awk 'NR==2{print $4}')"
[ "${FREE_MB:-0}" -ge 1500 ] || warn "Sisa disk hanya ${FREE_MB} MB; disarankan minimal 1,5 GB."
MEM_MB="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
[ "$MEM_MB" -ge 3000 ] || warn "RAM ${MEM_MB} MB. Kantor PGA butuh ±500 MB saat bekerja; pastikan miner tidak kehabisan RAM."

say "2/5 Memasang Node.js 22 dan git"
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 22 ]; then
  ok "Node.js $(node -v) sudah ada"
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates git >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  ok "Node.js $(node -v) terpasang"
fi
command -v git >/dev/null || { apt-get install -y -qq git >/dev/null; }
ok "git $(git --version | awk '{print $3}')"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
# Jalankan sebagai pengguna aplikasi, dengan Node yang sama dan pengaturan proxy (bila ada).
as_user() {
  sudo -H -u "$APP_USER" --preserve-env=HTTPS_PROXY,HTTP_PROXY,NO_PROXY,https_proxy,http_proxy,no_proxy,NODE_EXTRA_CA_CERTS,SSL_CERT_FILE \
    env "PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin" "$@"
}

say "3/5 Mengunduh aplikasi ke $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  as_user git -C "$APP_DIR" fetch -q origin "$BRANCH"
  as_user git -C "$APP_DIR" checkout -q "$BRANCH"
  as_user git -C "$APP_DIR" pull -q --ff-only origin "$BRANCH"
  ok "Diperbarui ke versi terbaru"
else
  as_user git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
  ok "Diunduh"
fi
(cd "$APP_DIR" && as_user npm install --omit=dev --no-audit --no-fund --loglevel=error) || true
# npm kadang galat tapi tetap keluar dengan kode 0; pastikan aplikasi benar-benar bisa dimuat.
if ! (cd "$APP_DIR" && as_user node -e 'Promise.all([import("@anthropic-ai/claude-agent-sdk"), import("@anthropic-ai/sdk"), import("./src/agents.js")]).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })'); then
  die "Komponen belum lengkap. Periksa koneksi internet rig, lalu jalankan ulang perintah pemasangan."
fi
ok "Komponen terpasang dan bisa dimuat"
as_user mkdir -p "$APP_DIR/hasil" "$APP_DIR/pengetahuan/umum"

say "4/5 Pengaturan (.env)"
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env sudah ada, tidak diubah (hapus file itu bila ingin mengisi ulang)"
else
  echo "  Token langganan Claude: di Chromebook/laptop jalankan"
  echo "      npx -y @anthropic-ai/claude-code setup-token"
  echo "  login dengan akun Claude Pro/Max, lalu salin token yang diawali sk-ant-oat01-..."
  TOKEN="$(ask 'Tempel token (kosongkan untuk mode demo):')"
  PASS="$(ask 'Kata sandi aplikasi (min. 12 karakter, kosongkan untuk dibuatkan):')"
  if [ -z "$PASS" ]; then PASS="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"; GENERATED=1; fi
  [ "${#PASS}" -ge 12 ] || die "Kata sandi minimal 12 karakter."
  umask 077
  {
    echo "# Dibuat oleh pasang-hiveos.sh pada $(date '+%Y-%m-%d %H:%M')"
    echo "PORT=$PORT"
    echo "HOST=127.0.0.1"
    echo "APP_PASSWORD=$PASS"
    echo "MAX_TASK_USD=3"
    [ -n "$TOKEN" ] && echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" || echo "DEMO=1"
  } >"$ENV_FILE"
  chown "$APP_USER": "$ENV_FILE"
  ok ".env dibuat (hanya bisa dibaca pemilik)"
  if [ -n "${GENERATED:-}" ]; then
    printf '  \033[1;33mKata sandi aplikasi: %s  ← catat sekarang\033[0m\n' "$PASS"
  fi
fi

say "5/5 Layanan systemd + akses jarak jauh"
cat >/etc/systemd/system/kantor-pga.service <<UNIT
[Unit]
Description=Kantor PGA (tim agent Claude)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --env-file=$APP_DIR/.env $APP_DIR/server.js
Restart=always
RestartSec=5
# Prioritas di bawah miner, dan batasi memori agar rig tetap stabil.
Nice=10
MemoryMax=1500M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q kantor-pga
systemctl restart kantor-pga
sleep 3
systemctl is-active -q kantor-pga && ok "Layanan kantor-pga berjalan" || { journalctl -u kantor-pga -n 20 --no-pager; die "Layanan gagal berjalan (lihat log di atas)."; }

URL=""
if [ "$(ask 'Pasang Tailscale agar bisa dibuka dari HP/laptop di mana saja? [Y/n]' Y)" != "n" ]; then
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
  if ! tailscale status >/dev/null 2>&1; then
    echo "  Buka tautan yang muncul di bawah, lalu login dengan akun yang sama dengan di HP/Chromebook Anda."
    tailscale up --hostname=kantor-pga
  fi
  if tailscale serve --bg "$PORT" >/dev/null 2>&1; then
    URL="$(tailscale serve status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1)"
    ok "Tailscale aktif (HTTPS, hanya perangkat di akun Tailscale Anda)"
  else
    warn "HTTPS Tailscale belum aktif. Aktifkan 'MagicDNS' dan 'HTTPS Certificates' di https://login.tailscale.com/admin/dns lalu jalankan: sudo tailscale serve --bg $PORT"
    URL="(setelah HTTPS diaktifkan)"
  fi
fi

printf '\n\033[1;32m✅ Kantor PGA terpasang.\033[0m\n'
echo "   • Di rig ini      : http://127.0.0.1:$PORT"
[ -n "$URL" ] && echo "   • Dari HP/laptop  : $URL   (pasang aplikasi Tailscale dan login di perangkat itu)"
echo "   • Log             : sudo journalctl -u kantor-pga -f"
echo "   • Perbarui        : jalankan perintah pemasangan yang sama lagi"
echo "   • Pengetahuan     : taruh file .md di $APP_DIR/pengetahuan/ (lihat README di folder itu)"
echo
