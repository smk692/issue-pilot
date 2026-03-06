# API 응답 로깅 미들웨어 구현 계획

## 1. 현황 분석

### 1.1 프로젝트 특성
이 프로젝트(issue-pilot)는 **웹 API 서버가 아닌 스케줄러 기반 자동화 시스템**입니다.

| 항목 | 현황 |
|------|------|
| 프레임워크 | Express/Koa 없음 (순수 Node.js 스케줄러) |
| API 통신 | GitHub REST API 클라이언트 (@octokit/rest) |
| 로깅 | 콘솔 출력 기반 (비구조화) |
| 환경 설정 | config.json + .env |

### 1.2 기존 로깅 시스템
```typescript
// BaseScheduler에서 제공
protected log(message: string): void {
  console.log(`[${new Date().toISOString()}] [${this.name}] ${message}`);
}

protected logError(message: string, err?: unknown): void {
  console.error(`[${new Date().toISOString()}] [${this.name}] ERROR: ${message}...`);
}
```

### 1.3 요청 해석
원본 이슈는 "API 엔드포인트" 로깅을 요청하지만, 이 프로젝트에는 HTTP 서버가 없습니다.
따라서 **두 가지 해석**이 가능합니다:

1. **해석 A**: GitHub API 클라이언트 요청/응답 로깅 (외부 API 호출)
2. **해석 B**: HTTP 서버 추가 후 API 미들웨어 구현 (새로운 기능)

**권장**: 해석 A - GitHub API 클라이언트 로깅이 현재 아키텍처에 부합합니다.

---

## 2. 구현 계획 (해석 A: GitHub API 클라이언트 로깅)

### 2.1 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/logger/logger.ts` | 신규 | 구조화된 JSON 로거 |
| `src/logger/sensitive-mask.ts` | 신규 | 민감 정보 마스킹 유틸 |
| `src/logger/types.ts` | 신규 | 로그 타입 정의 |
| `src/logger/index.ts` | 신규 | 로거 모듈 export |
| `src/clients/github-client.ts` | 수정 | API 요청/응답 로깅 추가 |
| `src/clients/omc-client.ts` | 수정 | OMC 호출 로깅 추가 |
| `src/schedulers/base-scheduler.ts` | 수정 | 새 로거 사용 |
| `src/config/config.ts` | 수정 | 로깅 설정 추가 |
| `src/state/types.ts` | 수정 | LogConfig 타입 추가 |
| `config.json` | 수정 | logging 섹션 추가 |

### 2.2 구현 단계

#### Phase 1: 로거 모듈 구현
1. `src/logger/types.ts` - 로그 레벨, 로그 엔트리 타입 정의
2. `src/logger/sensitive-mask.ts` - Authorization, password 등 마스킹
3. `src/logger/logger.ts` - JSON 포맷 로거 클래스
4. `src/logger/index.ts` - 모듈 export

#### Phase 2: 설정 확장
1. `src/state/types.ts`에 `LogConfig` 인터페이스 추가
2. `config.json`에 logging 섹션 추가
3. 환경 변수로 로그 레벨 오버라이드 지원

#### Phase 3: GitHub 클라이언트 통합
1. Octokit 요청/응답 인터셉터 추가
2. 요청 메서드, URL, 상태 코드, 응답 시간 로깅
3. 개발 환경에서만 body 포함

#### Phase 4: 기존 코드 마이그레이션
1. BaseScheduler의 log/logError를 새 로거로 교체
2. OmcClient에 로깅 추가

---

## 3. 기술 상세

### 3.1 로그 포맷 (JSON)
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "component": "github-client",
  "action": "api_request",
  "method": "GET",
  "url": "/repos/{owner}/{repo}/issues",
  "status": 200,
  "duration_ms": 245,
  "rate_limit": {
    "remaining": 4850,
    "limit": 5000
  },
  "body": null  // 개발 환경에서만
}
```

### 3.2 민감 정보 마스킹 규칙
| 필드 | 마스킹 방식 |
|------|-----------|
| Authorization 헤더 | `Bearer ***` |
| GITHUB_TOKEN | `ghp_***` |
| password, secret | `***` |
| email | `s***@***.com` |

### 3.3 환경별 동작
| 환경 | 로그 레벨 | body 포함 |
|------|----------|----------|
| development | debug | O |
| production | info | X |
| test | warn | X |

### 3.4 Octokit 인터셉터 구현
```typescript
// GitHub Client 요청 로깅
this.octokit.hook.wrap("request", async (request, options) => {
  const startTime = Date.now();
  const requestLog = createRequestLog(options);

  try {
    const response = await request(options);
    logApiResponse(requestLog, response, Date.now() - startTime);
    return response;
  } catch (error) {
    logApiError(requestLog, error, Date.now() - startTime);
    throw error;
  }
});
```

---

## 4. 기술적 고려사항

### 4.1 성능
- 로깅은 동기식으로 처리하여 I/O 블로킹 최소화
- 프로덕션에서는 body 로깅 비활성화로 메모리 절약
- 로그 버퍼링 없이 즉시 출력 (스트림 기반)

### 4.2 보안
- 토큰, 비밀번호 등 민감 정보 자동 마스킹
- 환경 변수 값 절대 로깅하지 않음
- 요청/응답 body의 민감 필드 재귀적 마스킹

### 4.3 호환성
- 기존 콘솔 로그 포맷과 병행 가능
- Node.js 18+ 지원 (현재 프로젝트 타겟)
- ESM 모듈 시스템 유지

### 4.4 확장성
- 파일 출력, 외부 로그 서비스 연동 가능한 구조
- 로그 레벨 동적 변경 지원
- 커스텀 포매터 플러그인 지원

---

## 5. 예상 영향 범위

### 5.1 직접 영향
| 컴포넌트 | 영향 |
|---------|------|
| GitHubClient | 모든 API 호출에 로깅 추가 |
| BaseScheduler | 로깅 메서드 변경 |
| OmcClient | 호출 로깅 추가 |
| Config | 새 설정 섹션 파싱 |

### 5.2 간접 영향
- 콘솔 출력량 증가 (특히 개발 환경)
- 약간의 메모리 사용량 증가
- Rate limit 정보가 로그에 포함되어 모니터링 용이

### 5.3 Breaking Changes
- 없음 (기존 동작 유지, 로깅만 추가)

---

## 6. 테스트 계획

### 6.1 단위 테스트
```
tests/
├── logger/
│   ├── logger.test.ts           # 로거 기본 기능
│   ├── sensitive-mask.test.ts   # 마스킹 규칙
│   └── format.test.ts           # JSON 포맷 검증
```

#### 테스트 케이스
1. **로거 기본 기능**
   - 각 로그 레벨(debug, info, warn, error) 출력 확인
   - JSON 포맷 유효성 검증
   - 타임스탬프 ISO 8601 형식 확인

2. **민감 정보 마스킹**
   - Authorization 헤더 마스킹
   - 토큰 패턴 마스킹 (ghp_, gho_, etc.)
   - 중첩 객체 내 민감 필드 마스킹
   - 배열 내 민감 정보 마스킹

3. **환경별 동작**
   - NODE_ENV=development에서 body 포함 확인
   - NODE_ENV=production에서 body 제외 확인
   - 로그 레벨 필터링 확인

### 6.2 통합 테스트
1. **GitHub 클라이언트 로깅**
   - 실제 API 호출 시 로그 출력 확인
   - Rate limit 정보 포함 확인
   - 에러 응답 로깅 확인

2. **스케줄러 로깅**
   - 폴링 시작/종료 로깅
   - 에러 발생 시 스택 트레이스 포함 확인

### 6.3 수동 테스트
1. 개발 환경에서 `npm run dev` 실행 후 로그 확인
2. JSON 로그가 jq로 파싱 가능한지 확인
3. 민감 정보가 노출되지 않는지 확인

---

## 7. 구현 순서 요약

```
1. src/logger/types.ts           (타입 정의)
2. src/logger/sensitive-mask.ts  (마스킹 유틸)
3. src/logger/logger.ts          (로거 클래스)
4. src/logger/index.ts           (모듈 export)
5. src/state/types.ts            (LogConfig 타입 추가)
6. config.json                   (logging 섹션 추가)
7. src/config/config.ts          (로깅 설정 로드)
8. src/clients/github-client.ts  (API 로깅 통합)
9. src/schedulers/base-scheduler.ts (로거 교체)
10. src/clients/omc-client.ts    (OMC 로깅 추가)
11. tests/logger/*.test.ts       (테스트 작성)
```

---

## 8. 대안 (해석 B: HTTP 서버 추가)

만약 HTTP API 서버를 새로 추가해야 한다면:

### 추가 필요 작업
1. Express/Fastify 의존성 추가
2. HTTP 서버 엔트리포인트 생성
3. 라우터 구조 설계
4. 미들웨어 체인 구성
5. API 엔드포인트 정의

이 경우 프로젝트 범위가 크게 확장되므로, 별도 이슈로 분리하는 것을 권장합니다.

---

## 9. 결론

현재 프로젝트 구조에 맞는 **GitHub API 클라이언트 로깅**(해석 A)을 권장합니다.
이 접근 방식은:

- 기존 아키텍처 유지
- 요구사항 충족 (메서드, URL, 상태 코드, 응답 시간, 마스킹, JSON 포맷)
- 최소한의 변경으로 구현 가능
- 디버깅 효율 향상 및 성능 병목 파악에 도움

HTTP 서버 추가가 필요하다면, 추가 요구사항 확인 후 별도 계획을 수립하겠습니다.
