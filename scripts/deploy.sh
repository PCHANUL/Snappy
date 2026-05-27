#!/usr/bin/env bash
# 전체 배포 흐름을 한 번에 실행
# template config → preflight → migrate → secrets → functions → GitHub Pages → verify
#
# 사용법:
#   bash scripts/deploy.sh                   # 전체 흐름
#   bash scripts/deploy.sh --yes             # 모든 확인 프롬프트 자동 승인
#   bash scripts/deploy.sh --skip-preflight  # 사전 확인 스킵
#   bash scripts/deploy.sh --skip-db         # 마이그레이션 스킵
#   bash scripts/deploy.sh --functions-only  # 함수만 재배포
#
# 전체 배포 전 순서:
#   1. node scripts/create-notion-template.js <parent-page-id>
#   2. 생성된 노션 페이지를 게시하고 템플릿 복제를 허용
#   3. 게시/복제 링크를 docs/config.json 의 template_url에 반영
#   4. bash scripts/deploy.sh 실행

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

# 플래그 파싱
SKIP_PREFLIGHT=0
SKIP_DB=0
SKIP_SECRETS=0
SKIP_DEPLOY=0
SKIP_PAGES=0
SKIP_VERIFY=0
FUNCTIONS_ONLY=0
ALL_YES=0

for arg in "$@"; do
  case $arg in
    --yes|-y) ALL_YES=1 ;;
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
  --yes, -y           모든 확인 프롬프트 자동 승인
  -h, --help          도움말

전체 배포 전 순서:
  1. node scripts/create-notion-template.js <parent-page-id>
  2. 노션에서 생성된 메인 페이지 게시 + 템플릿 복제 허용
  3. docs/config.json 의 template_url 을 게시/복제 링크로 변경
  4. bash scripts/deploy.sh 실행

예시:
  bash scripts/deploy.sh                    # 전체 흐름
  bash scripts/deploy.sh --yes              # 전체 흐름 + 모든 확인 자동 승인
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

if [ $ALL_YES -eq 1 ]; then
  export ASSUME_YES=1
fi

# 시작 시각
START_TIME=$(date +%s)

validate_template_config() {
  local config_file="docs/config.json"
  local template_url=""

  log_step "0. 노션 템플릿 링크 확인"

  if [ ! -f "$config_file" ]; then
    log_error "$config_file 파일이 없습니다."
    log_detail "노션 템플릿을 게시한 뒤 template_url을 설정하세요."
    exit 1
  fi

  if command -v node >/dev/null 2>&1; then
    if ! template_url=$(node - "$config_file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const templateUrl = String(config.template_url || '').trim();
if (!templateUrl) throw new Error('template_url is empty');
const parsed = new URL(templateUrl);
if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('template_url must be http(s)');
console.log(parsed.toString());
NODE
    ); then
      log_error "$config_file 의 template_url을 읽을 수 없습니다."
      log_detail "노션 템플릿 게시/복제 링크를 template_url에 넣어주세요."
      exit 1
    fi
  else
    log_warn "node가 없어 $config_file JSON 검증을 단순 검사로 대체합니다."
    template_url=$(sed -nE 's/.*"template_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$config_file" | head -1)
    case "$template_url" in
      http://*|https://*) ;;
      *)
        log_error "$config_file 의 template_url이 유효한 URL로 보이지 않습니다."
        exit 1
        ;;
    esac
  fi

  log_success "템플릿 링크 확인: $template_url"
  log_detail "사용자에게 노출되는 고정 링크: https://pchanul.github.io/Snappy/template.html"
  log_detail "템플릿 목적지가 바뀌면 deploy.sh 실행 전에 docs/config.json을 먼저 수정하세요."
}

cat <<EOF

${BOLD}╔═══════════════════════════════════════════╗
║   트렌드 콘텐츠 발견기 — 배포 시작       ║
╚═══════════════════════════════════════════╝${NC}

EOF

# 0. 노션 템플릿 링크 확인
if [ $SKIP_PAGES -eq 0 ]; then
  validate_template_config
else
  log_warn "노션 템플릿 링크 확인 스킵 (GitHub Pages 배포 스킵)"
fi

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
  log_detail "2. 고정 템플릿 링크 확인: https://pchanul.github.io/Snappy/template.html"
  log_detail "3. 첫 사용자 인증키 발급 후 실제 셋업/검색 테스트"
fi
