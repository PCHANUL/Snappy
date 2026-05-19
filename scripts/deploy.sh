#!/usr/bin/env bash
# 전체 배포 흐름을 한 번에 실행
# preflight → migrate → secrets → functions → GitHub Pages → verify
#
# 사용법:
#   bash scripts/deploy.sh                   # 전체 흐름
#   bash scripts/deploy.sh --skip-preflight  # 사전 확인 스킵
#   bash scripts/deploy.sh --skip-db         # 마이그레이션 스킵
#   bash scripts/deploy.sh --functions-only  # 함수만 재배포

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

# 플래그 파싱
SKIP_PREFLIGHT=0
SKIP_DB=0
SKIP_SECRETS=0
SKIP_DEPLOY=0
SKIP_PAGES=0
SKIP_VERIFY=0
FUNCTIONS_ONLY=0

for arg in "$@"; do
  case $arg in
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --skip-db) SKIP_DB=1 ;;
    --skip-secrets) SKIP_SECRETS=1 ;;
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --skip-pages) SKIP_PAGES=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --functions-only)
      FUNCTIONS_ONLY=1
      SKIP_PREFLIGHT=1
      SKIP_DB=1
      SKIP_SECRETS=1
      SKIP_PAGES=1
      SKIP_VERIFY=1
      ;;
    -h|--help)
      cat <<EOF
사용법: bash scripts/deploy.sh [옵션]

옵션:
  --skip-preflight    사전 확인 스킵
  --skip-db           DB 마이그레이션 스킵
  --skip-secrets      시크릿 등록 스킵
  --skip-deploy       Edge Function 배포 스킵
  --skip-pages        GitHub Pages 배포 스킵
  --skip-verify       검증 스킵
  --functions-only    함수만 재배포 (preflight/db/secrets/pages/verify 모두 스킵)
  -h, --help          도움말

예시:
  bash scripts/deploy.sh                    # 전체 흐름
  bash scripts/deploy.sh --functions-only   # 코드 변경 후 빠른 재배포
  bash scripts/deploy.sh --skip-db          # 마이그레이션 이미 했을 때
  bash scripts/deploy.sh --skip-pages       # GitHub Pages는 따로 배포할 때
EOF
      exit 0
      ;;
    *)
      log_error "알 수 없는 옵션: $arg"
      exit 1
      ;;
  esac
done

# 시작 시각
START_TIME=$(date +%s)

cat <<EOF

${BOLD}╔═══════════════════════════════════════════╗
║   트렌드 콘텐츠 발견기 — 배포 시작       ║
╚═══════════════════════════════════════════╝${NC}

EOF

# 1. 사전 확인
if [ $SKIP_PREFLIGHT -eq 0 ]; then
  bash "$SCRIPT_DIR/preflight.sh"
else
  log_warn "사전 확인 스킵"
fi

# 2. DB 마이그레이션
if [ $SKIP_DB -eq 0 ]; then
  bash "$SCRIPT_DIR/migrate-db.sh"
else
  log_warn "DB 마이그레이션 스킵"
fi

# 3. 시크릿 등록
if [ $SKIP_SECRETS -eq 0 ]; then
  bash "$SCRIPT_DIR/set-secrets.sh"
else
  log_warn "시크릿 등록 스킵"
fi

# 4. 함수 배포
if [ $SKIP_DEPLOY -eq 0 ]; then
  bash "$SCRIPT_DIR/deploy-functions.sh"
else
  log_warn "함수 배포 스킵"
fi

# 5. GitHub Pages 배포
if [ $SKIP_PAGES -eq 0 ]; then
  bash "$SCRIPT_DIR/deploy-pages.sh"
else
  log_warn "GitHub Pages 배포 스킵"
fi

# 6. 검증
if [ $SKIP_VERIFY -eq 0 ]; then
  bash "$SCRIPT_DIR/verify.sh"
else
  log_warn "검증 스킵"
fi

# 완료
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

cat <<EOF

${GREEN}${BOLD}╔═══════════════════════════════════════════╗
║   배포 완료! (${ELAPSED}초 소요)                  ║
╚═══════════════════════════════════════════╝${NC}

EOF

if [ $FUNCTIONS_ONLY -eq 1 ]; then
  log_info "다음에 코드 변경했을 때:"
  log_detail "bash scripts/deploy.sh --functions-only"
else
  log_info "다음 단계:"
  log_detail "1. 셋업 페이지 확인: https://pchanul.github.io/Snappy/"
  log_detail "2. 노션 통합 생성 (https://notion.so/my-integrations)"
  log_detail "3. 노션 템플릿 제작 및 자동화 설정"
  log_detail "4. 첫 사용자로 가입 후 실제 검색 테스트"
fi
