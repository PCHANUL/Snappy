#!/usr/bin/env bash
# Edge Functions 배포
# supabase/functions/ 하위의 함수들을 배포
# 기본: 모든 함수 / 인자 지정 시 특정 함수만

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

# 배포할 함수 목록
# _shared, search, notion 같은 디렉토리는 함수가 아니라 모듈이므로 제외
FUNCTIONS=(
  "trigger-search"
  "manage-user"
  "notion-oauth"
  "load-more"
  "pages"
)

# 도움말
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<EOF
사용법: bash scripts/deploy-functions.sh [함수명...]

인자를 생략하면 모든 배포 대상 함수를 배포합니다.

예시:
  bash scripts/deploy-functions.sh
  bash scripts/deploy-functions.sh trigger-search
  bash scripts/deploy-functions.sh trigger-search manage-user
EOF
  exit 0
fi

# 인자로 특정 함수만 지정 가능
if [ $# -gt 0 ]; then
  FUNCTIONS=("$@")
fi

log_step "Edge Function 배포"

log_info "배포할 함수: ${#FUNCTIONS[@]}개"
for fn in "${FUNCTIONS[@]}"; do
  log_detail "$fn"
done

# 함수 존재 여부 확인
for fn in "${FUNCTIONS[@]}"; do
  if [ ! -f "supabase/functions/$fn/index.ts" ]; then
    log_error "함수가 없습니다: supabase/functions/$fn/index.ts"
    exit 1
  fi
done

echo ""
if ! confirm "배포를 시작하시겠습니까?" "Y"; then
  log_info "취소되었습니다."
  exit 0
fi

# 순서대로 배포
failed=0
for fn in "${FUNCTIONS[@]}"; do
  log_step "배포 중: $fn"

  if supabase functions deploy "$fn" --no-verify-jwt; then
    log_success "$fn 배포 완료"
  else
    log_error "$fn 배포 실패"
    failed=1
  fi
done

if [ $failed -eq 1 ]; then
  log_error "일부 함수 배포에 실패했습니다."
  exit 1
fi

log_step "배포된 함수 URL"

load_env ".env.local"
for fn in "${FUNCTIONS[@]}"; do
  echo -e "${GREEN}$fn${NC}: $SUPABASE_URL/functions/v1/$fn"
done

echo ""
log_success "모든 배포 완료!"
log_detail "다음 단계: bash scripts/verify.sh 로 동작 검증"
