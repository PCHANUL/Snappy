#!/usr/bin/env bash
# 배포된 시스템 검증
# 1. 함수/GitHub Pages 응답 확인
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
PAGES_URL="${GITHUB_PAGES_URL:-https://pchanul.github.io/Snappy/}"
FIRST_NOTION_DB_ID=""

list_notion_databases() {
  local notion_key="$1"
  local response_file
  local status
  local count

  response_file="$(mktemp)"

  if ! status=$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "https://api.notion.com/v1/search" \
    -H "Authorization: Bearer $notion_key" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{
      "filter": { "value": "database", "property": "object" },
      "sort": { "direction": "descending", "timestamp": "last_edited_time" },
      "page_size": 100
    }'); then
    rm -f "$response_file"
    log_error "노션 데이터베이스 목록 조회 요청 실패"
    return 1
  fi

  if [ "$status" != "200" ]; then
    log_error "노션 데이터베이스 목록 조회 실패 (HTTP $status)"
    jq '.' "$response_file" 2>/dev/null || cat "$response_file"
    rm -f "$response_file"
    return 1
  fi

  count=$(jq '.results | length' "$response_file")
  FIRST_NOTION_DB_ID=$(jq -r '.results[0].id // "" | gsub("-"; "")' "$response_file")

  if [ "$count" -eq 0 ]; then
    log_warn "접근 가능한 노션 데이터베이스가 없습니다."
    log_detail "노션 DB 페이지에서 우측 상단 ... → 연결 → 통합 추가 후 다시 시도하세요."
    rm -f "$response_file"
    return 2
  fi

  log_success "접근 가능한 노션 데이터베이스: ${count}개"
  jq -r '
    .results[]
    | [
        (.id | gsub("-"; "")),
        ((.title // []) | map(.plain_text) | join("") | if . == "" then "제목 없음" else . end),
        (.last_edited_time // "")
      ]
    | @tsv
  ' "$response_file" | while IFS=$'\t' read -r db_id title last_edited; do
    log_detail "- $db_id | $title | 수정: $last_edited"
  done

  rm -f "$response_file"
  return 0
}

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

# pages 함수 응답 (GET 시 200 + text/html 기대)
log_info "pages 함수 응답 확인..."
pages_status=$(curl -L -s -o /dev/null -w "%{http_code}" \
  -X GET "$BASE_URL/pages" \
  -H "$AUTH_HEADER")

if [ "$pages_status" = "200" ]; then
  log_success "pages 응답 정상 ($pages_status)"
elif [ "$pages_status" = "404" ]; then
  log_error "pages 함수가 배포되지 않았습니다."
  exit 1
else
  log_warn "pages 예상치 못한 응답: $pages_status"
fi

log_info "GitHub Pages 응답 확인..."
pages_headers_file="$(mktemp)"
pages_body_file="$(mktemp)"
trap 'rm -f "$pages_headers_file" "$pages_body_file"' EXIT

github_pages_status=$(curl -L -sS --max-time 20 \
  -D "$pages_headers_file" \
  -o "$pages_body_file" \
  -w "%{http_code}" \
  "$PAGES_URL")
github_pages_content_type=$(grep -i '^content-type:' "$pages_headers_file" | tail -n 1 | tr -d '\r' || true)

if [ "$github_pages_status" = "200" ]; then
  if echo "$github_pages_content_type" | grep -qi 'text/html' && grep -q 'Snappy' "$pages_body_file"; then
    log_success "GitHub Pages 응답 정상 ($github_pages_status — ${github_pages_content_type:-content-type unknown})"
  else
    log_warn "GitHub Pages 응답은 200이지만 HTML 내용 확인이 필요합니다."
    log_detail "URL: $PAGES_URL"
  fi
else
  log_error "GitHub Pages 응답 이상 ($github_pages_status)"
  log_detail "URL: $PAGES_URL"
  exit 1
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
  if [ -n "${NOTION_API_KEY:-}" ]; then
    read -p "노션 API 키 입력 (Enter=.env.local NOTION_API_KEY 사용): " notion_key
    notion_key="${notion_key:-$NOTION_API_KEY}"
  else
    read -p "노션 API 키 입력 (ntn_... 또는 secret_...): " notion_key
  fi

  if [ -z "$notion_key" ]; then
    log_error "노션 API 키가 없어 노션 등록 테스트를 스킵합니다."
  else
    log_info "노션 API로 접근 가능한 데이터베이스 목록 조회..."
    if list_notion_databases "$notion_key" && [ -n "$FIRST_NOTION_DB_ID" ]; then
      read -p "노션 DB ID 입력 (Enter=첫 번째 DB 사용): " notion_db_id
      notion_db_id="${notion_db_id:-$FIRST_NOTION_DB_ID}"
    else
      read -p "노션 DB ID 입력 (목록에서 직접 복사 또는 수동 입력): " notion_db_id
    fi

    if [ -z "$notion_db_id" ]; then
      log_error "노션 DB ID가 없어 노션 등록 테스트를 스킵합니다."
    else
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
