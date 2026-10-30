#!/usr/bin/env bash
# Pasang Aira (pendamping 3D) di rig sebagai layanan yang TERISOLASI:
#  - pengguna Linux sendiri "aira" (tanpa shell, tanpa akses /home, tanpa sudo)
#  - kode disalin ke /opt/aira (hanya-baca), data di /var/lib/aira
#  - systemd sandbox: sistem berkas hanya-baca, /home tersembunyi, tanpa perangkat, tanpa hak istimewa
#  - firewall per pengguna: aira tidak bisa membuka koneksi ke localhost (Kantor PGA, Ollama, HvM AI)
#    maupun ke LAN/Tailscale; hanya internet publik (Claude, pencarian web, halaman publik)
#  - dibuka lewat Tailscale HTTPS di port 10000, berpassword sendiri
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/loving-franklin-gzzt22/deploy/pasang-aira.sh | sudo bash
#   (atau dari repo: sudo bash deploy/pasang-aira.sh)
#   (opsional) AIRA_OAUTH_TOKEN=... AIRA_PASSWORD=... AIRA_NAMA=Aira AIRA_PENGGUNA=Rahula sudo -E bash deploy/pasang-aira.sh
#
# Jalankan ulang kapan saja untuk memperbarui kode (data, memori, dan model tetap).
set -euo pipefail

APP_USER="${APP_USER:-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/kantor-pga}"   # repo sumber
PORT="${AIRA_PORT:-3002}"
SERVE_PORT="${SERVE_PORT:-10000}"
OPT=/opt/aira
STATE=/var/lib/aira
ENVF=/etc/aira/aira.env

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
id "$APP_USER" >/dev/null 2>&1 || die "Pengguna '$APP_USER' tidak ada. Jalankan ulang dengan APP_USER=<nama> di depan sudo."
# Kode Aira: pakai folder aira/ di repo Kantor PGA bila sudah ada; bila belum (branch rig belum memuatnya),
# ambil branch Aira ke ~/aira-src. Menjalankan ulang skrip ini = memperbarui kode (data tetap).
AIRA_REPO="${AIRA_REPO:-https://github.com/ColdHula/Claude-Agent.git}"
AIRA_BRANCH="${AIRA_BRANCH:-claude/loving-franklin-gzzt22}"
KANTOR_ENV="/home/${APP_USER}/kantor-pga/.env"
if [ ! -d "$APP_DIR/aira" ]; then
  SRC="/home/${APP_USER}/aira-src"
  command -v git >/dev/null 2>&1 || apt-get install -y -qq git >/dev/null
  if [ -d "$SRC/.git" ]; then
    sudo -u "$APP_USER" git -C "$SRC" fetch -q origin "$AIRA_BRANCH" && sudo -u "$APP_USER" git -C "$SRC" checkout -q "$AIRA_BRANCH" \
      && sudo -u "$APP_USER" git -C "$SRC" reset -q --hard "origin/$AIRA_BRANCH"
  else
    sudo -u "$APP_USER" git clone -q -b "$AIRA_BRANCH" "$AIRA_REPO" "$SRC"
  fi
  APP_DIR="$SRC"
  echo "Kode Aira diambil dari branch $AIRA_BRANCH ke $SRC"
fi
[ -d "$APP_DIR/aira" ] || die "Kode Aira tidak ditemukan di $APP_DIR/aira."
NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "Node.js belum ada. Pasang Kantor PGA dulu (deploy/pasang-hiveos.sh)."
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Butuh Node.js 22+."
NODE="$(readlink -f "$NODE")"
case "$NODE" in /home/*|/root/*)  # node dari nvm dsb. tidak terlihat oleh aira (ProtectHome) → salin
  mkdir -p /opt/aira/bin && cp "$NODE" /opt/aira/bin/node && NODE=/opt/aira/bin/node
  export PATH="/opt/aira/bin:$PATH";;
esac

say "1/6 Membuat pengguna sistem 'aira' (tanpa shell & tanpa sudo)…"
id aira >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin aira
mkdir -p "$STATE/data" /etc/aira
chown -R aira:aira "$STATE"; chmod 700 "$STATE"

say "2/6 Menyalin kode ke $OPT (hanya-baca untuk aira)…"
mkdir -p "$OPT/aira" "$OPT/src"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude data --exclude node_modules --exclude .env "$APP_DIR/aira/" "$OPT/aira/"
else
  find "$OPT/aira" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  (cd "$APP_DIR/aira" && tar --exclude=./data --exclude=./node_modules --exclude=./.env -cf - .) | (cd "$OPT/aira" && tar -xf -)
fi
cp "$APP_DIR/src/auth.js" "$OPT/src/auth.js"
(cd "$OPT/aira" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root "$OPT"; chmod -R go-w "$OPT"

say "3/6 Rahasia (kata sandi & token Claude) di $ENVF…"
get() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- || true; }
PW="${AIRA_PASSWORD:-$(get AIRA_PASSWORD)}"
if [ -z "$PW" ]; then
  PW="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
  say "Kata sandi Aira dibuatkan (TERPISAH dari Kantor PGA & HvM AI):"; printf '    \033[1m%s\033[0m\n' "$PW"
fi
TOKEN="${AIRA_OAUTH_TOKEN:-$(get CLAUDE_CODE_OAUTH_TOKEN)}"
for f in "$APP_DIR/.env" "$KANTOR_ENV"; do
  if [ -z "$TOKEN" ] && [ -f "$f" ]; then
    TOKEN="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$f" | head -1 | cut -d= -f2- || true)"
    [ -n "$TOKEN" ] && say "Memakai CLAUDE_CODE_OAUTH_TOKEN dari $f (token yang sama dengan Kantor PGA)."
  fi
done
if [ -z "$TOKEN" ]; then
  warn "Token Claude belum ada. Aira akan menyala dalam MODE DEMO (avatar & suara jalan, jawaban contoh)."
  warn "Buat token sekali (berlaku ±1 tahun):  npx -y @anthropic-ai/claude-code setup-token"
  warn "lalu jalankan ulang:  AIRA_OAUTH_TOKEN=<token> sudo -E bash deploy/pasang-aira.sh"
fi
umask 077
cat > "$ENVF" <<EOF
AIRA_PASSWORD=${PW}
CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}
AIRA_NAMA=${AIRA_NAMA:-$(get AIRA_NAMA | grep . || echo Aira)}
AIRA_PENGGUNA=${AIRA_PENGGUNA:-$(get AIRA_PENGGUNA | grep . || echo Rahula)}
AIRA_DEMO=$([ -n "$TOKEN" ] && echo 0 || echo 1)
EOF
umask 022
chmod 600 "$ENVF"

# Server DNS yang dipakai (agar firewall tidak memutus DNS bila resolver ada di LAN/router)
DNS_IPS="$(awk '/^nameserver/{print $2}' /etc/resolv.conf | tr '\n' ' ')"

say "4/6 Firewall: blokir aira ke localhost & jaringan lokal…"
cat > /usr/local/sbin/aira-firewall <<EOF
#!/usr/bin/env bash
# Dipanggil oleh aira-firewall.service. Aturan hanya berlaku untuk koneksi BARU milik pengguna 'aira'.
set -e
UIDA=\$(id -u aira)
for IPT in iptables ip6tables; do
  command -v \$IPT >/dev/null 2>&1 || continue
  \$IPT -N AIRA-OUT 2>/dev/null || \$IPT -F AIRA-OUT
  \$IPT -C OUTPUT -m owner --uid-owner \$UIDA -j AIRA-OUT 2>/dev/null || \$IPT -I OUTPUT 1 -m owner --uid-owner \$UIDA -j AIRA-OUT
  \$IPT -A AIRA-OUT -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
done
# DNS ke resolver yang dikonfigurasi tetap boleh
for d in ${DNS_IPS}; do
  case "\$d" in *:*) T=ip6tables;; *) T=iptables;; esac
  command -v \$T >/dev/null 2>&1 || continue
  \$T -A AIRA-OUT -d "\$d" -p udp --dport 53 -j RETURN
  \$T -A AIRA-OUT -d "\$d" -p tcp --dport 53 -j RETURN
done
for n in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 0.0.0.0/8 224.0.0.0/4; do
  iptables -A AIRA-OUT -d \$n -j REJECT
done
if command -v ip6tables >/dev/null 2>&1; then
  for n in ::1/128 fc00::/7 fe80::/10 ff00::/8; do ip6tables -A AIRA-OUT -d \$n -j REJECT; done
fi
EOF
chmod 755 /usr/local/sbin/aira-firewall
if command -v iptables >/dev/null 2>&1; then
  cat > /etc/systemd/system/aira-firewall.service <<'EOF'
[Unit]
Description=Firewall Aira (blokir localhost & LAN untuk pengguna aira)
Before=aira.service
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/aira-firewall

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable aira-firewall >/dev/null 2>&1
  systemctl restart aira-firewall || warn "Firewall gagal dipasang (lihat: journalctl -u aira-firewall). Lapisan systemd & aplikasi tetap aktif."
else
  warn "iptables tidak ada: lapisan firewall dilewati (lapisan systemd & aplikasi tetap aktif)."
fi

say "5/6 Layanan systemd (sandbox)…"
ALLOW_DNS=""; for d in $DNS_IPS; do ALLOW_DNS="$ALLOW_DNS $d"; done
cat > /etc/systemd/system/aira.service <<EOF
[Unit]
Description=Aira - pendamping 3D (terisolasi)
After=network-online.target aira-firewall.service
Wants=network-online.target aira-firewall.service

[Service]
Type=simple
User=aira
Group=aira
WorkingDirectory=${OPT}/aira
EnvironmentFile=${ENVF}
Environment=HOME=${STATE}
Environment=AIRA_DATA=${STATE}/data
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
Environment=NODE_ENV=production
ExecStart=${NODE} ${OPT}/aira/server.js
Restart=on-failure
RestartSec=3
Nice=5
MemoryMax=1200M
TasksMax=256

# --- Isolasi ---
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ReadWritePaths=${STATE}
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
UMask=0077
# Jaringan: tolak LAN/Tailscale (localhost tetap untuk menerima koneksi dari Tailscale serve;
# koneksi KELUAR ke localhost diblokir oleh aira-firewall)
IPAddressDeny=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10
IPAddressAllow=localhost${ALLOW_DNS}

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable aira >/dev/null 2>&1
systemctl restart aira
sleep 2
systemctl is-active --quiet aira || die "Aira gagal menyala. Lihat: journalctl -u aira -n 40"

say "6/6 Model 3D realistis gratis (Microsoft Rocketbox, MIT)…"
if [ -z "$(ls -A "$STATE/data/model" 2>/dev/null)" ] && [ "${AIRA_MODEL_LEWATI:-}" != "1" ]; then
  sudo -u aira env HOME="$STATE" AIRA_DATA="$STATE/data" "$NODE" "$OPT/aira/ambil-model.mjs" pilihan || warn "Gagal mengunduh sebagian model; ulangi nanti (perintah di bawah)."
else
  echo "Model sudah ada (lewati)."
fi

if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg --https="${SERVE_PORT}" "${PORT}" >/dev/null 2>&1 || warn "Gagal tailscale serve; jalankan manual: sudo tailscale serve --bg --https=${SERVE_PORT} ${PORT}"
fi
HOSTN="$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"

# Uji isolasi singkat
ISO="?"
if sudo -u aira "$NODE" -e 'fetch("http://127.0.0.1:'"$PORT"'/").then(()=>process.exit(1),()=>process.exit(0))' 2>/dev/null; then ISO="✅ aira tidak bisa membuka localhost"; else ISO="⚠️ aira MASIH bisa membuka localhost (cek firewall)"; fi
HOME_ISO="$(sudo -u aira ls "/home/${APP_USER}" >/dev/null 2>&1 && echo '⚠️ aira bisa membaca /home' || echo '✅ aira tidak bisa membaca /home')"

say "Selesai."
cat <<EOF

  Buka dari HP/laptop (Tailscale aktif — HTTPS wajib untuk mikrofon & kamera):
    https://${HOSTN:-<nama-rig>.ts.net}:${SERVE_PORT}
  Kata sandi Aira: lihat $ENVF (AIRA_PASSWORD)

  Isolasi:  ${ISO}
            ${HOME_ISO}

  Perintah:
    sudo systemctl restart aira          journalctl -u aira -f
    sudo -u aira env HOME=$STATE AIRA_DATA=$STATE/data node $OPT/aira/ambil-model.mjs            # daftar model
    sudo -u aira env HOME=$STATE AIRA_DATA=$STATE/data node $OPT/aira/ambil-model.mjs Female_Adult_12
    sudo systemctl disable --now aira aira-firewall                                              # matikan

EOF
