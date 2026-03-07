import { execSync } from "child_process";
import { ErrorType, HealingConfig } from "../state/types.js";
import { errorClassifier } from "./error-classifier.js";
import { ThinkingRecorder } from "./thinking-recorder.js";
import { OmcClient } from "../clients/omc-client.js";
import {
  getHealingAttemptCount,
  recordHealingAttempt,
} from "../state/store.js";

export interface HealingResult {
  success: boolean;
  errorType: ErrorType;
  strategy: string;
  attemptNumber: number;
  message: string;
}

export interface HealingContext {
  projectId: string;
  issueNumber: number;
  worktreePath: string;
  baseBranch: string;
  errorMessage: string;
  omc: OmcClient;
  thinkingRecorder?: ThinkingRecorder | null;
}

type HealingStrategy = (context: HealingContext) => Promise<HealingResult>;

export class SelfHealer {
  private config: HealingConfig;
  private strategies: Map<ErrorType, HealingStrategy[]> = new Map();

  constructor(config: HealingConfig) {
    this.config = config;
    this.registerStrategies();
  }

  private registerStrategies(): void {
    // GIT_CONFLICT 전략
    this.strategies.set(ErrorType.GIT_CONFLICT, [
      this.strategyGitResetAndRetry.bind(this),
      this.strategyResolveConflictWithAI.bind(this),
    ]);

    // BUILD_ERROR 전략
    this.strategies.set(ErrorType.BUILD_ERROR, [
      this.strategyBuildFix.bind(this),
      this.strategyCleanAndRebuild.bind(this),
    ]);

    // TEST_FAILURE 전략
    this.strategies.set(ErrorType.TEST_FAILURE, [
      this.strategyTestFix.bind(this),
      this.strategySkipFlakyTest.bind(this),
    ]);

    // NETWORK_ERROR 전략
    this.strategies.set(ErrorType.NETWORK_ERROR, [
      this.strategyRetryWithBackoff.bind(this),
    ]);
  }

  /**
   * 에러를 분석하고 Self-Healing을 시도한다.
   */
  async heal(context: HealingContext): Promise<HealingResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        errorType: ErrorType.UNKNOWN,
        strategy: "disabled",
        attemptNumber: 0,
        message: "Self-healing is disabled",
      };
    }

    const errorType = errorClassifier.classify(context.errorMessage);
    context.thinkingRecorder?.recordThought(
      "error_classification",
      `Classified error as: ${errorType} - ${errorClassifier.getDescription(errorType)}`
    );

    if (!errorClassifier.isRecoverable(errorType)) {
      context.thinkingRecorder?.recordThought(
        "healing_skip",
        `Error type ${errorType} is not recoverable, skipping self-healing`
      );
      return {
        success: false,
        errorType,
        strategy: "none",
        attemptNumber: 0,
        message: `Error type ${errorType} is not recoverable`,
      };
    }

    // 해당 에러 타입에 대한 healing 시도 횟수 확인
    const attemptCount = getHealingAttemptCount(
      context.projectId,
      context.issueNumber,
      errorType
    );

    if (attemptCount >= this.config.maxAttemptsPerErrorType) {
      context.thinkingRecorder?.recordThought(
        "healing_limit_reached",
        `Max healing attempts (${this.config.maxAttemptsPerErrorType}) reached for ${errorType}`
      );
      return {
        success: false,
        errorType,
        strategy: "max_attempts_reached",
        attemptNumber: attemptCount,
        message: `Max healing attempts (${this.config.maxAttemptsPerErrorType}) reached for error type: ${errorType}`,
      };
    }

    const strategies = this.strategies.get(errorType);
    if (!strategies || strategies.length === 0) {
      return {
        success: false,
        errorType,
        strategy: "no_strategy",
        attemptNumber: attemptCount,
        message: `No healing strategy available for error type: ${errorType}`,
      };
    }

    // 사용할 전략 선택 (attemptCount 기반)
    const strategyIndex = Math.min(attemptCount, strategies.length - 1);
    const strategy = strategies[strategyIndex];
    const strategyName = strategy.name.replace("bound ", "");

    context.thinkingRecorder?.recordHealingAttempt(
      errorType,
      strategyName,
      attemptCount + 1
    );

    try {
      const result = await strategy(context);

      // 결과 기록
      recordHealingAttempt(
        context.projectId,
        context.issueNumber,
        errorType,
        result.strategy,
        result.success,
        result.success ? undefined : result.message
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      recordHealingAttempt(
        context.projectId,
        context.issueNumber,
        errorType,
        strategyName,
        false,
        errorMsg
      );

      return {
        success: false,
        errorType,
        strategy: strategyName,
        attemptNumber: attemptCount + 1,
        message: `Healing strategy ${strategyName} failed: ${errorMsg}`,
      };
    }
  }

  // ── GIT_CONFLICT 전략 ────────────────────────────────────────────────

  private async strategyGitResetAndRetry(
    context: HealingContext
  ): Promise<HealingResult> {
    const { worktreePath, baseBranch } = context;

    try {
      // 충돌 상태를 해제하고 원격 브랜치로 리셋
      execSync(`git -C "${worktreePath}" reset --hard origin/${baseBranch}`, {
        stdio: "pipe",
        timeout: 30_000,
      });

      context.thinkingRecorder?.recordThought(
        "git_reset",
        `Reset to origin/${baseBranch} successful`
      );

      return {
        success: true,
        errorType: ErrorType.GIT_CONFLICT,
        strategy: "git_reset_and_retry",
        attemptNumber: 1,
        message: "Git reset successful, ready for retry",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorType: ErrorType.GIT_CONFLICT,
        strategy: "git_reset_and_retry",
        attemptNumber: 1,
        message: `Git reset failed: ${errorMsg}`,
      };
    }
  }

  private async strategyResolveConflictWithAI(
    context: HealingContext
  ): Promise<HealingResult> {
    const { worktreePath, omc, errorMessage } = context;

    try {
      // 충돌 파일 목록 가져오기
      const conflictFiles = execSync(
        `git -C "${worktreePath}" diff --name-only --diff-filter=U`,
        { encoding: "utf-8", stdio: "pipe" }
      )
        .split("\n")
        .filter(Boolean);

      if (conflictFiles.length === 0) {
        return {
          success: true,
          errorType: ErrorType.GIT_CONFLICT,
          strategy: "resolve_conflict_ai",
          attemptNumber: 2,
          message: "No conflict files found",
        };
      }

      // 충돌 정보 수집
      const conflictInfo = [
        `Conflicted files: ${conflictFiles.join(", ")}`,
        "",
        "Error message:",
        errorMessage,
      ].join("\n");

      // AI로 충돌 해결 시도
      const result = await omc.resolveConflict(conflictInfo);

      if (result.success) {
        // 해결된 파일 스테이징
        execSync(`git -C "${worktreePath}" add -A`, { stdio: "pipe" });

        return {
          success: true,
          errorType: ErrorType.GIT_CONFLICT,
          strategy: "resolve_conflict_ai",
          attemptNumber: 2,
          message: "Conflict resolved by AI",
        };
      }

      return {
        success: false,
        errorType: ErrorType.GIT_CONFLICT,
        strategy: "resolve_conflict_ai",
        attemptNumber: 2,
        message: result.error ?? "AI conflict resolution failed",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorType: ErrorType.GIT_CONFLICT,
        strategy: "resolve_conflict_ai",
        attemptNumber: 2,
        message: `AI conflict resolution error: ${errorMsg}`,
      };
    }
  }

  // ── BUILD_ERROR 전략 ─────────────────────────────────────────────────

  private async strategyBuildFix(
    context: HealingContext
  ): Promise<HealingResult> {
    const { omc, errorMessage } = context;

    try {
      const result = await omc.fixBuild(errorMessage);

      return {
        success: result.success,
        errorType: ErrorType.BUILD_ERROR,
        strategy: "build_fix",
        attemptNumber: 1,
        message: result.success
          ? "Build fixed successfully"
          : result.error ?? "Build fix failed",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorType: ErrorType.BUILD_ERROR,
        strategy: "build_fix",
        attemptNumber: 1,
        message: `Build fix error: ${errorMsg}`,
      };
    }
  }

  private async strategyCleanAndRebuild(
    context: HealingContext
  ): Promise<HealingResult> {
    const { worktreePath } = context;

    try {
      // node_modules 삭제 및 재설치
      execSync(`rm -rf "${worktreePath}/node_modules"`, {
        stdio: "pipe",
        timeout: 30_000,
      });

      execSync(`npm install`, {
        cwd: worktreePath,
        stdio: "pipe",
        timeout: 120_000,
      });

      // 빌드 재시도
      execSync(`npm run build`, {
        cwd: worktreePath,
        stdio: "pipe",
        timeout: 180_000,
      });

      context.thinkingRecorder?.recordThought(
        "clean_rebuild",
        "Clean rebuild successful"
      );

      return {
        success: true,
        errorType: ErrorType.BUILD_ERROR,
        strategy: "clean_and_rebuild",
        attemptNumber: 2,
        message: "Clean rebuild successful",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorType: ErrorType.BUILD_ERROR,
        strategy: "clean_and_rebuild",
        attemptNumber: 2,
        message: `Clean rebuild failed: ${errorMsg}`,
      };
    }
  }

  // ── TEST_FAILURE 전략 ────────────────────────────────────────────────

  private async strategyTestFix(
    context: HealingContext
  ): Promise<HealingResult> {
    const { omc, errorMessage } = context;

    try {
      const result = await omc.fixTestFailure(errorMessage);

      return {
        success: result.success,
        errorType: ErrorType.TEST_FAILURE,
        strategy: "test_fix",
        attemptNumber: 1,
        message: result.success
          ? "Test fix successful"
          : result.error ?? "Test fix failed",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorType: ErrorType.TEST_FAILURE,
        strategy: "test_fix",
        attemptNumber: 1,
        message: `Test fix error: ${errorMsg}`,
      };
    }
  }

  private async strategySkipFlakyTest(
    context: HealingContext
  ): Promise<HealingResult> {
    // Flaky 테스트 스킵은 위험하므로 기본적으로 비활성화
    context.thinkingRecorder?.recordThought(
      "skip_flaky_test",
      "Skipping flaky test strategy is not recommended"
    );

    return {
      success: false,
      errorType: ErrorType.TEST_FAILURE,
      strategy: "skip_flaky_test",
      attemptNumber: 2,
      message: "Skipping flaky tests is not recommended for production code",
    };
  }

  // ── NETWORK_ERROR 전략 ───────────────────────────────────────────────

  private async strategyRetryWithBackoff(
    context: HealingContext
  ): Promise<HealingResult> {
    // 네트워크 에러는 잠시 대기 후 재시도하도록 알림
    context.thinkingRecorder?.recordThought(
      "network_retry",
      "Network error detected, recommending retry with backoff"
    );

    return {
      success: true, // 재시도 가능 상태로 표시
      errorType: ErrorType.NETWORK_ERROR,
      strategy: "retry_with_backoff",
      attemptNumber: 1,
      message: "Network error - retry recommended after delay",
    };
  }
}

/**
 * 기본 HealingConfig를 반환한다.
 */
export function getDefaultHealingConfig(): HealingConfig {
  return {
    enabled: true,
    maxAttemptsPerErrorType: 2,
    strategies: {
      [ErrorType.GIT_CONFLICT]: ["git_reset_and_retry", "resolve_conflict_ai"],
      [ErrorType.BUILD_ERROR]: ["build_fix", "clean_and_rebuild"],
      [ErrorType.TEST_FAILURE]: ["test_fix"],
      [ErrorType.NETWORK_ERROR]: ["retry_with_backoff"],
    },
  };
}
