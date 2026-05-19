#!/usr/bin/env bash
# 공통 유틸리티 함수
# 다른 스크립트에서 source로 불러서 사용

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 로그 함수
log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}" >&2
}

log_step() {
  echo ""
  echo -e "${BOLD}${BLUE}━━━ $1 ━━━${NC}"
}

log_detail() {
  echo -e "${GRAY}   $1${NC}"
}

# 필수 명령어 확인
require_command() {
  if ! command -v "$1" &> /dev/null; then
    log_error "$1 명령어가 필요합니다."
    log_detail "설치 방법: $2"
    exit 1
  fi
}

# .env.local 파일 로드
load_env() {
  local env_file="${1:-.env.local}"
  if [ ! -f "$env_file" ]; then
    log_error "$env_file 파일이 없습니다."
    log_detail ".env.example을 복사해서 값을 채우세요: cp .env.example $env_file"
    exit 1
  fi

  # set -a: 자동 export
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

# 필수 환경 변수 체크
require_env() {
  local var_name="$1"
  if [ -z "${!var_name}" ]; then
    log_error "환경 변수 $var_name 가 설정되지 않았습니다."
    exit 1
  fi
}

# 사용자 확인
confirm() {
  local prompt="${1:-계속하시겠습니까?}"
  local default="${2:-N}"

  local options
  if [ "$default" = "Y" ]; then
    options="[Y/n]"
  else
    options="[y/N]"
  fi

  read -p "$prompt $options " -n 1 -r
  echo

  if [ -z "$REPLY" ]; then
    REPLY="$default"
  fi

  [[ $REPLY =~ ^[Yy]$ ]]
}

# 스크립트 루트 디렉토리 찾기 (이 파일 기준)
get_project_root() {
  local script_dir
  script_dir="$( cd "$( dirname "${BASH_SOURCE[1]}" )" && pwd )"
  echo "$( cd "$script_dir/.." && pwd )"
}
