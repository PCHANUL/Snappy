# 트렌드 콘텐츠 발견기

키워드 입력 한 번으로 매체별 인기 콘텐츠를 노션에 자동 정리하는 SaaS.

## 기준 문서

- 제품 기획서: `docs/specs/trend-content-finder-spec-v4.md`
- 구현 계획서: `docs/specs/trend-content-finder-phases-v4.md`
- 현재 구현 요약: `PLANNING.md`

## 구조

```
docs/
└── index.html                # GitHub Pages 셋업 페이지
supabase/
├── functions/
│   ├── _shared/              # 공통 모듈
│   │   ├── types.ts          # 타입 정의
│   │   ├── env.ts            # 환경 변수
│   │   ├── logger.ts         # 로깅
│   │   ├── errors.ts         # 에러 클래스
│   │   ├── db.ts             # DB 접근
│   │   └── validator.ts      # 요청 검증
│   ├── search/               # 검색 모듈
│   │   ├── naver.ts          # 네이버 검색 API
│   │   ├── youtube.ts        # YouTube Data API
│   │   ├── youcom.ts         # You.com (티스토리/브런치)
│   │   └── orchestrator.ts   # 통합 오케스트레이터
│   ├── notion/               # 노션 연동
│   │   ├── client.ts         # 노션 API 클라이언트
│   │   └── blocks.ts         # 블록 빌더
│   ├── trigger-search/       # 메인 Edge Function
│   │   └── index.ts
│   ├── manage-user/          # 사용자 관리
│   │   └── index.ts
│   ├── notion-oauth/         # Notion OAuth 연결
│   │   └── index.ts
│   ├── load-more/            # 결과 더보기
│   │   └── index.ts
│   └── pages/                # Edge Function HTML fallback
│       └── index.ts
└── migrations/               # DB 스키마
    ├── 001_users.sql
    ├── 002_search_logs.sql
    ├── 003_usage_quotas.sql
    └── 004_web_storage_bucket.sql
```

## 빠른 시작

### 1. 사전 준비

- **네이버 검색 API**: https://developers.naver.com 에서 발급
- **YouTube Data API v3**: Google Cloud Console에서 발급
- **You.com**: https://you.com/platform 에서 발급 ($100 무료 크레딧)
- **Supabase**: https://supabase.com 에서 프로젝트 생성
- **Notion OAuth**: Notion integration에서 `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` 발급
- **암호화 시크릿**: `openssl rand -base64 32` 등으로 `NOTION_KEY_ENCRYPTION_SECRET` 생성

Notion OAuth redirect URI:

```text
https://[ref].supabase.co/functions/v1/notion-oauth?action=callback
```

### 2. 초기 셋업

```bash
# 1) Supabase CLI 설치 및 로그인
npm install -g supabase
supabase login

# 2) 프로젝트 클론 및 진입
cd Snappy

# 3) 환경 변수 채우기
cp .env.example .env.local
# .env.local 열어서 모든 키 값 입력

# 4) Supabase 프로젝트 연결
supabase link --project-ref [YOUR_PROJECT_REF]
```

### 3. 배포 (한 번에)

```bash
bash scripts/deploy.sh
```

전체 흐름: 사전 확인 → DB 마이그레이션 → 시크릿 등록 → 함수 배포 → GitHub Pages 배포 → 검증

정적 셋업 페이지는 GitHub Pages에서 제공합니다.

- URL: https://pchanul.github.io/Snappy/
- 소스: `docs/index.html`

### 4. 로컬 개발

```bash
bash scripts/dev.sh
```

## 배포 스크립트

| 스크립트 | 용도 |
|---|---|
| `deploy.sh` | 전체 배포 흐름 (대부분 이것만 쓰면 됨) |
| `preflight.sh` | 사전 확인 (도구/환경변수/API 키 검증) |
| `migrate-db.sh` | DB 마이그레이션만 실행 |
| `set-secrets.sh` | Supabase 시크릿만 등록 |
| `deploy-functions.sh` | Edge Function만 배포 |
| `deploy-pages.sh` | `docs/index.html`을 GitHub Pages 기준으로 검증/배포 |
| `verify.sh` | 배포 후 동작 검증 |
| `upload-static.sh` | 이전 명령 호환용 wrapper (`deploy-pages.sh`로 위임) |
| `dev.sh` | 로컬 개발 서버 실행 |
| `logs.sh` | 함수 로그 실시간 조회 |

### 자주 쓰는 명령

```bash
# 최초 배포
bash scripts/deploy.sh

# 코드 변경 후 빠른 재배포 (함수만)
bash scripts/deploy.sh --functions-only

# 정적 셋업 페이지만 확인/배포
bash scripts/deploy-pages.sh

# 특정 함수만 배포
bash scripts/deploy-functions.sh trigger-search

# 로그 실시간 조회
bash scripts/logs.sh trigger-search

# 도움말
bash scripts/deploy.sh --help
```

## API 사용 예시

### 사용자 ID 확인

관리자가 발급한 `user_id`가 DB에 등록되어 있는지 확인합니다.

```bash
curl 'https://[ref].supabase.co/functions/v1/manage-user?action=verify-user&user_id=...'
```

### 노션 연동

OAuth 플로우에서는 먼저 Notion 연결을 완료해 토큰을 저장한 뒤 DB ID만 등록합니다.

```bash
curl -X POST 'https://[ref].supabase.co/functions/v1/manage-user?action=setup-notion' \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "...",
    "notion_database_id": "..."
  }'
```

### 검색 실행 (노션 자동화에서 호출)

```bash
curl -X POST 'https://[ref].supabase.co/functions/v1/trigger-search' \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "...",
    "notion_page_id": "...",
    "keyword": "비건 디저트",
    "platforms": ["naver_blog", "youtube", "tistory", "brunch"],
    "period": "month",
    "result_count": 10
  }'
```

## 비용 (사용자 1명, 월 100회 검색 기준)

| API | 비용 |
|---|---|
| 네이버 | 무료 |
| YouTube | 무료 |
| You.com (티스토리+브런치) | 약 1,400원 |
| **합계** | **약 1,400원** |

## 다음 단계

- [ ] 노션 템플릿 제작
- [ ] 통합 테스트
- [ ] 베타 출시

## 보안 메모

- Notion OAuth access token은 `NOTION_KEY_ENCRYPTION_SECRET`에서 파생한 AES-GCM 키로 암호화해 `users.notion_api_key_encrypted`에 저장합니다.
- `.env.local`은 커밋하지 않습니다. 공유 가능한 예시는 `.env.example`만 사용합니다.
