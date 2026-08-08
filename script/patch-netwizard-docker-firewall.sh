#!/usr/bin/env bash
# Prevent luci-app-netwizard from creating a second Docker firewall zone.

set -Eeuo pipefail

SOURCE_DIR="${1:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PATCH_FILE="$SCRIPT_DIR/../patches/netwizard/001-let-dockerd-manage-firewall.patch"
FEED_DIR=""
TARGET_FILE=""
MIGRATION_FILE=""

if [ -z "$SOURCE_DIR" ] || [ ! -f "$SOURCE_DIR/Makefile" ]; then
  echo "错误：未提供有效的OpenWrt源码目录: ${SOURCE_DIR:-未提供}" >&2
  exit 1
fi

SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd -P)"
FEED_DIR="$SOURCE_DIR/feeds/netwizard"
TARGET_FILE="$FEED_DIR/luci-app-netwizard/root/etc/init.d/netwizard"
MIGRATION_FILE="$FEED_DIR/luci-app-netwizard/root/etc/uci-defaults/40-luci-netwizard"

# The feed only exists when the plugin was selected.
if [ ! -d "$FEED_DIR" ]; then
  echo "ℹ️ 未选择网络向导，无需处理Docker防火墙兼容性"
  exit 0
fi

if [ ! -f "$TARGET_FILE" ] || [ ! -f "$MIGRATION_FILE" ]; then
  echo "错误：网络向导源码结构与固定版本不一致" >&2
  exit 1
fi

if [ ! -f "$PATCH_FILE" ]; then
  echo "错误：缺少网络向导兼容补丁: $PATCH_FILE" >&2
  exit 1
fi

if grep -Fq "set firewall.docker_to_wan=forwarding" "$TARGET_FILE" || \
   ! grep -Fq "remove_legacy_docker_zone" "$MIGRATION_FILE"; then
  # The pinned upstream file has one trailing space on this line. Normalize
  # only that marker so the maintained patch remains whitespace-clean.
  sed -i 's/^\(    if \[ -f \/etc\/config\/dockerd \]; then\)[[:space:]]*$/\1/' "$TARGET_FILE"

  if ! git -C "$FEED_DIR" apply --check "$PATCH_FILE"; then
    echo "错误：网络向导Docker防火墙补丁无法应用，上游源码可能已变化" >&2
    exit 1
  fi
  git -C "$FEED_DIR" apply "$PATCH_FILE"
fi

# Fail closed: never build a NetWizard package that can recreate the Docker zone.
if grep -Fq "set firewall.docker_to_wan=forwarding" "$TARGET_FILE" || \
   grep -Fq "add_list firewall.@zone[-1].subnet='172.16.0.0/12'" "$TARGET_FILE"; then
  echo "错误：网络向导仍包含Docker防火墙管理代码，已停止编译" >&2
  exit 1
fi

if ! grep -Fq "official dockerd init script exclusively owns" "$TARGET_FILE"; then
  echo "错误：网络向导Docker防火墙补丁状态无法确认" >&2
  exit 1
fi

if ! grep -Fq "remove_legacy_docker_zone" "$MIGRATION_FILE" || \
   ! grep -Fq "uci -q delete firewall.docker_to_wan" "$MIGRATION_FILE"; then
  echo "错误：网络向导旧Docker防火墙配置迁移未生效" >&2
  exit 1
fi

echo "✅ 已禁用网络向导的Docker防火墙管理，保留官方Dockerd唯一配置"
