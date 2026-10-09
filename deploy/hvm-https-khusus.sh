#!/usr/bin/env bash
# (Opsional, lanjutan) Memberi HvM AI alamat HTTPS sendiri: https://hvm-ai.<tailnet>.ts.net
# Caranya menjalankan node Tailscale KEDUA khusus HvM AI, dengan "userspace networking"
# sehingga TIDAK membuat perangkat jaringan baru dan TIDAK mengganggu mining/rute rig.
# Node utama (Kantor PGA + HvM AI di :8443) tetap jalan apa adanya.
#
#   curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/hvm-https-khusus.sh | sudo bash
#
# Opsi: HVM_HOSTNAME=hvm-ai  PORT=3001  TS_AUTHKEY=tskey-...   (authkey opsional; tanpa itu, login lewat tautan)
set -euo pipefail
HVM_HOSTNAME="${HVM_HOSTNAME:-hvm-ai}"
PORT="${PORT:-3001}"
STATE=/var/lib/tailscale-hvm
SOCK=/run/tailscale-hvm/tailscaled.sock

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "Jalankan dengan sudo."
TSD="$(command -v tailscaled || echo /usr/sbin/tailscaled)"
TS="$(command -v tailscale || echo /usr/bin/tailscale)"
[ -x "$TSD" ] || die "tailscaled tidak ditemukan. Pasang Tailscale dulu (ada di installer utama)."

mkdir -p "$STATE" "$(dirname "$SOCK")"

say "Membuat layanan node Tailscale kedua (userspace) untuk HvM AI…"
cat > /etc/systemd/system/tailscaled-hvm.service <<EOF
[Unit]
Description=Tailscale node khusus HvM AI (userspace)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${TSD} --tun=userspace-networking --statedir=${STATE} --socket=${SOCK} --port=0
Restart=on-failure
RestartSec=3
Nice=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tailscaled-hvm
sleep 2

say "Mendaftarkan node '${HVM_HOSTNAME}' ke tailnet Anda…"
if [ -n "${TS_AUTHKEY:-}" ]; then
  "$TS" --socket="$SOCK" up --hostname="$HVM_HOSTNAME" --authkey="$TS_AUTHKEY" --accept-dns=false
else
  say "Buka tautan di bawah di HP/laptop, login dengan akun Tailscale yang sama, lalu setujui:"
  "$TS" --socket="$SOCK" up --hostname="$HVM_HOSTNAME" --accept-dns=false
fi

say "Menyajikan HvM AI di HTTPS (port 443 node ini) → http://127.0.0.1:${PORT}…"
"$TS" --socket="$SOCK" serve --bg --https=443 "${PORT}" \
  || die "Gagal serve. Pastikan HTTPS/MagicDNS aktif di https://login.tailscale.com/admin/dns, lalu ulangi."

HOSTN="$("$TS" --socket="$SOCK" status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"
say "Selesai."
cat <<EOF

  HvM AI kini punya alamat HTTPS sendiri:
    https://${HOSTN:-${HVM_HOSTNAME}.<tailnet>.ts.net}

  (Alamat lama https://<nama-rig>.ts.net:8443 tetap jalan juga.)
  Bagikan alamat baru + kata sandi HvM AI ke teman. Jangan beri kunci pemilik.

  Perintah:
    tailscale --socket=${SOCK} status        # cek node HvM AI
    sudo systemctl restart tailscaled-hvm     # restart node HvM AI
    sudo systemctl disable --now tailscaled-hvm  # matikan alamat khusus (kembali ke :8443)

EOF
