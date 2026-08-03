#!/bin/bash
# 为OpenWrt x86_64构建启用Intel或AMD KVM宿主支持。
# Linux 6.12起，KVM Hyper-V模拟能力受CONFIG_KVM_HYPERV单独控制；
# 较旧内核没有该开关，Hyper-V相关代码随KVM x86核心一同编译。

set -Eeuo pipefail

KVM_VENDOR="${1:-}"
OPENWRT_ROOT="${2:-.}"

case "$KVM_VENDOR" in
  intel|amd) ;;
  *)
    echo "错误：KVM处理器类型必须是intel或amd" >&2
    exit 1
    ;;
esac

OPENWRT_ROOT="$(cd "$OPENWRT_ROOT" && pwd)"
VIRT_MODULES="$OPENWRT_ROOT/package/kernel/linux/modules/virt.mk"
X86_MAKEFILE="$OPENWRT_ROOT/target/linux/x86/Makefile"

if [ ! -f "$VIRT_MODULES" ] || [ ! -f "$X86_MAKEFILE" ]; then
  echo "错误：没有找到完整的OpenWrt x86源码树" >&2
  exit 1
fi

if ! grep -q "define KernelPackage/kvm-$KVM_VENDOR" "$VIRT_MODULES"; then
  echo "错误：当前源码不提供kmod-kvm-$KVM_VENDOR" >&2
  exit 1
fi

KERNEL_PATCHVER="$({
  sed -n 's/^[[:space:]]*KERNEL_PATCHVER[[:space:]]*:=[[:space:]]*//p' "$X86_MAKEFILE"
  sed -n 's/^[[:space:]]*KERNEL_PATCHVER[[:space:]]*=[[:space:]]*//p' "$X86_MAKEFILE"
} | head -n 1 | tr -d '[:space:]')"

if [ -z "$KERNEL_PATCHVER" ]; then
  echo "错误：无法确定x86目标使用的内核版本" >&2
  exit 1
fi

GENERIC_KERNEL_CONFIG="$OPENWRT_ROOT/target/linux/generic/config-$KERNEL_PATCHVER"
X86_64_KERNEL_CONFIG="$OPENWRT_ROOT/target/linux/x86/64/config-$KERNEL_PATCHVER"

if [ ! -f "$GENERIC_KERNEL_CONFIG" ] || [ ! -f "$X86_64_KERNEL_CONFIG" ]; then
  echo "错误：找不到Linux $KERNEL_PATCHVER的x86_64内核配置" >&2
  exit 1
fi

if grep -qE '^(# )?CONFIG_KVM_HYPERV(=| )' "$GENERIC_KERNEL_CONFIG" ||
   grep -qE '^(# )?CONFIG_KVM_HYPERV(=| )' "$X86_64_KERNEL_CONFIG"; then
  sed -i -E '/^(# )?CONFIG_KVM_HYPERV(=| )/d' "$X86_64_KERNEL_CONFIG"
  printf '\nCONFIG_KVM_HYPERV=y\n' >> "$X86_64_KERNEL_CONFIG"

  if ! grep -qx 'CONFIG_KVM_HYPERV=y' "$X86_64_KERNEL_CONFIG"; then
    echo "错误：CONFIG_KVM_HYPERV未能写入x86_64内核配置" >&2
    exit 1
  fi

  echo "✅ Linux $KERNEL_PATCHVER已启用CONFIG_KVM_HYPERV=y"
else
  echo "ℹ️ Linux $KERNEL_PATCHVER没有独立的CONFIG_KVM_HYPERV开关，使用该内核自带的KVM Hyper-V实现"
fi

echo "✅ 已选择kmod-kvm-x86和kmod-kvm-$KVM_VENDOR"
