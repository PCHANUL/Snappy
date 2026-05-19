#!/usr/bin/env bash
# static/ 디렉토리의 HTML 파일을 Supabase Storage에 업로드
# Content-Type: text/html; charset=utf-8 을 명시해서 브라우저 렌더링 보장
#
# 사용법:
#   bash scripts/upload-static.sh

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

load_env ".env.local"

require_env "SUPABASE_URL"
require_env "SUPABASE_SERVICE_ROLE_KEY"

BUCKET="static"
STATIC_DIR="$PROJECT_ROOT/static"

if [ ! -d "$STATIC_DIR" ]; then
  log_error "static/ 디렉토리가 없습니다."
  exit 1
fi

# ── 버킷 생성 (이미 있으면 무시) ──────────────────────────────
log_step "Storage 버킷 확인"

bucket_res=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$BUCKET\", \"name\": \"$BUCKET\", \"public\": true}")

if [ "$bucket_res" = "200" ] || [ "$bucket_res" = "409" ]; then
  log_success "버킷 준비 완료 ($BUCKET)"
else
  log_error "버킷 생성 실패 (HTTP $bucket_res)"
  exit 1
fi

# ── HTML 파일 업로드 ──────────────────────────────────────────
log_step "HTML 파일 업로드"

for filepath in "$STATIC_DIR"/*.html; do
  [ -f "$filepath" ] || continue
  filename="$(basename "$filepath")"

  log_info "업로드 중: $filename"

  upload_res=$(curl -s -o /tmp/upload_response.json -w "%{http_code}" \
    -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$filename" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: text/html; charset=utf-8" \
    -H "x-upsert: true" \
    --data-binary "@$filepath")

  if [ "$upload_res" = "200" ] || [ "$upload_res" = "409" ]; then
    PUBLIC_URL="$SUPABASE_URL/storage/v1/object/public/$BUCKET/$filename"
    log_success "$filename 업로드 완료"
    log_detail "URL: $PUBLIC_URL"
  else
    log_error "$filename 업로드 실패 (HTTP $upload_res)"
    cat /tmp/upload_response.json
    exit 1
  fi
done

echo ""
log_success "완료!"
log_detail "브라우저에서 위 URL에 접속해 HTML이 렌더링되는지 확인하세요."
