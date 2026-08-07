#!/usr/bin/env bash
# 为GitHub Actions和本地服务器生成并验证相同的x86_64编译配置。

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR=""
PLUGINS_LIST=""
ROOTFS_PARTSIZE="512"
ENABLE_CCACHE=false

show_help() {
  cat <<'EOF'
用法:
  configure-x86-build.sh --source-dir PATH [--plugins LIST] [--rootfs SIZE] [--ccache]

参数:
  --source-dir PATH  已完成feeds安装的OpenWrt源码目录
  --plugins LIST     逗号分隔的插件名称
  --rootfs SIZE      EXT4根分区容量，单位MiB（128–4096）
  --ccache           启用OpenWrt编译缓存（本地服务器推荐）
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --source-dir)
      SOURCE_DIR="${2:-}"
      shift 2
      ;;
    --plugins)
      PLUGINS_LIST="${2:-}"
      shift 2
      ;;
    --rootfs)
      ROOTFS_PARTSIZE="${2:-}"
      shift 2
      ;;
    --ccache)
      ENABLE_CCACHE=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "错误：未知参数: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ] || [ ! -f "$SOURCE_DIR/Makefile" ] || [ ! -x "$SOURCE_DIR/scripts/feeds" ]; then
  echo "错误：--source-dir不是完整的OpenWrt源码目录: ${SOURCE_DIR:-未提供}" >&2
  exit 1
fi

if [[ ! "$ROOTFS_PARTSIZE" =~ ^[0-9]+$ ]] ||
   (( ROOTFS_PARTSIZE < 128 || ROOTFS_PARTSIZE > 4096 )); then
  echo "错误：根分区容量必须是128–4096之间的整数，当前值: $ROOTFS_PARTSIZE" >&2
  exit 1
fi

SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd -P)"
cd "$SOURCE_DIR"

echo "🔧 开始生成最终编译配置..."
echo "生成x86_64基础配置..."
cat > .config <<'EOF'
CONFIG_TARGET_x86=y
CONFIG_TARGET_x86_64=y
# 新版源码使用DEVICE_generic；Lienol 19.07仍使用旧Profile符号Generic。
CONFIG_TARGET_x86_64_DEVICE_generic=y
CONFIG_TARGET_x86_64_Generic=y
# LuCI翻译包是隐藏配置，必须通过语言总开关启用。
CONFIG_LUCI_LANG_zh_Hans=y
EOF
echo "CONFIG_TARGET_ROOTFS_PARTSIZE=$ROOTFS_PARTSIZE" >> .config
if [ "$ENABLE_CCACHE" = "true" ]; then
  # OpenWrt将CCACHE放在开发者高级选项中；未启用DEVEL时，
  # make defconfig会自动丢弃CONFIG_CCACHE。
  echo 'CONFIG_DEVEL=y' >> .config
  echo 'CONFIG_CCACHE=y' >> .config
fi

RECOMMENDED_PLUGINS=(
  luci kmod-e1000 kmod-e1000e kmod-igb kmod-r8169
  block-mount kmod-wireguard wireguard-tools
)
USER_PLUGINS=()
if [ -n "$PLUGINS_LIST" ]; then
  IFS=',' read -ra USER_PLUGINS <<< "$PLUGINS_LIST"
fi

KVM_CPU_PACKAGES=()
RUNTIME_DISABLED_FEEDS=()
COMPANION_PLUGINS=()
REQUIRED_PLUGIN_CONFIGS=()
BANDIX_SELECTED=false
PASSWALL_SELECTED=false

for plugin in "${USER_PLUGINS[@]}"; do
  if [[ ! "$plugin" =~ ^[a-zA-Z0-9][a-zA-Z0-9._+-]*$ ]]; then
    echo "错误：无效的插件名称: $plugin" >&2
    exit 1
  fi

  case "$plugin" in
    kmod-kvm-intel|kmod-kvm-amd)
      KVM_CPU_PACKAGES+=("$plugin")
      ;;
    luci-app-passwall)
      COMPANION_PLUGINS+=(hysteria luci-i18n-passwall-zh-cn)
      REQUIRED_PLUGIN_CONFIGS+=(CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Hysteria=y)
      RUNTIME_DISABLED_FEEDS+=(passwall passwall_packages)
      PASSWALL_SELECTED=true
      ;;
    luci-app-diskman)
      RUNTIME_DISABLED_FEEDS+=(diskman)
      ;;
    luci-app-bandix)
      RUNTIME_DISABLED_FEEDS+=(bandix bandix_luci)
      BANDIX_SELECTED=true
      ;;
    luci-app-netwizard)
      COMPANION_PLUGINS+=(luci-i18n-netwizard-zh-cn luci-ssl openssl-util)
      RUNTIME_DISABLED_FEEDS+=(netwizard)
      ;;
    luci-theme-argon)
      COMPANION_PLUGINS+=(luci-app-argon-config)
      ;;
  esac
done

if (( ${#KVM_CPU_PACKAGES[@]} > 1 )); then
  echo "错误：kmod-kvm-intel与kmod-kvm-amd不能同时选择" >&2
  exit 1
fi

if (( ${#KVM_CPU_PACKAGES[@]} == 1 )); then
  RECOMMENDED_PLUGINS+=(kmod-kvm-x86)
  KVM_VENDOR="${KVM_CPU_PACKAGES[0]#kmod-kvm-}"
  echo "🖥️ 配置${KVM_VENDOR} KVM宿主支持..."
  bash "$SCRIPT_DIR/enable-kvm-host.sh" "$KVM_VENDOR" "$SOURCE_DIR"
fi

mapfile -t ALL_PLUGINS < <(
  printf '%s\n' "${RECOMMENDED_PLUGINS[@]}" "${USER_PLUGINS[@]}" "${COMPANION_PLUGINS[@]}" |
    sed '/^$/d' | sort -u
)

echo "🔧 配置选中的插件..."
for plugin in "${ALL_PLUGINS[@]}"; do
  echo "CONFIG_PACKAGE_$plugin=y" >> .config
  echo "  ✓ 添加插件: $plugin"
done

for config_item in "${REQUIRED_PLUGIN_CONFIGS[@]}"; do
  echo "$config_item" >> .config
  echo "  ✓ 添加功能配置: $config_item"
done

for feed in "${RUNTIME_DISABLED_FEEDS[@]}"; do
  echo "CONFIG_FEED_${feed}=m" >> .config
  echo "  ✓ 禁用无效的运行时软件源: $feed"
done

if [ "$BANDIX_SELECTED" = "true" ]; then
  echo '# CONFIG_PACKAGE_luci-app-turboacc is not set' >> .config
fi

if [ "$PASSWALL_SELECTED" = "true" ]; then
  # PassWall依赖dnsmasq-full。OpenWrt默认的dnsmasq（以及部分分支的
  # dnsmasq-dhcpv6）会安装同名文件，必须在defconfig前明确替换。
  cat >> .config <<'EOF'
# CONFIG_PACKAGE_dnsmasq is not set
# CONFIG_PACKAGE_dnsmasq-dhcpv6 is not set
CONFIG_PACKAGE_dnsmasq-full=y
EOF
  echo "  ✓ PassWall已使用dnsmasq-full替换默认dnsmasq"
fi

# 通过首次启动脚本设置所有受支持源码分支通用的默认网络和登录信息。
# OpenWrt固定使用root管理账户，因此只需要配置root密码。
mkdir -p files/etc/uci-defaults
cat > files/etc/uci-defaults/99-build-openwrt-defaults <<'EOF'
#!/bin/sh

# uci-defaults在升级后的首次启动也会运行。检测到root已有可用密码时，
# 视为正在保留现有配置，避免重置用户的管理地址和登录密码。
ROOT_PASSWORD_HASH="$(awk -F: '$1 == "root" { print $2; exit }' /etc/shadow 2>/dev/null)"
case "$ROOT_PASSWORD_HASH" in
  ''|'!'|'*') ;;
  *)
    logger -t build-openwrt-defaults 'existing root password detected; keeping current settings'
    exit 0
    ;;
esac

if ! uci -q set network.lan.ipaddr='10.0.0.1' ||
   ! uci -q commit network; then
  logger -t build-openwrt-defaults 'failed to set the default LAN address'
  exit 1
fi

PASSWORD_SET=false
if command -v chpasswd >/dev/null 2>&1 &&
   printf '%s\n' 'root:root' | chpasswd; then
  PASSWORD_SET=true
elif printf '%s\n%s\n' 'root' 'root' | passwd root >/dev/null 2>&1; then
  PASSWORD_SET=true
fi

if [ "$PASSWORD_SET" != "true" ]; then
  logger -t build-openwrt-defaults 'failed to set the root password'
  exit 1
fi

exit 0
EOF
chmod 0755 files/etc/uci-defaults/99-build-openwrt-defaults
echo "✅ 默认管理设置：IP 10.0.0.1，用户名 root，密码 root"

make defconfig

if [ "$PASSWALL_SELECTED" = "true" ]; then
  if ! grep -qx 'CONFIG_PACKAGE_dnsmasq-full=y' .config; then
    echo "错误：PassWall所需的dnsmasq-full未成功启用" >&2
    exit 1
  fi

  if grep -Eq '^CONFIG_PACKAGE_(dnsmasq|dnsmasq-dhcpv6)=y$' .config; then
    echo "错误：dnsmasq变体发生冲突，PassWall只能与dnsmasq-full一起编译" >&2
    grep -E '^CONFIG_PACKAGE_dnsmasq[^=]*=y$' .config >&2 || true
    exit 1
  fi

  echo "✅ PassWall DNS依赖检查通过：仅启用dnsmasq-full"
fi

if [ "$BANDIX_SELECTED" = "true" ]; then
  if grep -qx 'CONFIG_PACKAGE_luci-app-turboacc=y' .config; then
    echo "错误：Bandix与Turbo ACC不能同时启用" >&2
    exit 1
  fi

  mkdir -p files/etc/uci-defaults
  cat > files/etc/uci-defaults/99-bandix-disable-hw-offload <<'EOF'
#!/bin/sh
uci -q set firewall.@defaults[0].flow_offloading_hw='0'
uci -q commit firewall
exit 0
EOF
  chmod 0755 files/etc/uci-defaults/99-bandix-disable-hw-offload
  echo "✅ 已配置Bandix：禁用硬件流量卸载和Turbo ACC"
fi

if grep -qx 'CONFIG_PER_FEED_REPO=y' .config; then
  for feed in "${RUNTIME_DISABLED_FEEDS[@]}"; do
    if ! grep -qx "CONFIG_FEED_${feed}=m" .config; then
      echo "错误：未能禁用运行时软件源: $feed" >&2
      exit 1
    fi
  done
elif (( ${#RUNTIME_DISABLED_FEEDS[@]} > 0 )); then
  echo "ℹ️ 当前源码未启用独立feed仓库，不会写入第三方运行时软件源"
fi

REQUIRED_X86_CONFIG=(
  CONFIG_TARGET_x86=y
  CONFIG_TARGET_x86_64=y
)
for config_item in "${REQUIRED_X86_CONFIG[@]}"; do
  if ! grep -qx "$config_item" .config; then
    echo "错误：x86_64目标配置未生效: $config_item" >&2
    exit 1
  fi
done

if ! grep -Eq '^CONFIG_TARGET_x86_64_(DEVICE_generic|Generic)=y$' .config; then
  echo "错误：x86_64 Generic设备配置未生效" >&2
  exit 1
fi

if ! grep -qx "CONFIG_TARGET_ROOTFS_PARTSIZE=$ROOTFS_PARTSIZE" .config; then
  echo "错误：根分区容量配置未生效: ${ROOTFS_PARTSIZE} MiB" >&2
  exit 1
fi

if [ "$ENABLE_CCACHE" = "true" ] && ! grep -qx 'CONFIG_CCACHE=y' .config; then
  echo "错误：OpenWrt编译缓存配置未生效" >&2
  exit 1
fi

for plugin in "${RECOMMENDED_PLUGINS[@]}"; do
  if ! grep -qx "CONFIG_PACKAGE_${plugin}=y" .config; then
    echo "错误：x86_64基础包不存在或未成功启用: $plugin" >&2
    exit 1
  fi
done

for plugin in "${COMPANION_PLUGINS[@]}"; do
  if ! grep -qx "CONFIG_PACKAGE_${plugin}=y" .config; then
    echo "错误：配套插件不存在或未成功启用: $plugin" >&2
    exit 1
  fi
  echo "  ✅ 已启用配套插件: $plugin"
done

for config_item in "${REQUIRED_PLUGIN_CONFIGS[@]}"; do
  if ! grep -qx "$config_item" .config; then
    echo "错误：插件功能配置不存在或未成功启用: $config_item" >&2
    exit 1
  fi
  echo "  ✅ 已启用插件功能: $config_item"
done

CONFIG_ERRORS=0
for plugin in "${USER_PLUGINS[@]}"; do
  if grep -qx "CONFIG_PACKAGE_${plugin}=y" .config; then
    echo "  ✅ 已启用用户插件: $plugin"
  else
    echo "错误：插件不存在或未成功启用: $plugin" >&2
    CONFIG_ERRORS=$((CONFIG_ERRORS + 1))
  fi
done

if (( CONFIG_ERRORS != 0 )); then
  echo "错误：共有 $CONFIG_ERRORS 个用户插件未进入最终配置" >&2
  exit 1
fi

echo "🔍 检查当前源码分支所需的主机编译依赖..."
make prereq

echo "📋 最终配置文件预览："
grep -m 20 -E '^CONFIG_TARGET|^CONFIG_PACKAGE.*=y' .config
echo "✅ 编译配置生成完成"
