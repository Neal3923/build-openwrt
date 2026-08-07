#!/usr/bin/env bash
# Backport the official rpcd helper only when a LuCI branch contains
# luci-app-radicale3 without its required rpcd-mod-rad3-enc package.

set -Eeuo pipefail

SOURCE_DIR="${1:-}"

if [ -z "$SOURCE_DIR" ] || [ ! -f "$SOURCE_DIR/Makefile" ]; then
  echo "错误：未提供有效的OpenWrt源码目录: ${SOURCE_DIR:-未提供}" >&2
  exit 1
fi

SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd -P)"

RADICALE_APP_MAKEFILE="$(
  find "$SOURCE_DIR/feeds" "$SOURCE_DIR/package" \
    -type f -path '*/luci-app-radicale3/Makefile' -print -quit \
    2>/dev/null || true
)"
if [ -z "$RADICALE_APP_MAKEFILE" ]; then
  echo "ℹ️ 当前源码不包含luci-app-radicale3，无需补充rpcd模块"
  exit 0
fi

EXISTING_MODULE_MAKEFILE="$(
  find "$SOURCE_DIR/feeds" "$SOURCE_DIR/package" \
    -type f -path '*/rpcd-mod-rad3-enc/Makefile' -print -quit \
    2>/dev/null || true
)"
if [ -n "$EXISTING_MODULE_MAKEFILE" ]; then
  echo "✅ 源码已包含rpcd-mod-rad3-enc: ${EXISTING_MODULE_MAKEFILE#"$SOURCE_DIR"/}"
  exit 0
fi

for required_command in curl sha256sum; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "错误：补充rpcd-mod-rad3-enc需要命令: $required_command" >&2
    exit 1
  fi
done

# Official OpenWrt LuCI commit from merged PR #8216.  The two hashes pin the
# exact source files so a changed or incomplete download is never accepted.
UPSTREAM_COMMIT="7e25a5c32a76b1a4e2904d54e24cc852df2a3ceb"
UPSTREAM_BASE="https://raw.githubusercontent.com/openwrt/luci/$UPSTREAM_COMMIT/libs/rpcd-mod-rad3-enc"
MAKEFILE_SHA256="d4d5ada516271c8d79f57a2e060344798f84fb17c40a27c6b0a7fc2c04cc4034"
RPC_SCRIPT_SHA256="439094012e1ed3788e538f38c7cd3a782aa2affcd287817c92f35fa311c3dad3"

PACKAGE_ROOT="$SOURCE_DIR/package/community"
PACKAGE_DIR="$PACKAGE_ROOT/rpcd-mod-rad3-enc"
mkdir -p "$PACKAGE_ROOT"

if [ -e "$PACKAGE_DIR" ] || [ -L "$PACKAGE_DIR" ]; then
  echo "错误：rpcd模块目标路径已存在但缺少Makefile，拒绝覆盖: $PACKAGE_DIR" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "$PACKAGE_ROOT/.rpcd-mod-rad3-enc.XXXXXX")"
cleanup() {
  if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

download_verified_file() {
  local relative_path="$1"
  local expected_hash="$2"
  local output_path="$TEMP_DIR/$relative_path"

  mkdir -p "$(dirname -- "$output_path")"
  curl --fail --location --silent --show-error \
    --retry 3 --retry-delay 2 --retry-all-errors --connect-timeout 20 \
    --output "$output_path" "$UPSTREAM_BASE/$relative_path"

  printf '%s  %s\n' "$expected_hash" "$output_path" | sha256sum -c - >/dev/null
}

echo "🧩 当前LuCI分支缺少rpcd-mod-rad3-enc，补充固定的官方版本..."
download_verified_file Makefile "$MAKEFILE_SHA256"
download_verified_file files/rad3-enc "$RPC_SCRIPT_SHA256"
chmod 0755 "$TEMP_DIR/files/rad3-enc"

mv -- "$TEMP_DIR" "$PACKAGE_DIR"
TEMP_DIR=""

grep -qx 'PKG_NAME:=rpcd-mod-rad3-enc' "$PACKAGE_DIR/Makefile"
grep -qx 'PKG_VERSION:=20260109' "$PACKAGE_DIR/Makefile"
echo "✅ 已补充官方rpcd-mod-rad3-enc（提交 $UPSTREAM_COMMIT）"
