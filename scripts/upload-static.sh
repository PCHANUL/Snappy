#!/usr/bin/env bash
# Deprecated: 정적 페이지 배포는 Supabase Storage가 아니라 GitHub Pages를 사용합니다.
# 이전 명령과의 호환성을 위해 deploy-pages.sh로 위임합니다.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

log_warn "scripts/upload-static.sh는 더 이상 Supabase Storage에 업로드하지 않습니다."
log_detail "정적 페이지 배포는 GitHub Pages 기준으로 scripts/deploy-pages.sh를 사용합니다."

exec bash "$SCRIPT_DIR/deploy-pages.sh" "$@"
