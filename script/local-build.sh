#!/usr/bin/env bash
# 在Ubuntu 24.04本地服务器完整编译x86_64 OpenWrt固件，不依赖GitHub Actions。

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

SOURCE_BRANCH="openwrt-main"
REQUESTED_REPO_BRANCH="auto"
ROOTFS_PARTSIZE="512"
PLUGINS_LIST=""
BUILD_ROOT="${LOCAL_BUILD_ROOT:-$HOME/build-openwrt-local}"
DRY_RUN=false
CLEANUP_ONLY=false

show_help() {
  cat <<'EOF'
用法:
  local-build.sh [选项]

选项:
  --source NAME       源码类型：openwrt-main、lede-master、immortalwrt-master、Lienol-master
  --branch NAME       实际分支或版本；默认使用所选源码的默认分支
  --rootfs SIZE       EXT4根分区容量，单位MiB（128–4096，默认512）
  --plugins LIST      逗号分隔的插件名称
  --build-root PATH   本地运行、缓存和产物根目录
  --dry-run           仅验证并显示配置，不克隆或编译
  --cleanup-only      仅执行超过24小时的旧运行目录安全清理
  -h, --help          显示帮助

示例:
  bash ./script/local-build.sh --source openwrt-main --branch openwrt-24.10 \
    --rootfs 1024 --plugins "luci-app-passwall,luci-app-diskman"

目录:
  runs/    每次编译的独立源码目录，超过24小时后安全清理
  cache/   下载缓存和ccache，不自动删除
  output/  最终固件、校验文件和日志，不自动删除

要求:
  必须使用普通用户运行；请勿使用root编译OpenWrt。
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --source)
      SOURCE_BRANCH="${2:-}"
      shift 2
      ;;
    --branch)
      REQUESTED_REPO_BRANCH="${2:-}"
      shift 2
      ;;
    --rootfs)
      ROOTFS_PARTSIZE="${2:-}"
      shift 2
      ;;
    --plugins)
      PLUGINS_LIST="${2:-}"
      shift 2
      ;;
    --build-root)
      BUILD_ROOT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --cleanup-only)
      CLEANUP_ONLY=true
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

if (( EUID == 0 )); then
  echo "错误：禁止使用root运行本地编译。" >&2
  echo "请切换到普通用户后重新运行（例如：sudo -iu actions）。" >&2
  exit 1
fi

if [[ ! "$ROOTFS_PARTSIZE" =~ ^[0-9]+$ ]] ||
   (( ROOTFS_PARTSIZE < 128 || ROOTFS_PARTSIZE > 4096 )); then
  echo "错误：根分区容量必须是128–4096之间的整数，当前值: $ROOTFS_PARTSIZE" >&2
  exit 1
fi

REQUESTED_PLUGINS=()
read -ra RAW_PLUGINS <<< "${PLUGINS_LIST//,/ }"
declare -A SEEN_PLUGINS=()
for plugin in "${RAW_PLUGINS[@]}"; do
  if [[ ! "$plugin" =~ ^[a-zA-Z0-9][a-zA-Z0-9._+-]*$ ]]; then
    echo "错误：无效的插件名称: $plugin" >&2
    exit 1
  fi
  if [ -z "${SEEN_PLUGINS[$plugin]+x}" ]; then
    REQUESTED_PLUGINS+=("$plugin")
    SEEN_PLUGINS["$plugin"]=1
  fi
done
PLUGINS_LIST=$(IFS=,; echo "${REQUESTED_PLUGINS[*]}")

case "$SOURCE_BRANCH" in
  openwrt-main)
    REPO_URL="https://github.com/openwrt/openwrt"
    DEFAULT_REPO_BRANCH="main"
    ALLOWED_REPO_BRANCHES="main openwrt-25.12 openwrt-24.10 openwrt-23.05"
    SOURCE_NAME="OpenWrt官方"
    ;;
  lede-master)
    REPO_URL="https://github.com/coolsnowwolf/lede"
    DEFAULT_REPO_BRANCH="master"
    ALLOWED_REPO_BRANCHES="master 20251001 20230609 20221001"
    SOURCE_NAME="Lean's LEDE"
    ;;
  immortalwrt-master)
    REPO_URL="https://github.com/immortalwrt/immortalwrt"
    DEFAULT_REPO_BRANCH="master"
    ALLOWED_REPO_BRANCHES="master openwrt-25.12 openwrt-24.10 openwrt-23.05"
    SOURCE_NAME="ImmortalWrt"
    ;;
  Lienol-master)
    REPO_URL="https://github.com/Lienol/openwrt"
    DEFAULT_REPO_BRANCH="25.12"
    ALLOWED_REPO_BRANCHES="25.12 24.10 23.05 19.07"
    SOURCE_NAME="Lienol"
    ;;
  *)
    echo "错误：不支持的源码类型: $SOURCE_BRANCH" >&2
    exit 1
    ;;
esac

if [ "$REQUESTED_REPO_BRANCH" = "auto" ]; then
  REPO_BRANCH="$DEFAULT_REPO_BRANCH"
elif [[ " $ALLOWED_REPO_BRANCHES " == *" $REQUESTED_REPO_BRANCH "* ]]; then
  REPO_BRANCH="$REQUESTED_REPO_BRANCH"
else
  echo "错误：$SOURCE_BRANCH 不支持分支/版本 $REQUESTED_REPO_BRANCH" >&2
  echo "可用分支/版本: $ALLOWED_REPO_BRANCHES" >&2
  exit 1
fi

plugin_selected() {
  [[ ",$PLUGINS_LIST," == *",$1,"* ]]
}

if plugin_selected luci-app-bandix; then
  case "$SOURCE_BRANCH:$REPO_BRANCH" in
    openwrt-main:main|openwrt-main:openwrt-25.12|openwrt-main:openwrt-24.10|\
    lede-master:master|lede-master:20251001|\
    immortalwrt-master:master|immortalwrt-master:openwrt-25.12|immortalwrt-master:openwrt-24.10|\
    Lienol-master:25.12|Lienol-master:24.10) ;;
    *)
      echo "错误：Bandix仅支持Linux 6.x及OpenWrt 24.10以上分支。" >&2
      exit 1
      ;;
  esac
fi

if plugin_selected luci-theme-argon; then
  case "$SOURCE_BRANCH:$REPO_BRANCH" in
    openwrt-main:main|openwrt-main:openwrt-25.12|openwrt-main:openwrt-24.10|\
    immortalwrt-master:master|immortalwrt-master:openwrt-25.12|immortalwrt-master:openwrt-24.10|\
    Lienol-master:25.12|Lienol-master:24.10) ;;
    *)
      echo "错误：Argon当前版本不兼容所选源码分支。" >&2
      exit 1
      ;;
  esac
fi

if plugin_selected luci-app-netwizard; then
  case "$SOURCE_BRANCH:$REPO_BRANCH" in
    openwrt-main:main|openwrt-main:openwrt-25.12|openwrt-main:openwrt-24.10|\
    immortalwrt-master:master|immortalwrt-master:openwrt-25.12|\
    Lienol-master:25.12) ;;
    *)
      echo "错误：网络向导2.1.5支持官方OpenWrt 24.10，以及25.12与更新分支；当前源码分支尚未验证。" >&2
      exit 1
      ;;
  esac
fi

if plugin_selected kmod-kvm-intel && plugin_selected kmod-kvm-amd; then
  echo "错误：Intel与AMD KVM模块不能同时选择。" >&2
  exit 1
fi

echo "📋 本地编译配置"
echo "  源码: $SOURCE_NAME"
echo "  仓库: $REPO_URL"
echo "  分支: $REPO_BRANCH"
echo "  设备: x86_64"
echo "  根分区: ${ROOTFS_PARTSIZE} MiB"
echo "  插件: ${PLUGINS_LIST:-无}"
echo "  CPU线程: $(nproc)"
echo "  工作根目录: $BUILD_ROOT"

if [ "$DRY_RUN" = "true" ]; then
  echo "✅ 配置验证通过；dry-run未执行克隆和编译。"
  exit 0
fi

mkdir -p -- "$BUILD_ROOT"
BUILD_ROOT="$(cd -- "$BUILD_ROOT" && pwd -P)"
HOME_REAL="$(cd -- "$HOME" && pwd -P)"
if [ "$BUILD_ROOT" = "/" ] || [ "$BUILD_ROOT" = "$HOME_REAL" ]; then
  echo "错误：编译根目录不能是根目录或用户主目录。" >&2
  exit 1
fi

RUNS_ROOT="$BUILD_ROOT/runs"
CACHE_ROOT="$BUILD_ROOT/cache"
OUTPUT_ROOT="$BUILD_ROOT/output"
mkdir -p -- "$RUNS_ROOT" "$CACHE_ROOT/dl" "$CACHE_ROOT/ccache" "$OUTPUT_ROOT"

for protected_path in "$RUNS_ROOT" "$CACHE_ROOT" "$OUTPUT_ROOT"; do
  if [ -L "$protected_path" ]; then
    echo "错误：安全目录不能是符号链接: $protected_path" >&2
    exit 1
  fi
done

exec 9>"$BUILD_ROOT/.build-openwrt.lock"
if ! flock -n 9; then
  echo "错误：当前已有本地编译任务运行，请等待完成后再试。" >&2
  exit 1
fi

RUNS_ROOT_REAL="$(cd -- "$RUNS_ROOT" && pwd -P)"
echo "🧹 清理超过24小时的旧编译目录..."
while IFS= read -r -d '' old_run; do
  if [ ! -f "$old_run/.build-openwrt-run" ]; then
    echo "  跳过没有安全标记的目录: $old_run"
    continue
  fi

  old_parent="$(cd -- "$(dirname -- "$old_run")" && pwd -P)"
  if [ "$old_parent" != "$RUNS_ROOT_REAL" ]; then
    echo "错误：旧目录不在受控运行目录内，拒绝清理: $old_run" >&2
    exit 1
  fi

  echo "  删除旧编译目录: $old_run"
  rm -rf -- "$old_run"
done < <(find "$RUNS_ROOT_REAL" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -print0)

if [ "$CLEANUP_ONLY" = "true" ]; then
  echo "✅ 旧编译目录清理检查完成"
  exit 0
fi

bash "$SCRIPT_DIR/setup-local-builder.sh" --check

BUILD_ID="$(date +%Y%m%d_%H%M%S)_$$"
RUN_DIR="$RUNS_ROOT/$BUILD_ID"
OPENWRT_DIR="$RUN_DIR/openwrt"
LOG_FILE="$RUN_DIR/build.log"
mkdir -p -- "$RUN_DIR"
printf 'build-openwrt local run\n' > "$RUN_DIR/.build-openwrt-run"

exec > >(tee -a "$LOG_FILE") 2>&1

on_exit() {
  local exit_code=$?
  if (( exit_code == 0 )); then
    echo "✅ 本地编译流程结束"
  else
    echo "❌ 本地编译失败（退出码: $exit_code）"
    echo "诊断目录: $RUN_DIR"
    echo "日志文件: $LOG_FILE"
  fi
}
trap on_exit EXIT

export CCACHE_DIR="$CACHE_ROOT/ccache"
ccache --max-size 20G >/dev/null

echo "📦 克隆OpenWrt源码..."
git clone --single-branch --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$OPENWRT_DIR"

if [ -e "$OPENWRT_DIR/dl" ] || [ -L "$OPENWRT_DIR/dl" ]; then
  rm -rf -- "$OPENWRT_DIR/dl"
fi
ln -s "$CACHE_ROOT/dl" "$OPENWRT_DIR/dl"

if plugin_selected luci-app-bandix; then
  KERNEL_PATCHVER=$(sed -n \
    's/^[[:space:]]*KERNEL_PATCHVER[[:space:]]*:=[[:space:]]*//p' \
    "$OPENWRT_DIR/target/linux/x86/Makefile" | head -n 1)
  if [[ ! "$KERNEL_PATCHVER" =~ ^6\. ]]; then
    echo "错误：Bandix要求Linux 6.x，当前内核版本为: ${KERNEL_PATCHVER:-未知}" >&2
    exit 1
  fi
  echo "✅ Bandix内核兼容性检查通过: Linux $KERNEL_PATCHVER"
fi

echo "🔧 配置第三方feeds..."
bash "$SCRIPT_DIR/manage-feeds.sh" \
  "$PLUGINS_LIST" "$OPENWRT_DIR/feeds.conf.default" "$SOURCE_BRANCH" "$REPO_BRANCH"

cd "$OPENWRT_DIR"
echo "📥 更新feeds..."
FEEDS_UPDATED=false
for attempt in 1 2 3; do
  if ./scripts/feeds update -a; then
    FEEDS_UPDATED=true
    break
  fi
  echo "警告：feeds更新第 $attempt 次失败"
  if (( attempt < 3 )); then
    sleep $((attempt * 5))
  fi
done
if [ "$FEEDS_UPDATED" != "true" ]; then
  echo "错误：feeds更新连续3次失败" >&2
  exit 1
fi

verify_pinned_feed() {
  local feed_name="$1"
  local feed_url expected_revision actual_revision
  feed_url=$(awk -v name="$feed_name" \
    '$1 ~ /^src-git/ && $2 == name { print $3; exit }' feeds.conf.default)
  if [[ "$feed_url" != *"^"* ]]; then
    return
  fi
  expected_revision="${feed_url##*^}"
  actual_revision=$(git -C "feeds/$feed_name" rev-parse HEAD)
  if [ "$actual_revision" != "$expected_revision" ]; then
    echo "错误：$feed_name 版本校验失败。" >&2
    exit 1
  fi
  echo "  ✅ $feed_name 已固定到 $actual_revision"
}
verify_pinned_feed passwall_packages
verify_pinned_feed passwall
verify_pinned_feed netwizard
bash "$SCRIPT_DIR/patch-netwizard-docker-firewall.sh" "$OPENWRT_DIR"

if plugin_selected luci-theme-argon; then
  echo "🎨 安装Argon独立源码包..."
  PACKAGE_ROOT="$OPENWRT_DIR/package/community"
  mkdir -p "$PACKAGE_ROOT"
  install_argon_package() {
    local package_name="$1"
    local repository_url="$2"
    local package_path="$PACKAGE_ROOT/$package_name"
    if [ -f "$package_path/Makefile" ]; then
      echo "  保留源码中已有的 $package_name"
      return
    fi
    if [ -e "$package_path" ] || [ -L "$package_path" ]; then
      echo "错误：Argon源码目标路径异常: $package_path" >&2
      exit 1
    fi
    git clone --depth=1 --single-branch "$repository_url" "$package_path"
    if [ ! -s "$package_path/Makefile" ]; then
      echo "错误：$package_name 缺少Makefile" >&2
      exit 1
    fi
  }
  install_argon_package luci-theme-argon https://github.com/jerrykuku/luci-theme-argon
  install_argon_package luci-app-argon-config https://github.com/jerrykuku/luci-app-argon-config
fi

if [ "$SOURCE_BRANCH:$REPO_BRANCH" = "openwrt-main:openwrt-25.12" ] &&
   plugin_selected luci-app-passwall; then
  echo "🩹 检查本机生成的PassWall源码归档哈希..."
  align_passwall_hash_with_cache() {
    local package_name="$1"
    local archive_name="$2"
    local approved_hash_a="$3"
    local approved_hash_b="$4"
    local package_makefile="$OPENWRT_DIR/feeds/passwall_packages/$package_name/Makefile"
    local archive_file="$CACHE_ROOT/dl/$archive_name"
    local current_hash cached_hash

    if [ ! -f "$package_makefile" ]; then
      echo "错误：未找到PassWall软件包配置: $package_makefile" >&2
      exit 1
    fi

    current_hash=$(sed -n 's/^PKG_MIRROR_HASH:=//p' "$package_makefile")
    if [ "$current_hash" != "$approved_hash_a" ] &&
       [ "$current_hash" != "$approved_hash_b" ]; then
      echo "错误：$package_name 上游哈希出现未知变化: $current_hash" >&2
      exit 1
    fi

    if [ ! -s "$archive_file" ]; then
      return
    fi

    cached_hash=$(sha256sum "$archive_file" | awk '{print $1}')
    if [ "$cached_hash" != "$approved_hash_a" ] &&
       [ "$cached_hash" != "$approved_hash_b" ]; then
      echo "警告：$archive_name 缓存哈希不在允许列表中，将交给OpenWrt重新下载验证"
      return
    fi

    if [ "$current_hash" != "$cached_hash" ]; then
      sed -i \
        "s/^PKG_MIRROR_HASH:=$current_hash$/PKG_MIRROR_HASH:=$cached_hash/" \
        "$package_makefile"
      grep -qxF "PKG_MIRROR_HASH:=$cached_hash" "$package_makefile"
      echo "✅ 已按当前系统生成结果调整 $package_name 哈希: $cached_hash"
    else
      echo "✅ $package_name 缓存哈希与软件包配置一致"
    fi
  }

  align_passwall_hashes_with_cache() {
    align_passwall_hash_with_cache \
      shadowsocksr-libev \
      shadowsocksr-libev-2.5.6.tar.zst \
      146fa4511a52da2aaa1e11ea0294cfb450e62643156c5da3b10e037ef43961f6 \
      42dab453a7d8b3737109110083513467bad1cf71a0aaf671452595797b2b59b0
    align_passwall_hash_with_cache \
      simple-obfs \
      simple-obfs-0.0.5.tar.zst \
      bc97eba511b86a089ab4bcf0ac78d9e4a39c59046d5cde77b79a118245daa0ba \
      b06d72a973de85fd2d45542f436e4aab5d96de6c78f4f0b9f6697e1730d1d211
  }

  align_passwall_hashes_with_cache
fi

echo "📦 安装feeds..."
bash "$SCRIPT_DIR/install-radicale3-backport.sh" "$OPENWRT_DIR"
./scripts/feeds install -a

bash "$SCRIPT_DIR/configure-x86-build.sh" \
  --source-dir "$OPENWRT_DIR" --plugins "$PLUGINS_LIST" --rootfs "$ROOTFS_PARTSIZE" --ccache

echo "📥 下载依赖包..."
DOWNLOAD_JOBS=$(( $(nproc) * 2 ))
DOWNLOAD_TARGETS=(tools/download toolchain/download package/download target/download)
for download_target in "${DOWNLOAD_TARGETS[@]}"; do
  DOWNLOAD_OK=false
  for attempt in 1 2; do
    find "$CACHE_ROOT/dl" -type f -size -1024c -print -delete 2>/dev/null || true
    if make download DOWNLOAD_DIRS="$download_target" -j"$DOWNLOAD_JOBS"; then
      DOWNLOAD_OK=true
      break
    fi
    echo "警告：${download_target} 并行下载第 $attempt 次失败"
    if [ "$download_target" = "package/download" ] &&
       declare -F align_passwall_hashes_with_cache >/dev/null; then
      # 带Git子模块的源码归档会因宿主机tar/zstd版本产生两个已知哈希。
      # 首次下载失败后归档仍在缓存中，按允许列表调整后自动重试。
      align_passwall_hashes_with_cache
    fi
    sleep $((attempt * 5))
  done
  if [ "$DOWNLOAD_OK" != "true" ]; then
    echo "警告：${download_target} 改用单线程下载并显示详细日志"
    find "$CACHE_ROOT/dl" -type f -size -1024c -print -delete 2>/dev/null || true
    make download DOWNLOAD_DIRS="$download_target" -j1 V=s
  fi
done

echo "🔨 使用$(nproc)个线程编译固件..."
if ! make -j"$(nproc)" BUILD_LOG=1; then
  echo "错误：并行编译失败，正在输出失败包的详细日志" >&2
  bash "$SCRIPT_DIR/report-build-failures.sh" "$OPENWRT_DIR"
  exit 1
fi

echo "📦 整理本地编译产物..."
OUTPUT_DIR="$OUTPUT_ROOT/${BUILD_ID}_${SOURCE_BRANCH}_${REPO_BRANCH}"
mkdir -p "$OUTPUT_DIR"
mapfile -d '' FIRMWARE_FILES < <(
  find "$OPENWRT_DIR/bin/targets" -mindepth 3 -maxdepth 3 -type f \
    \( -name '*.bin' -o -name '*.img' -o -name '*.gz' \) -print0
)
if (( ${#FIRMWARE_FILES[@]} == 0 )); then
  echo "错误：没有找到编译后的固件文件。" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SOURCE_CLEAN=$(printf '%s_%s' "$SOURCE_BRANCH" "$REPO_BRANCH" | sed 's/[^a-zA-Z0-9._-]/_/g')
for file in "${FIRMWARE_FILES[@]}"; do
  original_name="$(basename -- "$file")"
  original_name="${original_name#openwrt-}"
  new_name="OpenWrt_${SOURCE_CLEAN}_x86_64_${TIMESTAMP}_${original_name}"
  cp -- "$file" "$OUTPUT_DIR/$new_name"
  echo "  📦 $new_name"
done

FIRMWARE_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
cat > "$OUTPUT_DIR/firmware_info.txt" <<EOF
OpenWrt 本地编译固件信息
========================
编译时间: $(date '+%Y-%m-%d %H:%M:%S')
源码仓库: $SOURCE_NAME
实际分支: $REPO_BRANCH
目标设备: X86_64
根分区容量: ${ROOTFS_PARTSIZE} MiB
选中插件: ${PLUGINS_LIST:-无}
固件大小: $FIRMWARE_SIZE
编译主机: $(hostname)
CPU线程: $(nproc)
EOF

(
  cd "$OUTPUT_DIR"
  sha256sum OpenWrt_* > sha256sums.txt
)
cp -- "$LOG_FILE" "$OUTPUT_DIR/build.log"

echo "🎉 固件编译成功"
echo "固件目录: $OUTPUT_DIR"
echo "SHA256文件: $OUTPUT_DIR/sha256sums.txt"
