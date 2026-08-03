#!/bin/bash
#========================================================================================================================
# OpenWrt 构建编排器 (Build Orchestrator)
# 功能: 统一的构建入口点，协调所有子模块，提供标准化接口
# 架构设计: 解耦各模块，避免"牵一发而动全身"的问题
# 用法: ./build-orchestrator.sh [模式] [配置参数]
#========================================================================================================================

# 脚本版本和元信息
declare -r ORCHESTRATOR_VERSION="1.0.0"
declare -r SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
declare -r PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 配置文件路径
declare -r CONFIG_DIR="$PROJECT_ROOT/config"
declare -r BUILD_CONFIG_FILE="$CONFIG_DIR/build.json"
declare -r RUNTIME_CONFIG_FILE="/tmp/openwrt-build-runtime.json"

# 日志配置
declare -r LOG_DIR="$PROJECT_ROOT/logs"
declare -r LOG_FILE="$LOG_DIR/build-orchestrator.log"

# 颜色定义
declare -r RED='\033[0;31m'
declare -r GREEN='\033[0;32m'
declare -r YELLOW='\033[1;33m'
declare -r BLUE='\033[0;34m'
declare -r PURPLE='\033[0;35m'
declare -r CYAN='\033[0;36m'
declare -r NC='\033[0m'

# 全局变量
declare -g BUILD_ID=""
declare -g EXECUTION_MODE="auto"
declare -g AUTO_FIX_ENABLED=true
declare -g VERBOSE_MODE=false
declare -g DRY_RUN_MODE=false

#========================================================================================================================
# 核心函数 - 日志和工具
#========================================================================================================================

# 统一日志函数
log_message() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 创建日志目录
    mkdir -p "$LOG_DIR"
    
    # 控制台输出
    case "$level" in
        "INFO")  echo -e "${BLUE}[INFO]${NC} $message" ;;
        "SUCCESS") echo -e "${GREEN}[SUCCESS]${NC} $message" ;;
        "WARNING") echo -e "${YELLOW}[WARNING]${NC} $message" ;;
        "ERROR") echo -e "${RED}[ERROR]${NC} $message" ;;
        "DEBUG") [ "$VERBOSE_MODE" = true ] && echo -e "${PURPLE}[DEBUG]${NC} $message" ;;
        *) echo "$message" ;;
    esac
    
    # 文件日志
    echo "[$timestamp] [$level] [$$] $message" >> "$LOG_FILE"
}

# 便捷日志函数
log_info() { log_message "INFO" "$1"; }
log_success() { log_message "SUCCESS" "$1"; }
log_warning() { log_message "WARNING" "$1"; }
log_error() { log_message "ERROR" "$1"; }
log_debug() { log_message "DEBUG" "$1"; }

# 显示编排器标题
show_orchestrator_header() {
    echo -e "${CYAN}"
    echo "========================================================================================================================="
    echo "                                    🎭 OpenWrt 构建编排器 v${ORCHESTRATOR_VERSION}"
    echo "                                       统一构建控制 | 模块化架构"
    echo "========================================================================================================================="
    echo -e "${NC}"
}

# 检查依赖工具
check_dependencies() {
    log_info "检查系统依赖..."
    
    local required_tools=("jq" "curl" "git")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_error "缺少必需工具: ${missing_tools[*]}"
        log_info "请安装: sudo apt update && sudo apt install ${missing_tools[*]}"
        return 1
    fi
    
    log_success "依赖检查通过"
    return 0
}

#========================================================================================================================
# 配置管理 - 统一配置接口
#========================================================================================================================

# 初始化配置系统
init_config_system() {
    log_info "初始化配置系统..."
    
    # 创建配置目录
    mkdir -p "$CONFIG_DIR"
    
    # 生成默认配置文件
    if [ ! -f "$BUILD_CONFIG_FILE" ]; then
        create_default_build_config
    fi
    
    # 生成运行时配置
    generate_runtime_config
    
    log_success "配置系统初始化完成"
}

# 创建默认构建配置
create_default_build_config() {
    log_debug "创建默认构建配置: $BUILD_CONFIG_FILE"
    
    cat > "$BUILD_CONFIG_FILE" << 'EOF'
{
  "version": "1.0.0",
  "metadata": {
    "generated_at": "",
    "generated_by": "build-orchestrator",
    "description": "OpenWrt构建配置文件"
  },
  "build": {
    "default_source": "lede-master",
    "default_device": "x86_64",
    "default_plugins": [],
    "auto_fix_enabled": true,
    "parallel_jobs": 0,
    "timeout_minutes": 360
  },
  "modules": {
    "config_generator": {
      "script": "script/generate-config.sh",
      "enabled": true,
      "auto_fix": true
    },
    "plugin_manager": {
      "script": "script/plugin-manager.sh",
      "enabled": true,
      "database_init": true
    },
    "build_fixer": {
      "script": "script/fixes/fix-build-issues.sh",
      "enabled": true,
      "auto_detect": true
    }
  },
  "error_handling": {
    "auto_retry": true,
    "max_retries": 2,
    "continue_on_warning": true,
    "rollback_on_error": false
  },
  "github_actions": {
    "workflow_file": "smart-build.yml",
    "timeout": 6
  }
}
EOF
    
    # 更新生成时间
    local current_time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    jq ".metadata.generated_at = \"$current_time\"" "$BUILD_CONFIG_FILE" > "${BUILD_CONFIG_FILE}.tmp"
    mv "${BUILD_CONFIG_FILE}.tmp" "$BUILD_CONFIG_FILE"
}

# 生成运行时配置
generate_runtime_config() {
    local build_id="${BUILD_ID:-build_$(date +%s)}"
    local current_time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    
    cat > "$RUNTIME_CONFIG_FILE" << EOF
{
  "build_id": "$build_id",
  "execution_mode": "$EXECUTION_MODE",
  "auto_fix_enabled": $AUTO_FIX_ENABLED,
  "verbose_mode": $VERBOSE_MODE,
  "dry_run_mode": $DRY_RUN_MODE,
  "started_at": "$current_time",
  "orchestrator_version": "$ORCHESTRATOR_VERSION",
  "project_root": "$PROJECT_ROOT",
  "script_dir": "$SCRIPT_DIR"
}
EOF
    
    log_debug "运行时配置已生成: $RUNTIME_CONFIG_FILE"
}

# 读取配置值
get_config_value() {
    local key_path="$1"
    local default_value="$2"
    
    if [ -f "$BUILD_CONFIG_FILE" ]; then
        local value=$(jq -r "$key_path" "$BUILD_CONFIG_FILE" 2>/dev/null)
        if [ "$value" != "null" ] && [ -n "$value" ]; then
            echo "$value"
        else
            echo "$default_value"
        fi
    else
        echo "$default_value"
    fi
}

#========================================================================================================================
# 模块接口 - 标准化的模块调用
#========================================================================================================================

# 模块调用接口
call_module() {
    local module_name="$1"
    local operation="$2"
    shift 2
    local params=("$@")
    
    log_info "调用模块: $module_name -> $operation"
    
    # 获取模块配置
    local module_enabled=$(get_config_value ".modules.${module_name}.enabled" "true")
    local module_script=$(get_config_value ".modules.${module_name}.script" "")
    
    if [ "$module_enabled" != "true" ]; then
        log_warning "模块已禁用: $module_name"
        return 0
    fi
    
    if [ -z "$module_script" ]; then
        log_error "模块脚本未配置: $module_name"
        return 1
    fi
    
    local full_script_path="$PROJECT_ROOT/$module_script"
    
    if [ ! -f "$full_script_path" ]; then
        log_error "模块脚本不存在: $full_script_path"
        return 1
    fi
    
    # 构建标准化的调用参数
    local call_args=()
    
    # 添加运行时配置
    call_args+=("--runtime-config" "$RUNTIME_CONFIG_FILE")
    
    # 添加操作和参数
    if [ -n "$operation" ]; then
        call_args+=("$operation")
    fi
    
    call_args+=("${params[@]}")
    
    # 执行模块
    log_debug "执行: $full_script_path ${call_args[*]}"
    
    if [ "$DRY_RUN_MODE" = true ]; then
        log_info "[DRY-RUN] 模拟执行: $module_name $operation"
        return 0
    fi
    
    # 实际执行
    chmod +x "$full_script_path"
    "$full_script_path" "${call_args[@]}"
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "模块执行成功: $module_name"
    else
        log_error "模块执行失败: $module_name (退出码: $exit_code)"
    fi
    
    return $exit_code
}

#========================================================================================================================
# 构建流程 - 高级编排逻辑
#========================================================================================================================

# 构建前检查
pre_build_check() {
    local device="$1"
    local plugins="$2"
    
    log_info "执行构建前检查..."
    
    local check_results=()
    
    # 1. 环境检查
    if ! check_dependencies; then
        check_results+=("依赖检查失败")
    fi
    
    # 2. 插件管理器检查
    if ! call_module "plugin_manager" "pre-build-check" "-d" "$device" "-l" "$plugins"; then
        check_results+=("插件检查失败")
    fi
    
    # 3. 配置生成器预检查
    if ! call_module "config_generator" "--dry-run" "$device" "$plugins"; then
        check_results+=("配置生成检查失败")
    fi
    
    # 分析结果
    if [ ${#check_results[@]} -gt 0 ]; then
        log_warning "构建前检查发现问题:"
        for result in "${check_results[@]}"; do
            log_warning "  - $result"
        done
        
        if [ "$AUTO_FIX_ENABLED" = true ]; then
            log_info "尝试自动修复..."
            auto_fix_build_issues "$device" "$plugins"
        else
            return 1
        fi
    else
        log_success "构建前检查通过"
    fi
    
    return 0
}

# 自动修复构建问题
auto_fix_build_issues() {
    local device="$1"
    local plugins="$2"
    
    log_info "开始自动修复构建问题..."
    
    # 调用插件管理器的依赖修复
    call_module "plugin_manager" "auto-fix-deps" "-d" "$device" "-l" "$plugins" "--auto-fix"
    
    # 调用构建修复器
    call_module "build_fixer" "$device" "auto"
    
    log_success "自动修复完成"
}

# 核心构建流程
execute_build_process() {
    local device="$1"
    local plugins="$2"
    local source_branch="$3"

    log_info "开始构建流程..."

    # 步骤1: 初始化插件数据库
    if ! call_module "plugin_manager" "init"; then
        log_error "插件数据库初始化失败"
        return 1
    fi

    # 步骤2: 构建前检查
    if ! pre_build_check "$device" "$plugins"; then
        log_error "构建前检查失败"
        return 1
    fi

    # 步骤3: 生成 .config 文件
    log_info "生成 .config 文件..."
    local config_args=()
    config_args+=("--runtime-config" "$RUNTIME_CONFIG_FILE")
    config_args+=("$device")
    config_args+=("$plugins")
    [ "$AUTO_FIX_ENABLED" = true ] && config_args+=("--auto-fix")
    [ "$VERBOSE_MODE" = true ] && config_args+=("--verbose")
    chmod +x "$PROJECT_ROOT/script/generate-config.sh"
    if ! "$PROJECT_ROOT/script/generate-config.sh" "${config_args[@]}"; then
        log_error ".config 文件生成失败"
        return 1
    fi

    # 步骤4: 生成 feeds.conf.default 文件
    log_info "生成 feeds.conf.default 文件..."
    local feeds_args=()
    feeds_args+=("--runtime-config" "$RUNTIME_CONFIG_FILE")
    feeds_args+=("generate-feeds")
    feeds_args+=("-l" "$plugins")
    feeds_args+=("-b" "$source_branch")
    feeds_args+=("-o" "feeds.conf.default")
    [ "$VERBOSE_MODE" = true ] && feeds_args+=("-v")
    chmod +x "$PROJECT_ROOT/script/plugin-manager.sh"
    if ! "$PROJECT_ROOT/script/plugin-manager.sh" "${feeds_args[@]}"; then
        log_error "feeds.conf.default 文件生成失败"
        return 1
    fi

    # 步骤5: 执行自动修复（如有需要）
    if [ "$AUTO_FIX_ENABLED" = true ]; then
        log_info "执行编译错误自动修复..."
        if [ -f "$PROJECT_ROOT/script/fixes/fix-build-issues.sh" ]; then
            chmod +x "$PROJECT_ROOT/script/fixes/fix-build-issues.sh"
            if ! "$PROJECT_ROOT/script/fixes/fix-build-issues.sh" "$device" "auto"; then
                log_warning "自动修复脚本执行遇到问题，但继续流程"
            else
                log_success "自动修复完成"
            fi
        else
            log_warning "未找到自动修复脚本: $PROJECT_ROOT/script/fixes/fix-build-issues.sh"
        fi
    fi

    # 步骤6: 最终验证
    if [ -f ".config" ] && [ -f "feeds.conf.default" ]; then
        log_success "构建配置已生成: .config, feeds.conf.default"
        show_build_summary "$device" "$plugins" "$source_branch"
    else
        log_error "配置文件未全部生成"
        return 1
    fi

    return 0
}

# 显示构建摘要
show_build_summary() {
    local device="$1"
    local plugins="$2"
    local source_branch="$3"
    
    echo -e "\n${CYAN}📋 构建摘要${NC}"
    echo "========================================"
    echo "构建ID: $BUILD_ID"
    echo "目标设备: $device"
    echo "源码分支: $source_branch"
    echo "插件列表: ${plugins:-无}"
    echo "自动修复: $([ "$AUTO_FIX_ENABLED" = true ] && echo "启用" || echo "禁用")"
    echo "执行模式: $EXECUTION_MODE"
    
    if [ -f ".config" ]; then
        local config_lines=$(wc -l < .config)
        local config_size=$(stat -c%s .config 2>/dev/null || echo "未知")
        echo "配置文件: $config_lines 行, $config_size 字节"
    fi
    
    echo "========================================"
}

#========================================================================================================================
# 命令行接口 - 灵活的参数处理
#========================================================================================================================

# 显示帮助信息
show_help() {
    cat << EOF
${CYAN}OpenWrt 构建编排器 v${ORCHESTRATOR_VERSION}${NC}

${CYAN}使用方法:${NC}
  $0 [模式] [选项] [参数...]

${CYAN}构建模式:${NC}
  generate              生成配置文件
  check                 执行构建前检查
  build                 完整构建流程
  fix                   仅执行问题修复
  validate              验证现有配置

${CYAN}通用选项:${NC}
  -d, --device         目标设备类型
  -p, --plugins        插件列表 (逗号分隔)
  -s, --source         源码分支
  --auto-fix           启用自动修复 (默认启用)
  --no-auto-fix        禁用自动修复
  --dry-run            仅显示操作，不实际执行
  -v, --verbose        详细输出
  -c, --config         指定配置文件
  -h, --help           显示帮助信息
  --version            显示版本信息

${CYAN}配置管理:${NC}
  config init          初始化配置系统
  config show          显示当前配置
  config set KEY VALUE 设置配置值

${CYAN}示例:${NC}
  # 基本使用
  $0 generate -d x86_64 -p "luci-app-ssr-plus,luci-theme-argon"
  
  # 完整构建流程
  $0 build -d rpi_4b -s lede-master --auto-fix
  
  # 仅检查
  $0 check -d x86_64 -p "luci-app-passwall" --dry-run
  
  # 配置管理
  $0 config set .build.auto_fix_enabled false

${CYAN}支持的设备:${NC}
  x86_64, xiaomi_4a_gigabit, newifi_d2, rpi_4b, nanopi_r2s

${CYAN}架构特点:${NC}
  ✅ 模块化设计 - 各模块独立，接口标准化
  ✅ 统一配置 - JSON配置驱动，易于维护
  ✅ 自动修复 - 智能检测和修复构建问题
  ✅ 向后兼容 - 保持现有脚本接口不变
EOF
}

# 配置管理命令
handle_config_command() {
    local sub_command="$1"
    shift
    
    case "$sub_command" in
        "init")
            init_config_system
            ;;
        "show")
            if [ -f "$BUILD_CONFIG_FILE" ]; then
                jq . "$BUILD_CONFIG_FILE"
            else
                log_error "配置文件不存在: $BUILD_CONFIG_FILE"
                return 1
            fi
            ;;
        "set")
            local key="$1"
            local value="$2"
            if [ -z "$key" ] || [ -z "$value" ]; then
                log_error "用法: config set KEY VALUE"
                return 1
            fi
            
            if [ -f "$BUILD_CONFIG_FILE" ]; then
                jq "$key = \"$value\"" "$BUILD_CONFIG_FILE" > "${BUILD_CONFIG_FILE}.tmp"
                mv "${BUILD_CONFIG_FILE}.tmp" "$BUILD_CONFIG_FILE"
                log_success "配置已更新: $key = $value"
            else
                log_error "配置文件不存在，请先运行 config init"
                return 1
            fi
            ;;
        *)
            log_error "未知的配置命令: $sub_command"
            return 1
            ;;
    esac
}

#========================================================================================================================
# 主函数 - 统一入口点
#========================================================================================================================

main() {
    local mode=""
    local device=""
    local plugins=""
    local source_branch=""
    local config_file=""
    
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            # 构建模式
            generate|check|build|fix|validate)
                mode="$1"
                shift
                ;;
            # 配置管理
            config)
                handle_config_command "$2" "${@:3}"
                exit $?
                ;;
            # 参数选项
            -d|--device)
                device="$2"
                shift 2
                ;;
            -p|--plugins)
                plugins="$2"
                shift 2
                ;;
            -s|--source)
                source_branch="$2"
                shift 2
                ;;
            -c|--config)
                config_file="$2"
                BUILD_CONFIG_FILE="$config_file"
                shift 2
                ;;
            --auto-fix)
                AUTO_FIX_ENABLED=true
                shift
                ;;
            --no-auto-fix)
                AUTO_FIX_ENABLED=false
                shift
                ;;
            --dry-run)
                DRY_RUN_MODE=true
                shift
                ;;
            -v|--verbose)
                VERBOSE_MODE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            --version)
                echo "构建编排器版本 $ORCHESTRATOR_VERSION"
                exit 0
                ;;
            *)
                log_error "未知参数: $1"
                echo "使用 --help 查看帮助信息"
                exit 1
                ;;
        esac
    done
    
    # 生成构建ID
    BUILD_ID="${BUILD_ID:-build_$(date +%s)_$$}"
    
    # 显示标题
    show_orchestrator_header
    
    # 初始化系统
    init_config_system
    
    # 设置默认值
    device="${device:-$(get_config_value '.build.default_device' 'x86_64')}"
    source_branch="${source_branch:-$(get_config_value '.build.default_source' 'lede-master')}"
    plugins="${plugins:-$(get_config_value '.build.default_plugins | join(",")' '')}"
    
    # 执行对应模式
    case "$mode" in
        "generate")
            log_info "模式: 配置生成"
            execute_build_process "$device" "$plugins" "$source_branch"
            ;;
        "check")
            log_info "模式: 构建前检查"
            pre_build_check "$device" "$plugins"
            ;;
        "build")
            log_info "模式: 完整构建流程"
            execute_build_process "$device" "$plugins" "$source_branch"
            ;;
        "fix")
            log_info "模式: 问题修复"
            auto_fix_build_issues "$device" "$plugins"
            ;;
        "validate")
            log_info "模式: 配置验证"
            call_module "plugin_manager" "validate" "-l" "$plugins"
            ;;
        "")
            log_error "请指定构建模式"
            echo "使用 --help 查看帮助信息"
            exit 1
            ;;
        *)
            log_error "未知模式: $mode"
            exit 1
            ;;
    esac
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "构建编排器执行完成"
    else
        log_error "构建编排器执行失败 (退出码: $exit_code)"
    fi
    
    exit $exit_code
}

# 错误处理
set -eE
trap 'log_error "脚本在第 $LINENO 行发生错误"' ERR

# 检查脚本是否被直接执行
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
