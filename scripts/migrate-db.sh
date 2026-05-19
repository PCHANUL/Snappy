#!/usr/bin/env bash
# DB 마이그레이션 실행
# supabase/migrations/ 의 SQL 파일들을 순서대로 실행

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

log_step "DB 마이그레이션"

# 마이그레이션 파일 확인
migration_count=$(find supabase/migrations -name "*.sql" 2>/dev/null | wc -l)
if [ "$migration_count" -eq 0 ]; then
  log_error "supabase/migrations에 SQL 파일이 없습니다."
  exit 1
fi

log_info "발견된 마이그레이션 파일: ${migration_count}개"
find supabase/migrations -name "*.sql" | sort | while read -r file; do
  log_detail "$(basename "$file")"
done

echo ""
log_warn "이 작업은 원격 Supabase DB에 적용됩니다."
if ! confirm "계속하시겠습니까?" "Y"; then
  log_info "취소되었습니다."
  exit 0
fi

log_info "마이그레이션 실행 중..."

# supabase db push 사용
if supabase db push 2>&1; then
  log_success "마이그레이션 완료"
else
  log_error "마이그레이션 실패"
  log_detail "원격 DB와 로컬 마이그레이션이 충돌할 수 있습니다."
  log_detail "강제 적용하려면: supabase db push --include-all"
  exit 1
fi

log_step "마이그레이션 후 검증"

log_info "다음 테이블이 생성되었는지 확인하세요:"
log_detail "- users"
log_detail "- search_logs"
log_detail "- usage_quotas"
log_info "Supabase 대시보드 > Table Editor에서 확인 가능"
