import { ErrorType } from "../state/types.js";

interface ClassificationRule {
  patterns: RegExp[];
  errorType: ErrorType;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    errorType: ErrorType.GIT_CONFLICT,
    patterns: [
      /CONFLICT \(content\)/i,
      /Merge conflict/i,
      /merge: .+ - not something we can merge/i,
      /Automatic merge failed/i,
      /fix conflicts and then commit/i,
      /needs merge/i,
      /unmerged paths/i,
    ],
  },
  {
    errorType: ErrorType.BUILD_ERROR,
    patterns: [
      /error TS\d+:/i, // TypeScript errors
      /Cannot find module/i,
      /Module not found/i,
      /SyntaxError:/i,
      /Compilation failed/i,
      /Build failed/i,
      /tsc exited with code/i,
      /npm ERR! code ELIFECYCLE/i,
      /gradle.*BUILD FAILED/i,
      /error: cannot find symbol/i, // Java
      /error\[E\d+\]/i, // Rust
    ],
  },
  {
    errorType: ErrorType.TEST_FAILURE,
    patterns: [
      /FAIL\s+.+\.test\./i,
      /Test failed/i,
      /AssertionError/i,
      /Expected .+ but got/i,
      /\d+ failing/i,
      /\d+ failed,/i,
      /jest.*did not exit/i,
      /vitest.*FAILED/i,
      /pytest.*FAILED/i,
    ],
  },
  {
    errorType: ErrorType.TIMEOUT,
    patterns: [
      /ETIMEDOUT/i,
      /timeout/i,
      /Timed out/i,
      /exceeded maximum/i,
      /operation took too long/i,
      /AbortError/i,
    ],
  },
  {
    errorType: ErrorType.PERMISSION_DENIED,
    patterns: [
      /EACCES/i,
      /Permission denied/i,
      /Access denied/i,
      /EPERM/i,
      /not permitted/i,
      /403 Forbidden/i,
      /401 Unauthorized/i,
    ],
  },
  {
    errorType: ErrorType.NETWORK_ERROR,
    patterns: [
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /Network error/i,
      /getaddrinfo ENOTFOUND/i,
      /socket hang up/i,
      /ECONNRESET/i,
      /connect EHOSTUNREACH/i,
      /fetch failed/i,
    ],
  },
];

export class ErrorClassifier {
  /**
   * 에러 메시지를 분석하여 ErrorType을 반환한다.
   */
  classify(errorMessage: string): ErrorType {
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(errorMessage)) {
          return rule.errorType;
        }
      }
    }
    return ErrorType.UNKNOWN;
  }

  /**
   * 에러 타입에 대한 한국어 설명을 반환한다.
   */
  getDescription(errorType: ErrorType): string {
    const descriptions: Record<ErrorType, string> = {
      [ErrorType.GIT_CONFLICT]: "Git 충돌이 발생했습니다",
      [ErrorType.BUILD_ERROR]: "빌드 에러가 발생했습니다",
      [ErrorType.TEST_FAILURE]: "테스트가 실패했습니다",
      [ErrorType.TIMEOUT]: "작업 시간이 초과되었습니다",
      [ErrorType.PERMISSION_DENIED]: "권한이 거부되었습니다",
      [ErrorType.NETWORK_ERROR]: "네트워크 오류가 발생했습니다",
      [ErrorType.UNKNOWN]: "알 수 없는 에러가 발생했습니다",
    };
    return descriptions[errorType];
  }

  /**
   * 에러 타입이 자동 복구 가능한지 판단한다.
   */
  isRecoverable(errorType: ErrorType): boolean {
    const recoverableTypes: ErrorType[] = [
      ErrorType.GIT_CONFLICT,
      ErrorType.BUILD_ERROR,
      ErrorType.TEST_FAILURE,
      ErrorType.NETWORK_ERROR,
    ];
    return recoverableTypes.includes(errorType);
  }

  /**
   * 여러 에러 메시지에서 가장 심각한 에러 타입을 반환한다.
   */
  classifyMultiple(errorMessages: string[]): ErrorType {
    const priority: ErrorType[] = [
      ErrorType.PERMISSION_DENIED,
      ErrorType.GIT_CONFLICT,
      ErrorType.BUILD_ERROR,
      ErrorType.TEST_FAILURE,
      ErrorType.TIMEOUT,
      ErrorType.NETWORK_ERROR,
      ErrorType.UNKNOWN,
    ];

    const types = errorMessages.map((msg) => this.classify(msg));

    for (const priorityType of priority) {
      if (types.includes(priorityType)) {
        return priorityType;
      }
    }

    return ErrorType.UNKNOWN;
  }
}

export const errorClassifier = new ErrorClassifier();
