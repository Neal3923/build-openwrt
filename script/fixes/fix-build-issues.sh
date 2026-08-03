#!/bin/bash
#========================================================================================================================
# OpenWrt编译问题主修复脚本
# 功能: 根据设备类型和错误类型调用对应的修复脚本
# 用法: ./fix-build-issues.sh <device> [error_type]
#========================================================================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXES_DIR="$SCRIPT_DIR"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 公共日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 显示脚本标题
show_header() {
    echo -e "${CYAN}"
    echo "========================================================================================================================="
    echo "                                    🔧 OpenWrt编译问题修复工具"
    echo "========================================================================================================================="
    echo -e "${NC}"
}

# 显示帮助信息
show_help() {
    cat << EOF
${CYAN}使用方法:${NC}
  $0 <device> [error_type]

${CYAN}支持的设备:${NC}
  x86_64              X86 64位设备

${CYAN}支持的错误类型:${NC}
  udebug              udebug/ucode依赖错误
  kernel              内核编译错误
  feeds               feeds相关错误
  auto                自动检测错误类型 (默认)

${CYAN}示例:${NC}
  $0 x86_64 udebug    # 修复X86设备的udebug错误
  $0 x86_64           # 自动修复X86设备问题

${CYAN}文件结构:${NC}
  script/
  ├── fix-build-issues.sh     # 主修复脚本
  └── fixes/
      ├── common.sh           # 公共函数
      ├── fix-x86.sh          # X86设备修复
      └── fix-udebug.sh       # udebug错误修复
EOF
}

# 检查环境
check_environment() {
    # 检查是否在OpenWrt根目录
    if [ ! -f "package/Makefile" ] || [ ! -d "target/linux" ]; then
        log_error "请在OpenWrt源码根目录下运行此脚本"
        exit 1
    fi
    
    # 检查fixes目录
    if [ ! -d "$FIXES_DIR" ]; then
        log_warning "fixes目录不存在，创建目录结构..."
        mkdir -p "$FIXES_DIR"
    fi
    
    # 确保修复脚本有执行权限
    chmod +x "$FIXES_DIR"/*.sh 2>/dev/null || true
}

# 自动检测错误类型
detect_error_type() {
    local device="$1"
    local detected_errors=()
    
    log_info "自动检测编译错误类型..."
    
    # 检查最近的编译日志
    if [ -f "logs/package.log" ] || [ -f "build.log" ]; then
        local log_file=""
        [ -f "logs/package.log" ] && log_file="logs/package.log"
        [ -f "build.log" ] && log_file="build.log"
        
        if [ -n "$log_file" ]; then
            # 检测udebug错误
            if grep -q "ucode_include_dir-NOTFOUND" "$log_file" 2>/dev/null; then
                detected_errors+=("udebug")
            fi
            
            # 检测内核补丁错误
            if grep -q "Patch failed" "$log_file" 2>/dev/null; then
                detected_errors+=("kernel")
            fi
            
            # 检测feeds错误
            if grep -q "feeds.*failed" "$log_file" 2>/dev/null; then
                detected_errors+=("feeds")
            fi
        fi
    fi
    
    # 去重
    detected_errors=($(printf "%s\n" "${detected_errors[@]}" | sort -u))
    
    if [ ${#detected_errors[@]} -gt 0 ]; then
        log_info "检测到的错误类型: ${detected_errors[*]}"
        echo "${detected_errors[@]}"
    else
        log_info "未检测到特定错误，将应用通用修复"
        echo "generic"
    fi
}

# 加载公共函数
load_common_functions() {
    local common_script="$FIXES_DIR/common.sh"
    if [ -f "$common_script" ]; then
        source "$common_script"
    else
        log_warning "公共函数文件不存在: $common_script"
    fi
}

# 执行设备特定修复
run_device_fix() {
    local device="$1"
    local error_type="$2"
    
    local device_script=""
    case "$device" in
        "x86_64") device_script="$FIXES_DIR/fix-x86.sh" ;;
        *)
            log_error "不支持的设备类型: $device（仅支持 x86_64）"
            return 1
            ;;
    esac
    
    if [ -f "$device_script" ]; then
        log_info "执行设备特定修复: $device"
        chmod +x "$device_script"
        "$device_script" "$error_type"
        return $?
    else
        log_warning "设备修复脚本不存在: $device_script"
        return 1
    fi
}

# 执行错误特定修复
run_error_fix() {
    local error_type="$1"
    local device="$2"
    
    local error_script="$FIXES_DIR/fix-${error_type}.sh"
    
    if [ -f "$error_script" ]; then
        log_info "执行错误特定修复: $error_type"
        chmod +x "$error_script"
        "$error_script" "$device"
        return $?
    else
        log_warning "错误修复脚本不存在: $error_script"
        return 1
    fi
}

# 主函数
main() {
    local device="$1"
    local error_type="${2:-auto}"
    
    # 显示标题
    show_header
    
    # 检查参数
    if [ -z "$device" ]; then
        show_help
        exit 1
    fi

    if [ "$device" != "x86_64" ]; then
        log_error "不支持的设备类型: $device（仅支持 x86_64）"
        exit 1
    fi
    
    # 检查环境
    check_environment
    
    # 加载公共函数
    load_common_functions
    
    log_info "开始修复编译问题..."
    echo "  设备类型: $device"
    echo "  错误类型: $error_type"
    echo ""
    
    # 自动检测错误类型
    if [ "$error_type" = "auto" ]; then
        local detected_output
        detected_output="$(detect_error_type "$device" | tail -n 1)"
        local detected_errors=()
        read -ra detected_errors <<< "$detected_output"
        if [ ${#detected_errors[@]} -gt 0 ]; then
            for detected_error in "${detected_errors[@]}"; do
                if [ "$detected_error" = "generic" ]; then
                    continue
                fi
                log_info "修复检测到的错误: $detected_error"
                run_error_fix "$detected_error" "$device"
            done
        fi
        
        # 同时运行设备特定修复
        run_device_fix "$device" "auto"
    else
        # 运行指定的错误修复
        run_error_fix "$error_type" "$device"
        
        # 运行设备特定修复
        run_device_fix "$device" "$error_type"
    fi
    
    log_success "修复完成！"
    log_info "建议的后续操作："
    echo "  1. 清理编译缓存: make clean"
    echo "  2. 重新生成配置: make defconfig"
    echo "  3. 开始编译: make -j\$(nproc) || make -j1 V=s"
}

# 执行主函数
main "$@"
