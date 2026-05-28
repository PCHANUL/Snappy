#!/usr/bin/env bash
# 전체 배포 흐름을 한 번에 실행
# template creation → template config → preflight → migrate → secrets → functions → GitHub Pages → verify
#
# 사용법:
#   bash scripts/deploy.sh                   # 전체 흐름
#   bash scripts/deploy.sh --yes             # 모든 확인 프롬프트 자동 승인
#   bash scripts/deploy.sh --skip-preflight  # 사전 확인 스킵
#   bash scripts/deploy.sh --skip-db         # 마이그레이션 스킵
#   bash scripts/deploy.sh --functions-only  # 함수만 재배포
#
# 전체 배포 시작 순서:
#   1. 노션 템플릿 부모 페이지 ID 확인(.env.local 없으면 입력)
#   2. node scripts/create-notion-template.js <parent-page-id> 실행
#   3. 생성된 노션 페이지를 게시하고 템플릿 복제를 허용
#   4. 게시/복제 링크 입력 → docs/config.json 의 template_url 자동 반영

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

전체 배포 시작 순서:
  1. 노션 템플릿 부모 페이지 ID 확인(.env.local 없으면 입력)
  2. node scripts/create-notion-template.js <parent-page-id> 실행
  3. 노션에서 생성된 메인 페이지 게시 + 템플릿 복제 허용
  4. 게시/복제 링크 입력 → docs/config.json 의 template_url 자동 반영
  5. 이후 기존 배포 흐름 진행

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

create_and_configure_notion_template() {
  local config_file="docs/config.json"
  local parent_page_id="${NOTION_TEMPLATE_PARENT_PAGE_ID:-}"
  local template_url="${NOTION_TEMPLATE_URL:-}"
  local template_input=""
  local updated_url=""

  log_step "0. 노션 템플릿 생성"

  require_command "node" "https://nodejs.org/"

  if [ -f ".env.local" ]; then
    load_env ".env.local"
    parent_page_id="${NOTION_TEMPLATE_PARENT_PAGE_ID:-$parent_page_id}"
    template_url="${NOTION_TEMPLATE_URL:-$template_url}"
  fi

  if [ -n "$parent_page_id" ]; then
    log_detail "NOTION_TEMPLATE_PARENT_PAGE_ID 값으로 부모 페이지를 사용합니다: $parent_page_id"
  else
    read -r -p "노션 템플릿을 만들 부모 페이지 ID 입력: " parent_page_id
  fi

  if [ -z "$parent_page_id" ]; then
    log_error "부모 페이지 ID가 필요합니다."
    exit 1
  fi

  SNAPPY_DEPLOY_FLOW=1 node "$SCRIPT_DIR/create-notion-template.js" "$parent_page_id"

  log_step "0-1. 노션 템플릿 링크 입력"
  log_detail "생성된 메인 페이지를 Notion에서 열고 공유 → 웹에 게시를 켜세요."
  log_detail "템플릿으로 복제 허용을 켠 뒤 게시/복제 링크를 붙여넣으세요."

  while true; do
    template_input=""
    if [ -n "$template_url" ] && [ "${ASSUME_YES:-0}" = "1" ]; then
      log_detail "NOTION_TEMPLATE_URL 환경 변수 값을 사용합니다."
    elif [ -n "$template_url" ]; then
      read -r -p "노션 템플릿 게시/복제 링크 입력 (Enter=NOTION_TEMPLATE_URL 기본값): " template_input
      template_url="${template_input:-$template_url}"
    else
      read -r -p "노션 템플릿 게시/복제 링크 입력: " template_url
    fi

    if [ -z "$template_url" ]; then
      log_warn "템플릿 링크를 입력해야 합니다."
      continue
    fi

    if updated_url=$(node - "$config_file" "$template_url" <<'NODE'
const fs = require('fs');

try {
  const file = process.argv[2];
  const templateUrl = String(process.argv[3] || '').trim();
  const parsed = new URL(templateUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('template_url must be http(s)');
  }

  const config = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};

  config.template_url = parsed.toString();
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(config.template_url);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
NODE
    ); then
      log_success "$config_file template_url 업데이트: $updated_url"
      break
    fi

    log_warn "유효한 http(s) URL을 입력하세요."
    template_url=""
  done

  log_detail "사용자에게 노출되는 고정 링크: https://pchanul.github.io/Snappy/template.html"
}

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
  log_detail "템플릿 목적지가 바뀌면 deploy.sh 시작 단계에서 새 링크를 입력하세요."
}

commit_template_config_if_needed() {
  local config_file="docs/config.json"
  local pages_branch="${GITHUB_PAGES_BRANCH:-main}"
  local current_branch=""

  require_command "git" "https://git-scm.com/downloads"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_error "Git 저장소 안에서 실행해야 합니다."
    exit 1
  fi

  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "$pages_branch" ]; then
    log_error "현재 브랜치가 $pages_branch 가 아닙니다. 현재: $current_branch"
    log_detail "GitHub Pages 배포와 template_url 커밋은 $pages_branch 브랜치에서 진행하세요."
    exit 1
  fi

  if [ -z "$(git status --porcelain -- "$config_file")" ]; then
    return
  fi

  log_step "0-2. 템플릿 config 커밋"
  log_detail "GitHub Pages는 GitHub에 push된 $config_file 파일을 사용합니다."
  log_detail "방금 입력한 템플릿 링크가 배포되려면 이 변경사항이 먼저 커밋되어야 합니다."

  if confirm "$config_file 변경사항을 커밋하시겠습니까?" "Y"; then
    git add "$config_file"
    if git diff --cached --quiet -- "$config_file"; then
      log_success "$config_file 변경사항이 없습니다."
      return
    fi
    git commit -m "Update Notion template URL" -- "$config_file"
    log_success "$config_file 커밋 완료"
  else
    log_error "$config_file 변경사항을 커밋한 뒤 다시 실행하세요."
    exit 1
  fi
}

cat <<EOF

${BOLD}╔═══════════════════════════════════════════╗
║   트렌드 콘텐츠 발견기 — 배포 시작       ║
╚═══════════════════════════════════════════╝${NC}

EOF

# 0. 노션 템플릿 생성 및 링크 확인
if [ $SKIP_PAGES -eq 0 ]; then
  create_and_configure_notion_template
  validate_template_config
  commit_template_config_if_needed
else
  log_warn "노션 템플릿 생성/링크 확인 스킵 (GitHub Pages 배포 스킵)"
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
