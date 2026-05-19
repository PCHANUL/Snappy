#!/usr/bin/env bash
# 배포된 시스템 검증
# 1. 함수 응답 확인
# 2. 가입 → 노션 키 등록 → 사용량 조회 흐름 검증
# 3. (선택) 실제 검색 흐름까지 검증

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

load_env ".env.local"

# 필수 환경 변수
require_env "SUPABASE_URL"
require_env "SUPABASE_ANON_KEY"

# jq 필수 (JSON 파싱)
require_command "jq" "Mac: brew install jq / Linux: apt install jq"

BASE_URL="$SUPABASE_URL/functions/v1"
AUTH_HEADER="Authorization: Bearer $SUPABASE_ANON_KEY"

log_step "1. 함수 응답 확인 (Smoke Test)"

# trigger-search 응답 (인증 없이 호출 시 400 기대)
log_info "trigger-search 응답 확인..."
trigger_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/trigger-search" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{}')

# 400 = validation error (정상 응답)
if [ "$trigger_status" = "400" ]; then
  log_success "trigger-search 응답 정상 ($trigger_status — validation 작동)"
elif [ "$trigger_status" = "404" ]; then
  log_error "trigger-search 함수가 배포되지 않았습니다."
  exit 1
else
  log_warn "trigger-search 예상치 못한 응답: $trigger_status"
fi

# manage-user 응답 (action 없이 호출 시 400 기대)
log_info "manage-user 응답 확인..."
manage_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/manage-user" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{}')

if [ "$manage_status" = "400" ]; then
  log_success "manage-user 응답 정상 ($manage_status — validation 작동)"
elif [ "$manage_status" = "404" ]; then
  log_error "manage-user 함수가 배포되지 않았습니다."
  exit 1
else
  log_warn "manage-user 예상치 못한 응답: $manage_status"
fi

log_step "2. 가입 → 노션 등록 → 사용량 조회 흐름"

if ! confirm "이 흐름을 테스트하시겠습니까? (테스트 사용자가 DB에 추가됩니다)" "Y"; then
  log_info "스킵."
  echo ""
  log_success "기본 검증 완료!"
  exit 0
fi

# 테스트용 이메일 (고유값)
TEST_EMAIL="test-$(date +%s)@example.com"
log_info "테스트 이메일: $TEST_EMAIL"

# 1) 가입
log_info "가입 요청..."
signup_response=$(curl -s -X POST "$BASE_URL/manage-user?action=signup" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$TEST_EMAIL\"}")

echo "$signup_response" | jq '.'

USER_ID=$(echo "$signup_response" | jq -r '.user_id // empty')

if [ -z "$USER_ID" ]; then
  log_error "가입 실패 또는 user_id 누락"
  exit 1
fi

log_success "가입 성공 (user_id: $USER_ID)"

# 2) 노션 키 등록 (선택)
echo ""
if confirm "노션 API 키 등록도 테스트하시겠습니까?" "N"; then
  read -p "노션 API 키 입력 (secret_...): " notion_key
  read -p "노션 DB ID 입력: " notion_db_id

  log_info "노션 키 등록 요청..."
  notion_setup_response=$(curl -s -X POST "$BASE_URL/manage-user?action=setup-notion" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{
      \"user_id\": \"$USER_ID\",
      \"notion_api_key\": \"$notion_key\",
      \"notion_database_id\": \"$notion_db_id\"
    }")

  echo "$notion_setup_response" | jq '.'

  if echo "$notion_setup_response" | jq -e '.success' > /dev/null; then
    log_success "노션 키 등록 성공"
  else
    log_error "노션 키 등록 실패"
  fi
fi

# 3) 사용량 조회
log_info "사용량 조회..."
usage_response=$(curl -s -X GET \
  "$BASE_URL/manage-user?action=usage&user_id=$USER_ID" \
  -H "$AUTH_HEADER")

echo "$usage_response" | jq '.'

if echo "$usage_response" | jq -e '.today' > /dev/null; then
  log_success "사용량 조회 성공"
else
  log_error "사용량 조회 실패"
fi

log_step "3. 테스트 사용자 정리"

if confirm "테스트 사용자를 DB에서 삭제하시겠습니까?" "Y"; then
  log_info "다음 SQL을 Supabase SQL Editor에서 실행하세요:"
  echo ""
  echo "  DELETE FROM users WHERE id = '$USER_ID';"
  echo ""
  log_detail "또는 Supabase 대시보드 > Table Editor에서 직접 삭제"
else
  log_info "테스트 사용자 ID: $USER_ID (수동 정리 필요)"
fi

echo ""
log_success "검증 완료!"
log_detail "다음: 노션 템플릿 제작 후 실제 검색 흐름 테스트"
