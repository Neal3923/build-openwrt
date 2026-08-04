#!/usr/bin/env bash
# Ubuntu 24.04本地OpenWrt编译环境安装器。不会卸载服务器现有软件。

set -Eeuo pipefail

CHECK_ONLY=false
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=true
elif (( $# > 0 )); then
  echo "用法: $0 [--check]" >&2
  exit 1
fi

if [ ! -r /etc/os-release ]; then
  echo "错误：无法识别服务器系统；当前仅支持Ubuntu 24.04。" >&2
  exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
  echo "错误：当前仅支持Ubuntu 24.04，检测到: ${PRETTY_NAME:-未知系统}" >&2
  exit 1
fi

REQUIRED_COMMANDS=(
  bison ccache cmake dtc flex flock g++ gawk gcc git make msgfmt
  mksquashfs perl python3 rsync svn swig unzip
)

check_commands() {
  local missing=()
  local command_name
  for command_name in "${REQUIRED_COMMANDS[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing+=("$command_name")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    echo "缺少编译工具: ${missing[*]}" >&2
    return 1
  fi
}

if [ "$CHECK_ONLY" = "true" ]; then
  check_commands
  echo "✅ 本地编译环境检查通过"
  exit 0
fi

if (( EUID == 0 )); then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  echo "错误：请使用root执行，或为当前账号安装并配置sudo。" >&2
  exit 1
fi

if ! grep -RqsE '^[[:space:]]*(deb |Types:[[:space:]]*deb)' \
  /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  echo "错误：未找到有效的APT软件源配置。" >&2
  exit 1
fi

echo "📋 系统: $PRETTY_NAME"
echo "🧠 CPU核心: $(nproc)"
free -h
df -h /

AVAILABLE_KB=$(df -Pk / | awk 'NR == 2 { print $4 }')
if (( AVAILABLE_KB < 40 * 1024 * 1024 )); then
  echo "警告：根分区可用空间少于40 GiB，完整编译可能失败。" >&2
fi

APT_GET=("${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3)
echo "🔄 更新软件包列表..."
"${APT_GET[@]}" update

BUILD_PACKAGES=(
  ack antlr3 asciidoc autoconf automake autopoint binutils bison
  build-essential bzip2 ccache clang cmake cpio curl
  device-tree-compiler ecj fastjar file flex g++-multilib gawk
  gcc-multilib genisoimage gettext git gperf gzip haveged help2man
  intltool libc6-dev-i386 libelf-dev libfuse-dev libglib2.0-dev
  libgmp-dev libgnutls28-dev libltdl-dev libmpc-dev libmpfr-dev
  libncurses-dev libnsl-dev libpython3-dev libreadline-dev libssl-dev
  libtool libyaml-dev lld llvm lrzsz msmtp ninja-build p7zip-full
  patch perl pkgconf python3 python3-dev python3-docutils python3-pip
  python3-ply python3-pyelftools python3-setuptools python3-wheel
  qemu-utils re2c rsync scons squashfs-tools subversion swig tar
  texinfo time uglifyjs unzip upx-ucl wget xmlto xsltproc xxd yasm
  zlib1g-dev zstd
)

echo "📦 安装OpenWrt编译依赖..."
"${APT_GET[@]}" install -y --no-install-recommends "${BUILD_PACKAGES[@]}"
"${APT_GET[@]}" clean

check_commands

echo "✅ 本地编译环境安装完成"
echo "注意：正式编译必须切换到普通用户，不能使用root运行local-build.sh。"
echo "下一步：使用网页生成的命令，或执行 bash ./script/local-build.sh --help"
