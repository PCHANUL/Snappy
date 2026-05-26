#!/usr/bin/env bash
# GitHub Pages 정적 페이지 배포
# 기본 구성: main 브랜치의 docs/index.html → https://pchanul.github.io/Snappy/
#
# 사용법:
#   bash scripts/deploy-pages.sh              # docs/index.html 검증 후 origin/main push
#   bash scripts/deploy-pages.sh --skip-push  # 로컬 파일/원격 URL 검증만 실행

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
cd "$PROJECT_ROOT"

if [ -f ".env.local" ]; then
  load_env ".env.local"
fi

PAGES_BRANCH="${GITHUB_PAGES_BRANCH:-main}"
PAGES_DIR="${GITHUB_PAGES_DIR:-docs}"
PAGES_ENTRY="${GITHUB_PAGES_ENTRY:-index.html}"
PAGES_URL="${GITHUB_PAGES_URL:-https://pchanul.github.io/Snappy/}"

SKIP_PUSH=0
SKIP_REMOTE_VERIFY=0
YES=0

for arg in "$@"; do
  case $arg in
    --skip-push) SKIP_PUSH=1 ;;
    --skip-remote-verify) SKIP_REMOTE_VERIFY=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help)
      cat <<EOF
사용법: bash scripts/deploy-pages.sh [옵션]

옵션:
  --skip-push             origin/${PAGES_BRANCH} push 스킵
  --skip-remote-verify    GitHub Pages URL 검증 스킵
  --yes, -y               push 확인 질문 자동 승인
  -h, --help              도움말

환경 변수:
  GITHUB_PAGES_BRANCH     Pages 소스 브랜치 (기본: main)
  GITHUB_PAGES_DIR        Pages 소스 디렉토리 (기본: docs)
  GITHUB_PAGES_ENTRY      진입 HTML 파일 (기본: index.html)
  GITHUB_PAGES_URL        공개 URL (기본: https://pchanul.github.io/Snappy/)
EOF
      exit 0
      ;;
    *)
      log_error "알 수 없는 옵션: $arg"
      exit 1
      ;;
  esac
done

PAGES_FILE="$PAGES_DIR/$PAGES_ENTRY"
PAGES_CONFIG="$PAGES_DIR/config.json"
PAGES_TEMPLATE="$PAGES_DIR/template.html"

log_step "GitHub Pages 배포"

require_command "git" "https://git-scm.com/downloads"
if [ $SKIP_REMOTE_VERIFY -eq 0 ]; then
  require_command "curl" "기본 설치되어 있어야 합니다"
fi

if [ ! -s "$PAGES_FILE" ]; then
  log_error "$PAGES_FILE 파일이 없거나 비어 있습니다."
  exit 1
fi

if ! grep -qi '<!doctype html' "$PAGES_FILE"; then
  log_error "$PAGES_FILE 이 HTML 문서로 보이지 않습니다."
  exit 1
fi

if ! grep -qi 'charset="UTF-8"\|charset=UTF-8' "$PAGES_FILE"; then
  log_error "$PAGES_FILE 에 UTF-8 charset 선언이 없습니다."
  exit 1
fi

if ! grep -q 'manage-user' "$PAGES_FILE"; then
  log_warn "$PAGES_FILE 에 manage-user 호출이 없습니다. 셋업 페이지가 의도한 파일인지 확인하세요."
fi

if [ ! -s "$PAGES_TEMPLATE" ]; then
  log_error "$PAGES_TEMPLATE 파일이 없거나 비어 있습니다."
  log_detail "셋업 페이지의 고정 템플릿 링크가 이 파일로 리다이렉트됩니다."
  exit 1
fi

if ! grep -q 'config.json' "$PAGES_TEMPLATE"; then
  log_error "$PAGES_TEMPLATE 에 config.json 참조가 없습니다."
  exit 1
fi

if [ ! -s "$PAGES_CONFIG" ]; then
  log_error "$PAGES_CONFIG 파일이 없거나 비어 있습니다."
  log_detail "노션 템플릿 게시/복제 링크를 template_url에 설정하세요."
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  if ! template_url=$(node - "$PAGES_CONFIG" <<'NODE'
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
    log_error "$PAGES_CONFIG 의 template_url을 읽을 수 없습니다."
    exit 1
  fi
else
  template_url=$(sed -nE 's/.*"template_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$PAGES_CONFIG" | head -1)
  case "$template_url" in
    http://*|https://*) ;;
    *)
      log_error "$PAGES_CONFIG 의 template_url이 유효한 URL로 보이지 않습니다."
      exit 1
      ;;
  esac
fi

log_success "정적 페이지 파일 확인: $PAGES_FILE ($(wc -c < "$PAGES_FILE" | tr -d ' ') bytes)"
log_success "템플릿 리다이렉트 파일 확인: $PAGES_TEMPLATE ($(wc -c < "$PAGES_TEMPLATE" | tr -d ' ') bytes)"
log_success "템플릿 config 확인: $PAGES_CONFIG ($template_url)"

current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [ $SKIP_PUSH -eq 0 ]; then
  if [ "$current_branch" != "$PAGES_BRANCH" ]; then
    log_error "현재 브랜치가 $PAGES_BRANCH 가 아닙니다. 현재: $current_branch"
    log_detail "GitHub Pages가 main/docs를 바라보는 구성이므로 $PAGES_BRANCH 브랜치에서 실행하세요."
    exit 1
  fi

  if [ -n "$(git status --porcelain -- "$PAGES_FILE" "$PAGES_TEMPLATE" "$PAGES_CONFIG")" ]; then
    log_error "$PAGES_FILE, $PAGES_TEMPLATE, 또는 $PAGES_CONFIG 에 커밋되지 않은 변경이 있습니다."
    log_detail "GitHub Pages는 GitHub에 push된 커밋만 배포합니다. 먼저 커밋한 뒤 다시 실행하세요."
    exit 1
  fi

  log_info "origin/$PAGES_BRANCH 상태 확인 중..."
  git fetch origin "$PAGES_BRANCH" --quiet

  local_rev="$(git rev-parse "$PAGES_BRANCH")"
  remote_rev="$(git rev-parse "origin/$PAGES_BRANCH")"

  if [ "$local_rev" = "$remote_rev" ]; then
    log_success "origin/$PAGES_BRANCH 와 동기화되어 있습니다."
  else
    read -r ahead behind < <(git rev-list --left-right --count "$PAGES_BRANCH...origin/$PAGES_BRANCH")

    if [ "$behind" -gt 0 ] && [ "$ahead" -eq 0 ]; then
      log_error "$PAGES_BRANCH 브랜치가 origin/$PAGES_BRANCH 보다 뒤처져 있습니다."
      log_detail "먼저 pull/rebase로 동기화한 뒤 다시 실행하세요."
      exit 1
    fi

    if [ "$behind" -gt 0 ] && [ "$ahead" -gt 0 ]; then
      log_error "$PAGES_BRANCH 브랜치가 origin/$PAGES_BRANCH 와 분기되었습니다."
      log_detail "충돌 가능성이 있으므로 수동으로 정리한 뒤 다시 실행하세요."
      exit 1
    fi

    if [ $YES -eq 1 ] || confirm "origin/$PAGES_BRANCH 로 push해서 GitHub Pages 배포를 시작하시겠습니까?" "Y"; then
      git push origin "$PAGES_BRANCH"
      log_success "origin/$PAGES_BRANCH push 완료"
    else
      log_error "GitHub Pages 배포가 취소되었습니다."
      exit 1
    fi
  fi
else
  log_warn "origin/$PAGES_BRANCH push 스킵"
fi

if [ $SKIP_REMOTE_VERIFY -eq 0 ]; then
  log_info "GitHub Pages URL 확인: $PAGES_URL"

  headers_file="$(mktemp)"
  body_file="$(mktemp)"
  trap 'rm -f "$headers_file" "$body_file"' EXIT

  http_status=$(curl -L -sS --max-time 20 -D "$headers_file" -o "$body_file" -w "%{http_code}" "$PAGES_URL")
  content_type=$(grep -i '^content-type:' "$headers_file" | tail -n 1 | tr -d '\r' || true)

  if [ "$http_status" != "200" ]; then
    log_error "GitHub Pages 응답 이상: HTTP $http_status"
    exit 1
  fi

  if ! echo "$content_type" | grep -qi 'text/html'; then
    log_error "GitHub Pages Content-Type이 HTML이 아닙니다: ${content_type:-unknown}"
    exit 1
  fi

  if ! echo "$content_type" | grep -qi 'charset=utf-8'; then
    log_warn "GitHub Pages Content-Type에 charset=utf-8 이 명시되지 않았습니다: ${content_type:-unknown}"
  fi

  if ! grep -q 'Snappy' "$body_file"; then
    log_warn "GitHub Pages 응답에서 Snappy 텍스트를 찾지 못했습니다."
  fi

  log_success "GitHub Pages 응답 정상 ($http_status, ${content_type:-content-type unknown})"
fi

echo ""
log_success "GitHub Pages 배포 단계 완료"
log_detail "URL: $PAGES_URL"
