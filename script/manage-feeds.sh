#!/bin/bash
#========================================================================================================================
# OpenWrt Feeds源管理脚本
# 功能: 根据选择的插件动态配置feeds源
# 用法: ./manage-feeds.sh "插件列表"
#========================================================================================================================

set -euo pipefail

# 插件与feeds源的映射关系
declare -A PLUGIN_FEEDS_MAP=(
    # SSR Plus+
    ["luci-app-ssr-plus"]="src-git helloworld https://github.com/fw876/helloworld"
    
    # PassWall
    ["luci-app-passwall"]="src-git passwall_packages https://github.com/Openwrt-Passwall/openwrt-passwall-packages;src-git passwall https://github.com/Openwrt-Passwall/openwrt-passwall"
    
    # OpenClash
    ["luci-app-openclash"]="src-git openclash https://github.com/vernesong/OpenClash"

    # DiskMan
    ["luci-app-diskman"]="src-git diskman https://github.com/lisaac/luci-app-diskman"

    # Bandix前端和后端
    ["luci-app-bandix"]="src-git bandix https://github.com/timsaya/openwrt-bandix;src-git bandix_luci https://github.com/timsaya/luci-app-bandix"
    
    # 其他常用插件
    ["luci-app-adguardhome"]="src-git adguardhome https://github.com/rufengsuixing/luci-app-adguardhome"
    ["luci-theme-argon"]="src-git argon https://github.com/jerrykuku/luci-theme-argon;src-git argon_config https://github.com/jerrykuku/luci-app-argon-config"
    ["luci-app-pushbot"]="src-git pushbot https://github.com/zzsj0928/luci-app-pushbot"
)

# 获取插件需要的feeds
get_plugin_feeds() {
    local plugin="$1"
    local feeds="${PLUGIN_FEEDS_MAP[$plugin]-}"
    
    if [ -n "$feeds" ]; then
        # 分号分隔多个feeds
        IFS=';' read -ra feed_array <<< "$feeds"
        for feed in "${feed_array[@]}"; do
            echo "$feed"
        done
    fi
}

# 生成feeds.conf.default
generate_feeds_conf() {
    local plugins_str="$1"
    local output_file="${2:-feeds.conf.default}"
    local temp_file

    temp_file=$(mktemp)
    trap 'rm -f "$temp_file"' RETURN

    # 必须从当前源码自带的feeds开始，绝不猜测或混用其他分支的基础feeds。
    if [ ! -s "$output_file" ]; then
        echo "❌ 源码feeds配置不存在或为空: $output_file" >&2
        return 1
    fi
    cp "$output_file" "$temp_file"

    # 按feed名称去重，防止重复追加同一个第三方源。
    declare -A feed_names
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*src-git(-full)?[[:space:]]+([^[:space:]]+) ]]; then
            feed_names["${BASH_REMATCH[2]}"]=1
        fi
    done < "$temp_file"
    
    # 解析插件列表，避免插件名被Shell通配符意外展开。
    local -a plugins=()
    if [ -n "$plugins_str" ]; then
        IFS=',' read -ra plugins <<< "$plugins_str"
    fi
    
    # 添加插件对应的feeds
    for plugin in "${plugins[@]}"; do
        local plugin_feeds
        plugin_feeds=$(get_plugin_feeds "$plugin")
        while IFS= read -r feed; do
            if [ -n "$feed" ]; then
                local feed_name
                feed_name=$(awk '{print $2}' <<< "$feed")
                if [ -n "$feed_name" ] && [ -z "${feed_names[$feed_name]+x}" ]; then
                    echo "$feed" >> "$temp_file"
                    feed_names["$feed_name"]=1
                    echo "➕ 添加插件feed: $feed_name"
                fi
            fi
        done <<< "$plugin_feeds"
    done

    mv "$temp_file" "$output_file"
    trap - RETURN
}

# 显示使用帮助
show_usage() {
    echo "使用方法:"
    echo "  $0 <plugins_list> [output_file]"
    echo ""
    echo "参数:"
    echo "  plugins_list  - 逗号分隔的插件列表"
    echo "  output_file   - 源码现有feeds.conf.default路径（默认: feeds.conf.default）"
    echo ""
    echo "示例:"
    echo "  $0 'luci-app-ssr-plus,luci-app-dockerman'"
    echo "  $0 'luci-app-passwall,luci-app-openclash' custom_feeds.conf"
}

# 主函数
main() {
    if [ $# -lt 1 ]; then
        show_usage
        exit 1
    fi
    
    local plugins_list="$1"
    local output_file="${2:-feeds.conf.default}"
    
    echo "📋 插件列表: $plugins_list"
    echo "📄 输出文件: $output_file"
    echo ""
    
    # 生成feeds配置
    generate_feeds_conf "$plugins_list" "$output_file"
    
    echo "✅ Feeds配置生成完成！"
    echo ""
    echo "📋 生成的feeds配置:"
    echo "================================"
    cat "$output_file"
    echo "================================"
}

# 如果直接执行脚本
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
