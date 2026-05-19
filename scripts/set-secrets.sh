#!/usr/bin/env bash
# Supabase 시크릿(환경 변수) 등록
# .env.local 의 값을 Supabase Edge Function 환경 변수로 등록

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

log_step "Supabase 시크릿 등록"

load_env ".env.local"

# Supabase 자동 주입 변수는 등록하지 않음
# (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY는 자동 제공)
SECRETS_TO_SET=(
  "NAVER_CLIENT_ID"
  "NAVER_CLIENT_SECRET"
  "YOUTUBE_API_KEY"
  "YOUCOM_API_KEY"
  "NOTION_KEY_ENCRYPTION_SECRET"
)

# 운영 환경 변수 (선택)
if [ -n "${ENVIRONMENT:-}" ]; then
  SECRETS_TO_SET+=("ENVIRONMENT")
fi
if [ -n "${LOG_LEVEL:-}" ]; then
  SECRETS_TO_SET+=("LOG_LEVEL")
fi

log_info "등록할 시크릿: ${#SECRETS_TO_SET[@]}개"
for var in "${SECRETS_TO_SET[@]}"; do
  log_detail "$var"
done

echo ""
if ! confirm "원격 Supabase에 등록하시겠습니까?" "Y"; then
  log_info "취소되었습니다."
  exit 0
fi

# 임시 env 파일 생성 (필요한 값만)
temp_env=$(mktemp)
trap "rm -f $temp_env" EXIT

for var in "${SECRETS_TO_SET[@]}"; do
  value="${!var:-}"
  if [ -z "$value" ]; then
    log_warn "$var 값이 비어있어 건너뜁니다."
    continue
  fi
  echo "$var=$value" >> "$temp_env"
done

log_info "시크릿 등록 중..."
if supabase secrets set --env-file "$temp_env"; then
  log_success "시크릿 등록 완료"
else
  log_error "시크릿 등록 실패"
  exit 1
fi

log_step "등록된 시크릿 목록"
supabase secrets list
