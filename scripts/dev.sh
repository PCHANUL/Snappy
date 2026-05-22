#!/usr/bin/env bash
# 로컬 개발 서버 실행
# 코드 변경 시 자동 반영 (Edge Function 로컬 실행)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

log_step "로컬 개발 서버 시작"

# 환경 변수 파일 확인
if [ ! -f ".env.local" ]; then
  log_error ".env.local 파일이 없습니다."
  log_detail "cp .env.example .env.local 후 값을 채우세요."
  exit 1
fi

log_info "환경 변수: .env.local"
log_info "로컬 URL: http://localhost:54321/functions/v1/"
echo ""

log_detail "함수 호출 예시:"
echo "  curl 'http://localhost:54321/functions/v1/manage-user?action=verify-user&user_id=<USER_ID>'"
echo ""

log_warn "종료하려면 Ctrl+C"
echo ""

# 모든 함수 서빙 (--env-file로 환경 변수 주입)
supabase functions serve --env-file .env.local
