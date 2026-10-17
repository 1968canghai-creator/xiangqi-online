#!/usr/bin/env bash
# Build Pikafish as WebAssembly, reproducibly.
#   ./build.sh            # clone Pikafish at the pinned commit, apply the patch, build into dist/
#   PIKAFISH_REF=master ./build.sh   # try a newer upstream commit (patch may need refreshing)
# Needs: git, make, em++ on PATH (Emscripten 3.1.x or newer; tested with 3.1.6 and CI emsdk).
set -euo pipefail
cd "$(dirname "$0")"

PIKAFISH_REPO=${PIKAFISH_REPO:-https://github.com/official-pikafish/Pikafish.git}
PIKAFISH_REF=${PIKAFISH_REF:-ce9fb8391b32fa8aa3beefaa6ecdd1c1d438b185}   # master @ 2026-10-14
SRC_DIR=${SRC_DIR:-third_party/Pikafish}

command -v em++ >/dev/null || { echo "em++ not found: install/activate Emscripten (emsdk) first" >&2; exit 1; }

if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --filter=blob:none "$PIKAFISH_REPO" "$SRC_DIR"
fi
git -C "$SRC_DIR" fetch --depth 1 origin "$PIKAFISH_REF" 2>/dev/null || git -C "$SRC_DIR" fetch origin
git -C "$SRC_DIR" checkout -q --force "$PIKAFISH_REF"
PATCH="$PWD/patches/pikafish-web.patch"
git -C "$SRC_DIR" apply --check "$PATCH"
git -C "$SRC_DIR" apply "$PATCH"
echo "applied patches/pikafish-web.patch on $(git -C "$SRC_DIR" rev-parse --short HEAD)"

# Does this toolchain still link a plain `int main(int, char**)`? (clang>=15 renames it to
# __main_argc_argv; Emscripten <= 3.1.7 drivers don't know that and need src/main_shim.cpp.)
MAIN_SHIM=0
tmp=$(mktemp -d)
printf 'int main(int argc, char**) { return argc; }\n' > "$tmp/t.cpp"
if ! em++ -pthread -sPROXY_TO_PTHREAD "$tmp/t.cpp" -o "$tmp/t.js" >/dev/null 2>&1; then MAIN_SHIM=1; echo "toolchain needs main() shim"; fi
rm -rf "$tmp"

make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)" PIKAFISH="$SRC_DIR" OUT=dist MAIN_SHIM=$MAIN_SHIM
ls -la dist/
echo
echo "Done. Network file (not bundled, ~48 MB):"
echo "  https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue"
