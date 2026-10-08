#!/usr/bin/env bash
# Build + deploy situs. Pemakaian:
#   ./deploy.sh pages            # deploy ke Cloudflare Pages (butuh wrangler + token)
#   ./deploy.sh local /var/www/layar-klasik   # salin ke folder web server di VPS
#   ./deploy.sh build            # hanya build
# Variabel: PROJECT (nama proyek Pages, default layar-klasik), SAMPLE=1 (pakai data contoh)
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-build}"
PROJECT="${PROJECT:-layar-klasik}"

command -v node >/dev/null || { echo "Node.js belum terpasang (butuh >= 22)"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Butuh Node >= 22"; exit 1; }

if grep -q 'contoh-domain-anda' config.json; then
  echo "PERINGATAN: siteUrl di config.json masih domain contoh. Canonical dan sitemap akan salah." >&2
  [ "${ALLOW_PLACEHOLDER:-0}" = 1 ] || { echo "Ubah siteUrl, atau set ALLOW_PLACEHOLDER=1 untuk uji coba." >&2; exit 1; }
fi

# nice supaya mining tidak terganggu
BUILD_ARGS=()
[ "${SAMPLE:-0}" = 1 ] && BUILD_ARGS+=(--sample)
nice -n 19 node build.js "${BUILD_ARGS[@]}"

case "$MODE" in
  build) echo "Selesai build: dist/" ;;
  pages)
    : "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (izin: Cloudflare Pages Edit)}"
    : "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
    nice -n 19 npx --yes wrangler pages deploy dist --project-name="$PROJECT" --commit-dirty=true
    ;;
  local)
    TARGET="${2:?Sebutkan folder tujuan, mis. /var/www/layar-klasik}"
    mkdir -p "$TARGET"
    if command -v rsync >/dev/null; then rsync -a --delete dist/ "$TARGET"/
    else rm -rf "${TARGET:?}"/* && cp -a dist/. "$TARGET"/; fi
    echo "Disalin ke $TARGET"
    ;;
  *) echo "Mode tidak dikenal: $MODE"; exit 1 ;;
esac
