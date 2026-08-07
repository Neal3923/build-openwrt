#!/usr/bin/env bash
# Report the detailed OpenWrt logs for packages that failed during a logged build.

set -uo pipefail

OPENWRT_DIR="${1:-.}"
LOG_DIR="${2:-$OPENWRT_DIR/logs}"
MAX_LINES="${BUILD_FAILURE_LOG_LINES:-500}"

if [[ ! "$MAX_LINES" =~ ^[1-9][0-9]*$ ]]; then
  MAX_LINES=500
fi

if [ ! -d "$LOG_DIR" ]; then
  echo "未找到OpenWrt构建日志目录: $LOG_DIR" >&2
  exit 0
fi

declare -A PRINTED_LOGS=()
FOUND_SUMMARY=false
FOUND_DETAIL=false

start_group() {
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "::group::$1"
  else
    echo "===== $1 ====="
  fi
}

end_group() {
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "::endgroup::"
  fi
}

print_compile_log() {
  local log_file="$1"
  if [[ -n "${PRINTED_LOGS[$log_file]+x}" ]]; then
    return
  fi

  PRINTED_LOGS["$log_file"]=1
  FOUND_DETAIL=true
  start_group "失败包详细日志: ${log_file#"$OPENWRT_DIR"/}"
  echo "日志文件: $log_file"
  echo "以下为最后 $MAX_LINES 行："
  tail -n "$MAX_LINES" "$log_file" || true
  end_group
}

while IFS= read -r -d '' error_file; do
  [ -s "$error_file" ] || continue
  FOUND_SUMMARY=true

  start_group "OpenWrt构建失败摘要: ${error_file#"$OPENWRT_DIR"/}"
  cat "$error_file"
  end_group

  while IFS= read -r target; do
    target="$(printf '%s\n' "$target" |
      sed -E 's/[[:space:]]+\[[^]]+\]$//; s/[[:space:]]+$//')"
    [ -n "$target" ] || continue

    target_log_dir="$LOG_DIR/$target"
    [ -d "$target_log_dir" ] || continue
    while IFS= read -r -d '' compile_log; do
      print_compile_log "$compile_log"
    done < <(
      find "$target_log_dir" -type f -name '*compile.txt' -size +0c -print0 |
        sort -z
    )
  done < <(
    sed -nE \
      's/^[[:space:]]*ERROR:[[:space:]]+(.+)[[:space:]]+failed to build.*$/\1/p' \
      "$error_file" | sort -u
  )
done < <(
  find "$LOG_DIR" -type f -name error.txt -size +0c -print0 | sort -z
)

if [ "$FOUND_SUMMARY" != "true" ]; then
  echo "未找到error.txt；输出最近生成的构建日志用于诊断。" >&2
fi

if [ "$FOUND_DETAIL" != "true" ]; then
  while IFS= read -r recent_log; do
    [ -n "$recent_log" ] || continue
    print_compile_log "$recent_log"
  done < <(
    find "$LOG_DIR" -type f -name '*compile.txt' -size +0c \
      -printf '%T@ %p\n' 2>/dev/null |
      sort -rn | head -n 5 | sed -E 's/^[^ ]+ //'
  )
fi

if [ "$FOUND_DETAIL" != "true" ]; then
  echo "没有可输出的失败包详细日志。" >&2
fi

exit 0
