#!/usr/bin/env bash
# 배포된 Edge Function 로그 실시간 조회
# 사용법: bash scripts/logs.sh [함수명]
# 인자 없으면 trigger-search 기본

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

FUNCTION_NAME="${1:-trigger-search}"

log_step "함수 로그 실시간 조회: $FUNCTION_NAME"

log_info "종료하려면 Ctrl+C"
echo ""

supabase functions logs "$FUNCTION_NAME" --tail
