import type { Config, RetryPolicy, RateLimitInfo, SchedulerStatus, SchedulerType } from "../state/types.js";
import { isProjectEnabled as checkProjectEnabled } from "../state/store.js";

export interface SchedulerOptions {
  name: string;
  pollIntervalSec: number;
  config: Config;
}

/**
 * 공통 스케줄러 추상 클래스.
 * node-cron 대신 setInterval 기반으로 구현하여 동적 폴링 주기 조정을 지원한다.
 */
export abstract class BaseScheduler {
  protected name: string;
  protected config: Config;
  protected retryPolicy: RetryPolicy;

  protected basePollIntervalMs: number;
  protected currentPollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  protected running = false;
  protected polling = false;
  protected lastPollAt: string | null = null;

  constructor(options: SchedulerOptions) {
    this.name = options.name;
    this.config = options.config;
    this.basePollIntervalMs = options.pollIntervalSec * 1000;
    this.currentPollIntervalMs = this.basePollIntervalMs;
    this.retryPolicy = {
      maxRetries: options.config.retry.maxRetries,
      retryDelayMs: options.config.retry.retryDelayMs,
      backoffMultiplier: options.config.retry.backoffMultiplier,
    };
  }

  /**
   * 각 스케줄러가 구현해야 하는 폴링 메서드.
   */
  protected abstract poll(): Promise<void>;

  start(): void {
    if (this.running) {
      this.log("이미 실행 중입니다.");
      return;
    }
    this.running = true;
    this.log("스케줄러 시작");
    this.scheduleNext();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log("스케줄러 중지");
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (!this.polling) {
        this.polling = true;
        this.lastPollAt = new Date().toISOString();
        try {
          await this.poll();
        } catch (err) {
          this.logError("폴링 중 예외 발생", err);
        } finally {
          this.polling = false;
        }
      }
      this.scheduleNext();
    }, this.currentPollIntervalMs);
  }

  /**
   * Rate Limit 상태에 따라 폴링 주기를 동적으로 조정한다.
   * PRD 4.0절: remaining < 500 시 2배, < 100 시 일시 중단.
   */
  protected adjustPollInterval(rateLimitInfo: RateLimitInfo | null): void {
    if (!rateLimitInfo) {
      this.currentPollIntervalMs = this.basePollIntervalMs;
      return;
    }

    const { remaining, resetAt } = rateLimitInfo;

    if (remaining < 100) {
      // 리셋 시각까지 대기
      const resetMs = new Date(resetAt).getTime() - Date.now();
      const waitMs = Math.max(resetMs, 0) + 5000; // 5초 여유
      this.log(`Rate limit 임박 (${remaining}/5000), ${Math.ceil(waitMs / 1000)}초 대기`);
      this.currentPollIntervalMs = waitMs;
    } else if (remaining < 500) {
      this.currentPollIntervalMs = this.basePollIntervalMs * 2;
      this.log(`Rate limit 경고 (${remaining}/5000), 폴링 주기 2배로 확대`);
    } else {
      this.currentPollIntervalMs = this.basePollIntervalMs;
    }
  }

  /**
   * 지수 백오프를 적용한 재시도 딜레이를 반환한다.
   */
  protected getRetryDelay(attempt: number): number {
    return (
      this.retryPolicy.retryDelayMs *
      Math.pow(this.retryPolicy.backoffMultiplier, attempt)
    );
  }

  /**
   * 지정 ms 동안 대기한다.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected log(message: string): void {
    console.log(`[${new Date().toISOString()}] [${this.name}] ${message}`);
  }

  protected logError(message: string, err?: unknown): void {
    const errMsg = err instanceof Error ? err.message : String(err ?? "");
    console.error(`[${new Date().toISOString()}] [${this.name}] ERROR: ${message}${errMsg ? ` — ${errMsg}` : ""}`);
  }

  getStatus(): SchedulerStatus {
    return {
      name: this.name as SchedulerType,
      running: this.running,
      polling: this.polling,
      basePollIntervalMs: this.basePollIntervalMs,
      currentPollIntervalMs: this.currentPollIntervalMs,
      lastPollAt: this.lastPollAt,
    };
  }

  /**
   * 프로젝트가 활성화되어 있는지 확인한다.
   */
  protected isProjectEnabled(projectId: string): boolean {
    return checkProjectEnabled(projectId);
  }

  isRunning(): boolean {
    return this.running;
  }
}
