#!/usr/bin/env bash
# Pembaruan otomatis Kantor PGA. Dijalankan timer systemd "kantor-pga-perbarui" tiap 5 menit.
# Bila ada commit baru di GitHub: tarik, pasang ulang dependensi bila berubah, restart layanan.
# Tidak me-restart saat tim sedang mengerjakan tugas (ditunda ke putaran berikutnya).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/user/kantor-pga}"
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"
BRANCH="${BRANCH:-$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"
as_user() { sudo -H -u "$APP_USER" env "PATH=$PATH" "$@"; }
log() { echo "[perbarui] $*"; }

cd "$APP_DIR"
as_user git fetch -q origin "$BRANCH" || { log "Gagal menghubungi GitHub, coba lagi nanti."; exit 0; }
LOCAL="$(as_user git rev-parse HEAD)"
REMOTE="$(as_user git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0

FLAG="$APP_DIR/hasil/.tugas-berjalan"
if [ -f "$FLAG" ] && [ $(( $(date +%s) - $(stat -c %Y "$FLAG") )) -lt 7200 ]; then
  log "Versi baru ${REMOTE:0:7} tersedia, tetapi tim sedang bekerja. Ditunda."
  exit 0
fi

CHANGED="$(as_user git diff --name-only "$LOCAL" "$REMOTE")"
if ! as_user git merge -q --ff-only "origin/$BRANCH"; then
  log "Tidak bisa memperbarui otomatis: ada perubahan lokal di $APP_DIR. Jalankan 'git -C $APP_DIR status' untuk melihatnya."
  exit 1
fi
if grep -qE '^package(-lock)?\.json$' <<<"$CHANGED"; then
  log "Dependensi berubah, menjalankan npm install…"
  as_user npm install --omit=dev --no-audit --no-fund --loglevel=error
fi
systemctl restart kantor-pga
# Restart juga HvM AI (HvM AI) bila terpasang, agar ikut versi baru.
if systemctl list-unit-files 2>/dev/null | grep -q "^ngobrol.service"; then systemctl restart ngobrol || true; fi
log "Diperbarui ${LOCAL:0:7} → ${REMOTE:0:7} dan layanan di-restart."
