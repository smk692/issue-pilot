import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig } from "../config/config.js";
import { ThinkingRecorder, getDefaultThinkingConfig } from "../core/thinking-recorder.js";
import type { ThinkingConfig } from "../state/types.js";

export interface OmcObserver {
  onProgress(data: { skill: string; toolName?: string; text?: string; toolUses: number }): void;
  onHeartbeat(data: { skill: string; elapsedMs: number; toolUses: number }): void;
  onComplete(result: OmcResult & { skill: string }): void;
}

export interface OmcClientConfig {
  cwd: string;
  allowedTools: string[];
  disallowedTools: string[];
  allowedPaths: string[];
  timeoutMs: number;
  permissionMode: "acceptEdits" | "default";
  thinkingConfig?: ThinkingConfig;
  issueNumber?: number;
  observer?: OmcObserver;
}

export interface OmcInvocation {
  skill: string;
  prompt: string;
  sessionId?: string;
}

export interface OmcResult {
  success: boolean;
  output: string;
  sessionId: string;
  durationMs: number;
  toolUses: number;
  error?: string;
}

export class OmcClient {
  private thinkingRecorder: ThinkingRecorder | null = null;

  constructor(private config: OmcClientConfig) {
    // ThinkingRecorder 초기화
    if (config.thinkingConfig?.enabled && config.issueNumber) {
      this.thinkingRecorder = new ThinkingRecorder(
        config.thinkingConfig,
        config.cwd,
        config.issueNumber,
        "omc-client"
      );
    }
  }

  /**
   * ThinkingRecorder 인스턴스를 반환한다.
   */
  getThinkingRecorder(): ThinkingRecorder | null {
    return this.thinkingRecorder;
  }

  /**
   * 특정 스킬에 대한 ThinkingRecorder를 생성한다.
   */
  createThinkingRecorderForSkill(skillName: string): ThinkingRecorder | null {
    if (!this.config.thinkingConfig?.enabled || !this.config.issueNumber) {
      return null;
    }

    return new ThinkingRecorder(
      this.config.thinkingConfig,
      this.config.cwd,
      this.config.issueNumber,
      skillName
    );
  }

  // 1. 플랜 작성: /ralplan
  async createPlan(issueBody: string): Promise<OmcResult> {
    const recorder = this.createThinkingRecorderForSkill("ralplan");
    recorder?.recordThought("start", "Starting plan creation for issue");

    const result = await this.invoke({
      skill: "ralplan",
      prompt: [
        `/oh-my-claudecode:ralplan`,
        `다음 GitHub 이슈에 대한 구현 계획을 작성해주세요.`,
        `코드베이스를 분석하고, 변경 파일 목록, 구현 단계, 기술적 고려사항,`,
        `예상 영향 범위, 테스트 계획을 포함해주세요.`,
        ``,
        `## 이슈 내용`,
        issueBody,
      ].join("\n"),
    }, recorder);

    recorder?.recordResult(result.success, result.success ? "Plan created successfully" : `Plan creation failed: ${result.error}`);

    return result;
  }

  // 2. 코드 구현: /autopilot
  async executeCode(planContent: string): Promise<OmcResult> {
    const recorder = this.createThinkingRecorderForSkill("autopilot");
    recorder?.recordThought("start", "Starting code execution based on plan");

    const result = await this.invoke({
      skill: "autopilot",
      prompt: [
        `/oh-my-claudecode:autopilot`,
        `다음 구현 계획의 **모든 내용**을 실제 코드로 구현해주세요.`,
        ``,
        `**중요:**`,
        `- 플랜 문서 작성이 아닌 **실제 코드 파일 생성/수정**이 목표입니다`,
        `- backend/, frontend/, .github/workflows/ 등 **모든 필요 파일을 변경**하세요`,
        `- .md 파일 작성보다 **실제 동작하는 코드**에 집중하세요`,
        `- 빌드와 테스트가 통과하는지 반드시 검증해주세요`,
        ``,
        `**절대 금지 (dev-scheduler가 처리):**`,
        `- git commit 실행 금지`,
        `- git push 실행 금지`,
        `- 현재 워크트리(cwd) 외부 디렉토리 수정 금지`,
        ``,
        `**완료 조건:**`,
        `- 구현 계획에 명시된 모든 파일이 생성/수정됨`,
        `- 빌드 성공 (npm run build / ./gradlew build)`,
        `- 테스트 통과 (있는 경우)`,
        ``,
        `## 구현 계획`,
        planContent,
      ].join("\n"),
    }, recorder);

    recorder?.recordResult(result.success, result.success ? "Code execution completed successfully" : `Code execution failed: ${result.error}`);

    return result;
  }

  // 3. 빌드 에러 수정: /build-fix
  async fixBuild(errorLog: string): Promise<OmcResult> {
    const recorder = this.createThinkingRecorderForSkill("build-fix");
    recorder?.recordThought("start", `Attempting to fix build error: ${errorLog.substring(0, 200)}...`);

    const result = await this.invoke({
      skill: "build-fix",
      prompt: [
        `/oh-my-claudecode:build-fix`,
        `다음 빌드 에러를 최소한의 변경으로 수정해주세요.`,
        ``,
        errorLog,
      ].join("\n"),
    }, recorder);

    recorder?.recordResult(result.success, result.success ? "Build fix completed successfully" : `Build fix failed: ${result.error}`);

    return result;
  }

  // 4. Git 충돌 해결 (Self-Healing 용)
  async resolveConflict(conflictInfo: string): Promise<OmcResult> {
    const recorder = this.createThinkingRecorderForSkill("conflict-resolve");
    recorder?.recordThought("start", "Attempting to resolve git conflict");

    const result = await this.invoke({
      skill: "autopilot",
      prompt: [
        `/oh-my-claudecode:autopilot`,
        `다음 Git 충돌을 해결해주세요.`,
        `충돌이 발생한 파일을 분석하고, 적절한 방식으로 병합해주세요.`,
        ``,
        `## 충돌 정보`,
        conflictInfo,
      ].join("\n"),
    }, recorder);

    recorder?.recordResult(result.success, result.success ? "Conflict resolved successfully" : `Conflict resolution failed: ${result.error}`);

    return result;
  }

  // 5. 플랜 품질 검토 (PlanCritic 용)
  async critiquePlan(planContent: string, issueBody: string): Promise<OmcResult> {
    const result = await this.invoke({
      skill: "analyze",
      prompt: [
        `/oh-my-claudecode:analyze`,
        ``,
        `다음 구현 플랜을 검토해주세요.`,
        ``,
        `## 이슈 내용`,
        issueBody,
        ``,
        `## 구현 플랜`,
        planContent,
        ``,
        `평가 기준:`,
        `1. 구현 범위가 이슈 요구사항을 충족하는가? (0-10)`,
        `2. 변경 파일 목록이 구체적인가?`,
        `3. 기술적 리스크가 식별되었는가?`,
        `4. 테스트 계획이 포함되어 있는가?`,
        ``,
        `출력 형식:`,
        `점수: X/10`,
        `문제점:`,
        `- ...`,
        `개선 제안:`,
        `- ...`,
        `[수정된 플랜이 있으면 <!-- ISSUE_PILOT_PLAN_START --> 마커로 포함]`,
      ].join("\n"),
    });
    return result;
  }

  // 6. 테스트 실패 수정 (Self-Healing 용)
  async fixTestFailure(testOutput: string): Promise<OmcResult> {
    const recorder = this.createThinkingRecorderForSkill("test-fix");
    recorder?.recordThought("start", "Attempting to fix test failures");

    const result = await this.invoke({
      skill: "autopilot",
      prompt: [
        `/oh-my-claudecode:autopilot`,
        `다음 테스트 실패를 수정해주세요.`,
        `실패한 테스트를 분석하고, 코드를 수정하여 테스트가 통과하도록 해주세요.`,
        ``,
        `## 테스트 출력`,
        testOutput,
      ].join("\n"),
    }, recorder);

    recorder?.recordResult(result.success, result.success ? "Test fix completed successfully" : `Test fix failed: ${result.error}`);

    return result;
  }

  private async invoke(invocation: OmcInvocation, recorder?: ThinkingRecorder | null): Promise<OmcResult> {
    const startTime = Date.now();
    const { skill } = invocation;
    let output   = "";
    let sessionId = "";
    let toolUses  = 0;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const heartbeatInterval = this.config.observer
      ? setInterval(() => {
          this.config.observer!.onHeartbeat({
            skill,
            elapsedMs: Date.now() - startTime,
            toolUses,
          });
        }, 30_000)
      : null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (heartbeatInterval !== null) clearInterval(heartbeatInterval);
    };

    try {
      const queryOptions: any = {
        prompt: invocation.prompt,
        options: {
          settingSources: ["user", "project"],
          systemPrompt: { type: "preset", preset: "claude_code" },
          allowedTools: this.config.allowedTools,
          disallowedTools: this.config.disallowedTools,
          permissionMode: this.config.permissionMode,
          cwd: this.config.cwd,
          maxTurns: 100,
          canUseTool: (toolName: string, toolInput: any) => {
            // Bash로 git commit/push 실행 차단 (dev-scheduler가 처리)
            if (toolName === "Bash" && toolInput?.command) {
              const cmd = toolInput.command as string;
              if (/git\s+(commit|push)/.test(cmd)) {
                return { allowed: false, reason: "git commit/push는 dev-scheduler가 처리합니다. 파일 수정만 하세요." };
              }
            }
            if (["Edit", "Write"].includes(toolName) && toolInput?.file_path) {
              // "**" 와일드카드는 모든 경로 허용
              if (this.config.allowedPaths.includes("**")) {
                return { allowed: true };
              }
              const allowed = this.config.allowedPaths.some(
                (p: string) => toolInput.file_path.startsWith(p)
              );
              if (!allowed) {
                return { allowed: false, reason: `Path not in allowedPaths: ${toolInput.file_path}` };
              }
            }
            return { allowed: true };
          },
        },
      };

      if (invocation.sessionId) {
        queryOptions.options.resume = invocation.sessionId;
      }

      for await (const message of query(queryOptions)) {
        if (message.type === "system" && (message as any).subtype === "init") {
          sessionId = (message as any).session_id ?? "";
          recorder?.recordThought("session_init", `Session initialized: ${sessionId}`);
        }
        if (message.type === "assistant" && (message as any).message?.content) {
          for (const block of (message as any).message.content) {
            if ("text" in block) {
              output += block.text;
              recorder?.recordThought("assistant_response", block.text.substring(0, 500));
              this.config.observer?.onProgress({
                skill,
                text: block.text.substring(0, 200),
                toolUses,
              });
            }
            if ("type" in block && block.type === "tool_use") {
              toolUses++;
              recorder?.recordToolUse(
                block.name ?? "unknown",
                block.input as Record<string, unknown> ?? {},
                undefined
              );
              this.config.observer?.onProgress({
                skill,
                toolName: block.name ?? "unknown",
                toolUses,
              });
            }
          }
        }
        if (message.type === "result") {
          const msg = message as any;
          if (msg.subtype === "success") {
            output = msg.result || output;
            recorder?.recordThought("result", "Task completed successfully");
          } else {
            const errorMsg = msg.errors?.join("; ") || `Result error: ${msg.subtype}`;
            recorder?.recordError(errorMsg, "Result error");
            cleanup();
            const result: OmcResult = {
              success: false,
              output,
              sessionId,
              durationMs: Date.now() - startTime,
              toolUses,
              error: errorMsg,
            };
            this.config.observer?.onComplete({ ...result, skill });
            return result;
          }
        }
      }

      cleanup();
      const result: OmcResult = {
        success: true,
        output,
        sessionId,
        durationMs: Date.now() - startTime,
        toolUses,
      };
      this.config.observer?.onComplete({ ...result, skill });
      return result;
    } catch (error: any) {
      cleanup();
      const result: OmcResult = {
        success: false,
        output,
        sessionId,
        durationMs: Date.now() - startTime,
        toolUses,
        error: error.message || String(error),
      };
      this.config.observer?.onComplete({ ...result, skill });
      return result;
    }
  }
}

/** OMC 설치 여부 확인 */
export async function isOmcAvailable(cwd: string): Promise<boolean> {
  try {
    for await (const msg of query({
      prompt: "OMC availability check",
      options: {
        maxTurns: 1,
        cwd,
        settingSources: ["user", "project"],
        systemPrompt: { type: "preset", preset: "claude_code" },
      } as any,
    })) {
      if ((msg as any).type === "system" && (msg as any).subtype === "init") {
        const m = msg as any;
        const hasOmc =
          m.plugins?.some((p: any) => p.name?.includes("oh-my-claudecode")) ||
          m.skills?.some((s: any) => s.includes("oh-my-claudecode"));
        if (hasOmc) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** config.json 기반으로 OmcClient 인스턴스 생성 */
export function createOmcClient(cwd: string, issueNumber?: number): OmcClient {
  const config = getConfig();
  return new OmcClient({
    cwd,
    allowedTools:    config.omc.allowedTools,
    disallowedTools: config.omc.disallowedTools,
    allowedPaths:    config.omc.allowedPaths,
    timeoutMs:       config.omc.timeoutMs,
    permissionMode:  config.omc.permissionMode,
    thinkingConfig:  config.thinking ?? getDefaultThinkingConfig(),
    issueNumber,
  });
}
