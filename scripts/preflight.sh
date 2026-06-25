#!/usr/bin/env bash
# 배포 전 사전 확인
# - 필수 도구 설치 여부
# - 환경 변수 누락 여부
# - Supabase 프로젝트 연결 상태

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

log_step "1. 필수 명령어 확인"

require_command "supabase" "npm install -g supabase"
log_success "supabase CLI: $(supabase --version)"

require_command "curl" "기본 설치되어 있어야 합니다"
log_success "curl 사용 가능"

# jq는 검증 스크립트에서 사용 (선택)
if command -v jq &> /dev/null; then
  log_success "jq 사용 가능"
else
  log_warn "jq가 없습니다. (검증 스크립트에서 JSON 파싱에 필요)"
  log_detail "설치: brew install jq (Mac) / apt install jq (Linux)"
fi

log_step "2. 환경 변수 파일 확인"

if [ ! -f ".env.local" ]; then
  log_error ".env.local 파일이 없습니다."
  log_detail "cp .env.example .env.local 후 값을 채우세요."
  exit 1
fi

log_success ".env.local 존재 확인"

load_env ".env.local"

# 필수 환경 변수 체크
REQUIRED_VARS=(
  "SUPABASE_URL"
  "SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "NAVER_CLIENT_ID"
  "NAVER_CLIENT_SECRET"
  "TAVILY_API_KEY"
  "NOTION_KEY_ENCRYPTION_SECRET"
  "NOTION_CLIENT_ID"
  "NOTION_CLIENT_SECRET"
  "NOTION_REDIRECT_URI"
)

missing=0
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    log_error "환경 변수 누락: $var"
    missing=1
  else
    # 값 길이만 표시 (보안)
    value="${!var}"
    log_success "$var (${#value} chars)"
  fi
done

if [ $missing -eq 1 ]; then
  log_error "필수 환경 변수가 누락되었습니다."
  exit 1
fi

log_step "3. Supabase 프로젝트 연결 상태"

if [ ! -f "supabase/.temp/project-ref" ] && [ ! -f ".supabase/project-ref" ]; then
  log_warn "Supabase 프로젝트가 연결되지 않았습니다."
  log_detail "다음 명령으로 연결: supabase link --project-ref [YOUR_REF]"

  if confirm "지금 연결하시겠습니까?" "Y"; then
    read -p "Supabase 프로젝트 ref 입력: " project_ref
    supabase link --project-ref "$project_ref"
    log_success "프로젝트 연결 완료"
  else
    log_error "프로젝트 연결 후 다시 실행하세요."
    exit 1
  fi
else
  log_success "Supabase 프로젝트 연결됨"
fi

log_step "4. 외부 API 키 검증"

# 네이버 DataLab API 검증 (연관 키워드/트렌드 분석용)
log_info "네이버 DataLab API 호출 테스트..."
naver_response=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2024-01-01","endDate":"2024-01-31","timeUnit":"month","keywordGroups":[{"groupName":"test","keywords":["test"]}]}' \
  "https://openapi.naver.com/v1/datalab/search")

if [ "$naver_response" = "200" ]; then
  log_success "네이버 DataLab API 정상 (200)"
else
  log_error "네이버 DataLab API 응답 이상 ($naver_response)"
  log_detail "Client ID/Secret을 확인하세요."
  exit 1
fi

# Tavily API 검증
log_info "Tavily API 호출 테스트..."
tavily_response=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://api.tavily.com/search" \
  -H "Authorization: Bearer $TAVILY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":1,"search_depth":"basic"}')

if [ "$tavily_response" = "200" ]; then
  log_success "Tavily API 정상 (200)"
else
  log_error "Tavily API 응답 이상 ($tavily_response)"
  log_detail "API 키를 확인하세요. https://app.tavily.com"
  exit 1
fi

echo ""
log_success "모든 사전 확인 통과!"
log_detail "이제 'bash scripts/deploy.sh'로 배포할 수 있습니다."
