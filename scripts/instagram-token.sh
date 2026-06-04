#!/usr/bin/env bash
# 인스타그램 Graph API 자격증명 발급 도우미
#
# 단기 토큰 + App ID/Secret 을 받아서:
#   1. 장기 사용자 액세스 토큰(60일)으로 교환
#   2. 연결된 Facebook 페이지 조회
#   3. 페이지에 연결된 Instagram 비즈니스 계정 ID 조회
# 결과로 INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID 를 출력하고
# 원하면 .env.local 에 기록한다.
#
# 사전 준비 (이게 안 되어 있으면 발급해도 동작하지 않음):
#   - 인스타 계정을 비즈니스/크리에이터로 전환 + Facebook 페이지에 연결
#   - Meta 개발자 앱 생성 (https://developers.facebook.com) → App ID / App Secret 확보
#   - Graph API Explorer 에서 단기 User Token 발급
#     권한: instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement
#
# 사용법:
#   bash scripts/instagram-token.sh
#     → 대화형으로 값 입력
#   APP_ID=... APP_SECRET=... SHORT_TOKEN=... bash scripts/instagram-token.sh
#     → 환경변수로 비대화형 실행

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

require_command curl "apt install curl"
require_command jq "apt install jq"

GRAPH="https://graph.facebook.com/v21.0"

log_step "인스타그램 Graph API 자격증명 발급"

# ── 입력값 수집 ───────────────────────────────────────────────────────────────
APP_ID="${APP_ID:-}"
APP_SECRET="${APP_SECRET:-}"
SHORT_TOKEN="${SHORT_TOKEN:-}"

if [ -z "$APP_ID" ]; then
  read -p "App ID: " APP_ID
fi
if [ -z "$APP_SECRET" ]; then
  read -p "App Secret: " APP_SECRET
fi
if [ -z "$SHORT_TOKEN" ]; then
  echo ""
  log_detail "Graph API Explorer(https://developers.facebook.com/tools/explorer)에서"
  log_detail "단기 User Token을 생성해 붙여넣으세요."
  read -p "단기 토큰(short-lived token): " SHORT_TOKEN
fi

if [ -z "$APP_ID" ] || [ -z "$APP_SECRET" ] || [ -z "$SHORT_TOKEN" ]; then
  log_error "App ID / App Secret / 단기 토큰이 모두 필요합니다."
  exit 1
fi

# Graph API 응답에서 에러를 감지해 메시지를 출력하고 종료
check_error() {
  local resp="$1"
  local context="$2"
  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    log_error "$context 실패"
    echo "$resp" | jq -r '.error | "   [\(.code)] \(.message)"' >&2
    exit 1
  fi
}

# ── 1. 단기 → 장기 토큰(60일) 교환 ───────────────────────────────────────────
log_step "1/3 장기 토큰(60일) 교환 중"

exchange_resp=$(curl -sG "$GRAPH/oauth/access_token" \
  --data-urlencode "grant_type=fb_exchange_token" \
  --data-urlencode "client_id=$APP_ID" \
  --data-urlencode "client_secret=$APP_SECRET" \
  --data-urlencode "fb_exchange_token=$SHORT_TOKEN")

check_error "$exchange_resp" "장기 토큰 교환"

LONG_TOKEN=$(echo "$exchange_resp" | jq -r '.access_token')
EXPIRES_IN=$(echo "$exchange_resp" | jq -r '.expires_in // 0')
if [ -z "$LONG_TOKEN" ] || [ "$LONG_TOKEN" = "null" ]; then
  log_error "장기 토큰을 받지 못했습니다."
  exit 1
fi

expire_days=$(( EXPIRES_IN / 86400 ))
log_success "장기 토큰 발급 완료 (약 ${expire_days}일 유효)"

# ── 2. 연결된 Facebook 페이지 조회 ──────────────────────────────────────────
log_step "2/3 연결된 Facebook 페이지 조회 중"

pages_resp=$(curl -sG "$GRAPH/me/accounts" \
  --data-urlencode "access_token=$LONG_TOKEN")

check_error "$pages_resp" "페이지 목록 조회"

page_count=$(echo "$pages_resp" | jq '.data | length')
if [ "$page_count" -eq 0 ]; then
  log_error "연결된 Facebook 페이지가 없습니다."
  log_detail "인스타 비즈니스 계정을 Facebook 페이지에 먼저 연결하세요."
  exit 1
fi

PAGE_ID=""
if [ "$page_count" -eq 1 ]; then
  PAGE_ID=$(echo "$pages_resp" | jq -r '.data[0].id')
  page_name=$(echo "$pages_resp" | jq -r '.data[0].name')
  log_success "페이지: $page_name ($PAGE_ID)"
else
  log_info "페이지가 여러 개입니다. 선택하세요:"
  echo "$pages_resp" | jq -r '.data | to_entries[] | "   \(.key + 1)) \(.value.name) — \(.value.id)"'
  read -p "번호 선택: " idx
  PAGE_ID=$(echo "$pages_resp" | jq -r ".data[$((idx - 1))].id")
  if [ -z "$PAGE_ID" ] || [ "$PAGE_ID" = "null" ]; then
    log_error "잘못된 선택입니다."
    exit 1
  fi
fi

# ── 3. 페이지 → 인스타 비즈니스 계정 ID 조회 ────────────────────────────────
log_step "3/3 인스타그램 비즈니스 계정 ID 조회 중"

ig_resp=$(curl -sG "$GRAPH/$PAGE_ID" \
  --data-urlencode "fields=instagram_business_account{id,username}" \
  --data-urlencode "access_token=$LONG_TOKEN")

check_error "$ig_resp" "인스타 계정 조회"

BUSINESS_ACCOUNT_ID=$(echo "$ig_resp" | jq -r '.instagram_business_account.id // empty')
ig_username=$(echo "$ig_resp" | jq -r '.instagram_business_account.username // empty')

if [ -z "$BUSINESS_ACCOUNT_ID" ]; then
  log_error "이 페이지에 연결된 인스타 비즈니스 계정이 없습니다."
  log_detail "인스타 앱 → 설정 → 계정 → 페이지 연결을 확인하세요."
  exit 1
fi

log_success "인스타 계정: @$ig_username ($BUSINESS_ACCOUNT_ID)"

# ── 결과 출력 ────────────────────────────────────────────────────────────────
log_step "발급 완료"
echo ""
echo "INSTAGRAM_ACCESS_TOKEN=$LONG_TOKEN"
echo "INSTAGRAM_BUSINESS_ACCOUNT_ID=$BUSINESS_ACCOUNT_ID"
echo ""
log_warn "이 장기 토큰은 약 ${expire_days}일 후 만료됩니다. 만료 전 재발급하세요."

# ── .env.local 기록 (선택) ───────────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env.local"
echo ""
if confirm ".env.local 에 기록하시겠습니까?" "Y"; then
  touch "$ENV_FILE"
  # 기존 항목 제거 후 추가 (중복 방지)
  if [ -s "$ENV_FILE" ]; then
    grep -v -E '^(INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID)=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  {
    echo "INSTAGRAM_ACCESS_TOKEN=$LONG_TOKEN"
    echo "INSTAGRAM_BUSINESS_ACCOUNT_ID=$BUSINESS_ACCOUNT_ID"
  } >> "$ENV_FILE"
  log_success ".env.local 업데이트 완료"
  log_detail "Supabase 반영: bash scripts/set-secrets.sh"
else
  log_info "수동으로 .env.local 에 위 두 줄을 추가하세요."
fi
