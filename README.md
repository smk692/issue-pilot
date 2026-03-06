# Issue Pilot

GitHub Issue 기반 자동화 워크플로우 시스템. 이슈에 라벨을 달면 AI가 플랜 작성, 코드 구현, PR 생성, 머지 감지까지 자동으로 처리한다.

## 아키텍처

```
GitHub Issue (라벨)
       │
       ▼
┌─────────────────────────────────────────┐
│              Issue Pilot                 │
│                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │   Plan   │ │   Dev    │ │  Merge   │ │
│  │Scheduler │ │Scheduler │ │Scheduler │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │            │            │        │
│       ▼            ▼            ▼        │
│  ┌─────────────────────────────────────┐ │
│  │         SQLite (state.db)           │ │
│  └─────────────────────────────────────┘ │
│       │                                  │
│       ▼                                  │
│  ┌─────────────────────────────────────┐ │
│  │    Dashboard (Express + React)      │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## 파이프라인 플로우

```
이슈 플랜 → 플랜중 → 플랜 완료 → 개발 진행 → (PR 머지) → 완료
                 ↑                        │
                 └── 플랜 수정 ◄──────────┘
                                    개발 실패 (재시도 초과 시)
```

| 스케줄러 | 역할 |
|---------|------|
| **plan-scheduler** | `이슈 플랜` / `플랜 수정` 라벨 이슈 감지 → Claude로 플랜 작성 → `플랜 완료` |
| **dev-scheduler** | `개발 진행` 라벨 이슈 감지 → Claude로 코드 구현 → PR 생성 |
| **merge-scheduler** | PR 머지 감지 → 라벨/상태 정리 → 이슈 Close |

## 설치

```bash
npm install
```

## 설정

### 1. 환경변수

```bash
cp .env.example .env
```

`.env` 파일을 열고 값을 채운다:

```
GITHUB_TOKEN=<GitHub Personal Access Token>
JIRA_API_TOKEN=<Jira API Token (선택)>
JIRA_USER_EMAIL=<Jira 이메일 (선택)>
```

GitHub 토큰에 필요한 권한: `repo`, `issues:write`, `pull_requests:write`

### 2. 프로젝트 설정

```bash
cp config.example.json config.json
```

`config.json`에서 관리할 프로젝트를 등록한다:

```jsonc
{
  "projects": [
    {
      "id": "my-project",        // 고유 ID
      "github": {
        "owner": "my-org",       // GitHub 소유자
        "repo": "my-repo",       // 레포지토리명
        "baseBranch": "main",    // 기본 브랜치
        "repoPath": ".repos/my-repo"  // 로컬 클론 경로
      }
    }
  ]
}
```

### 3. GitHub 라벨

대상 레포에 다음 라벨을 생성한다:

| 라벨 | 용도 |
|------|------|
| `이슈 플랜` | 플랜 작성 요청 |
| `플랜중` | 플랜 작성 진행 중 |
| `플랜 완료` | 플랜 작성 완료 |
| `플랜 수정` | 플랜 수정 요청 |
| `개발 진행` | 코드 구현 시작 |
| `개발 실패` | 재시도 초과 실패 |
| `완료` | PR 머지 완료 |

## 실행

```bash
# 빌드 + 실행
make run

# 또는 수동
npm run build
npm start
```

대시보드: http://localhost:3001

## 대시보드 기능

- **대시보드**: 전체 이슈 현황, 스케줄러 상태, 파이프라인 플로우, 실시간 활동 로그
- **프로젝트**: 프로젝트별 이슈 목록, On/Off 토글로 스케줄러 일시정지/재개

### 프로젝트 On/Off 토글

프로젝트 카드의 토글 스위치로 스케줄러를 제어할 수 있다:
- **On**: 모든 스케줄러(plan, dev, merge)가 해당 프로젝트를 폴링
- **Off**: 해당 프로젝트를 모든 스케줄러에서 skip (일시정지 상태)

API로도 제어 가능:

```bash
# 비활성화
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3001/api/projects/<project-id>/enabled

# 활성화
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":true}' \
  http://localhost:3001/api/projects/<project-id>/enabled
```

## 설정 옵션

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `schedulers.planPollIntervalSec` | 120 | 플랜 스케줄러 폴링 간격 (초) |
| `schedulers.devPollIntervalSec` | 120 | 개발 스케줄러 폴링 간격 (초) |
| `schedulers.mergePollIntervalSec` | 180 | 머지 스케줄러 폴링 간격 (초) |
| `schedulers.concurrency` | 1 | 플랜 동시 처리 수 |
| `retry.maxRetries` | 3 | 최대 재시도 횟수 |
| `jira.enabled` | false | Jira 연동 여부 |
| `security.sanitizeInput` | true | 이슈 본문 sanitization |
| `security.preScanEnabled` | true | PR 전 보안 스캐닝 |

## 기술 스택

- **Backend**: Node.js, TypeScript, Express
- **Frontend**: React, Vite, Tailwind CSS
- **Database**: SQLite (better-sqlite3)
- **AI**: Claude Code (Agent SDK, oh-my-claudecode)
- **연동**: GitHub API (Octokit), Jira API (선택)

## 개발 과정

Issue Pilot은 Claude Code와 oh-my-claudecode(OMC) 플러그인을 활용해 개발되었다.

### 사전 준비

1. **Claude Code CLI 설치**: `npm install -g @anthropic-ai/claude-code`
2. **oh-my-claudecode 설치**: Claude Code 실행 후 `/oh-my-claudecode:omc-setup`
3. **Claude Agent SDK 설치**: `npm install @anthropic-ai/claude-agent-sdk`

### 사용한 OMC 스킬

Issue Pilot은 내부적으로 Claude Agent SDK를 통해 OMC 스킬을 호출한다:

| 스킬 | 용도 | 호출 시점 |
|------|------|-----------|
| `/oh-my-claudecode:ralplan` | 구현 계획 작성 (Planner + Architect + Critic 합의) | plan-scheduler가 `이슈 플랜` 라벨 감지 시 |
| `/oh-my-claudecode:autopilot` | 자율 코드 구현 (계획 기반) | dev-scheduler가 `개발 진행` 라벨 감지 시 |
| `/oh-my-claudecode:build-fix` | 빌드/타입 에러 최소 수정 | dev-scheduler에서 autopilot 실패 시 (최대 2회) |

### Claude Agent SDK 연동

`OmcClient`(`src/clients/omc-client.ts`)가 Agent SDK의 `query()` 함수로 Claude Code 세션을 프로그래밍적으로 실행한다:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 대상 레포의 워크트리에서 Claude Code 세션 실행
for await (const message of query({
  prompt: "/oh-my-claudecode:autopilot\n구현 계획에 따라 코드를 변경해주세요...",
  options: {
    cwd: worktreePath,           // 대상 레포 워크트리
    allowedTools: ["Read", "Edit", "Write", "Bash", ...],
    permissionMode: "acceptEdits",
    maxTurns: 100,
  },
})) {
  // 스트리밍 결과 처리
}
```

주요 안전장치:
- **워크트리 격리**: dev-scheduler는 git worktree를 생성해 격리된 환경에서 코드를 변경한다
- **도구 제한**: `allowedTools` / `disallowedTools`로 사용 가능한 도구를 제한한다
- **경로 제한**: `canUseTool` 콜백으로 Edit/Write 시 허용 경로만 접근 가능
- **입력 사니타이징**: 이슈 본문에서 프롬프트 인젝션 패턴을 필터링한다
- **보안 스캐닝**: PR 생성 전 변경 파일에 대해 시크릿/취약점 스캔 수행
- **타임아웃**: 세션당 30분 타임아웃으로 무한 실행 방지

### config.json의 OMC 설정

```jsonc
{
  "omc": {
    "enabled": true,
    "timeoutMs": 1800000,          // 30분 타임아웃
    "permissionMode": "acceptEdits", // 편집 자동 승인
    "allowedTools": [               // 허용 도구
      "Read", "Edit", "Write", "Bash", "Glob", "Grep", "Agent"
    ],
    "disallowedTools": [            // 차단 도구
      "EnterWorktree", "TeamCreate", "TeamDelete"
    ],
    "allowedPaths": ["src/", "tests/", "docs/"],  // 편집 허용 경로
    "skills": {
      "plan": "ralplan",            // 플랜 작성 스킬
      "execute": "autopilot",       // 코드 구현 스킬
      "buildFix": "build-fix"       // 빌드 수정 스킬
    }
  }
}
```

### 개발 단계별 히스토리

이 프로젝트는 다음 순서로 만들어졌다:

1. **PRD 작성** - 요구사항 정의 (GitHub Issue 라벨 기반 자동화 워크플로우)
2. **기반 구조** - TypeScript + Express + SQLite + React(Vite) 프로젝트 셋업
3. **스케줄러 엔진** - `BaseScheduler` 추상 클래스 (setInterval 기반 폴링, Rate Limit 대응, 지수 백오프 재시도)
4. **GitHub 클라이언트** - Octokit 래핑 (이슈/라벨/PR/코멘트 CRUD)
5. **Claude Agent SDK 연동** - `OmcClient`로 ralplan/autopilot/build-fix 스킬 호출
6. **plan-scheduler** - `이슈 플랜` 라벨 → ralplan으로 플랜 작성 → 코멘트 등록
7. **dev-scheduler** - `개발 진행` 라벨 → 워크트리 생성 → autopilot → PR 생성
8. **merge-scheduler** - PR 머지 감지 → 상태 정리 → 이슈 Close
9. **보안 레이어** - 입력 사니타이징, PR 전 보안 스캔, 경로/도구 제한
10. **Jira 연동** - 티켓 자동 생성 + Done 전이
11. **대시보드** - Express 정적 서빙 + React SPA (상태 현황, 파이프라인, SSE 실시간 이벤트)
12. **프로젝트 토글** - 프로젝트별 On/Off로 스케줄러 일시정지/재개

## 프로젝트 구조

```
issue-pilot/
├── src/
│   ├── index.ts                 # 엔트리포인트
│   ├── config/config.ts         # 설정 로더
│   ├── clients/
│   │   ├── github-client.ts     # GitHub API (Octokit)
│   │   ├── jira-client.ts       # Jira API
│   │   └── omc-client.ts        # Claude Agent SDK 래퍼
│   ├── schedulers/
│   │   ├── base-scheduler.ts    # 스케줄러 추상 클래스
│   │   ├── plan-scheduler.ts    # 플랜 작성 스케줄러
│   │   ├── dev-scheduler.ts     # 개발 구현 스케줄러
│   │   └── merge-scheduler.ts   # PR 머지 감지 스케줄러
│   ├── state/
│   │   ├── store.ts             # SQLite 쿼리 (이슈 상태, 프로젝트 설정)
│   │   ├── types.ts             # 공유 타입 정의
│   │   └── lock-manager.ts      # 이슈 동시 처리 방지 락
│   ├── server/
│   │   ├── app.ts               # Express 앱 설정
│   │   ├── event-bus.ts         # SSE 이벤트 버스
│   │   └── routes/
│   │       ├── api.ts           # REST API 라우트
│   │       └── events.ts        # SSE 엔드포인트
│   └── security/
│       ├── input-sanitizer.ts   # 프롬프트 인젝션 필터
│       └── pre-pr-scanner.ts    # PR 전 보안 스캐너
├── web/                         # React 대시보드
│   └── src/
│       ├── api/                 # API 클라이언트 + 타입
│       ├── components/          # 공통/프로젝트 컴포넌트
│       ├── hooks/               # useApi, useSSE
│       └── pages/               # 대시보드, 프로젝트 목록/상세
├── config.example.json          # 설정 예시
├── .env.example                 # 환경변수 예시
├── Makefile                     # 빌드/실행 명령
└── package.json
```
