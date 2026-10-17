#!/usr/bin/env bash
# Assemble the deployable static site into public/ (this is what Cloudflare Pages runs).
#
#   bash scripts/build-site.sh
#
# 1. copies site/ (the app) to public/
# 2. copies the compiled engine (pikafish-web/dist) to public/engine/
# 3. downloads pikafish.nnue (~48 MB), verifies its sha256 against engine/nnue.lock,
#    splits it into < 20 MiB chunks (Cloudflare Pages has a 25 MiB per-file limit)
#    and writes public/engine/nnue-manifest.json for the loader.
#
# Env: NNUE_URL  — override download URL (e.g. a pinned copy on your own GitHub Release)
#      NNUE_FILE — use a local file instead of downloading
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=public
LOCK=engine/nnue.lock                 # "<sha256>  pikafish.nnue"
NNUE_URL=${NNUE_URL:-https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue}
CHUNK=$((20 * 1024 * 1024))

rm -rf "$OUT"
mkdir -p "$OUT/engine"
cp -r site/. "$OUT/"
cp pikafish-web/dist/pikafish.js pikafish-web/dist/pikafish.wasm "$OUT/engine/"
[ -f pikafish-web/dist/pikafish.worker.js ] && cp pikafish-web/dist/pikafish.worker.js "$OUT/engine/"

# --- network file -----------------------------------------------------------
expected=$(cut -d' ' -f1 "$LOCK")
cache=.cache/pikafish-$expected.nnue
mkdir -p .cache
if [ -n "${NNUE_FILE:-}" ]; then
  cp "$NNUE_FILE" "$cache"
elif [ ! -f "$cache" ]; then
  echo "downloading $NNUE_URL"
  curl -fsSL --retry 3 -o "$cache.tmp" "$NNUE_URL" && mv "$cache.tmp" "$cache"
fi
actual=$(sha256sum "$cache" | cut -d' ' -f1)
if [ "$actual" != "$expected" ]; then
  rm -f "$cache"
  echo "ERROR: pikafish.nnue sha256 mismatch." >&2
  echo "  expected $expected (engine/nnue.lock)" >&2
  echo "  got      $actual" >&2
  echo "The upstream 'master-net' network changed. Either pin NNUE_URL to a copy of the old file," >&2
  echo "or rebuild pikafish-web against the matching Pikafish commit and update engine/nnue.lock." >&2
  exit 1
fi

short=${expected:0:12}
size=$(stat -c %s "$cache" 2>/dev/null || stat -f %z "$cache")
split -b "$CHUNK" -d -a 2 "$cache" "$OUT/engine/pikafish-$short.nnue.part"
parts=$(ls "$OUT/engine/" | grep "pikafish-$short.nnue.part" | sort)
{
  echo '{'
  echo "  \"name\": \"pikafish.nnue\","
  echo "  \"sha256\": \"$expected\","
  echo "  \"size\": $size,"
  echo '  "chunks": ['
  first=1
  for p in $parts; do
    [ $first = 1 ] || echo ','
    first=0
    printf '    "%s"' "$p"
  done
  echo
  echo '  ]'
  echo '}'
} > "$OUT/engine/nnue-manifest.json"

echo "site assembled in $OUT/:"
du -sh "$OUT" "$OUT/engine"
cat "$OUT/engine/nnue-manifest.json"
