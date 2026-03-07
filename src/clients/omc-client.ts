import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig } from "../config/config.js";
import { ThinkingRecorder, getDefaultThinkingConfig } from "../core/thinking-recorder.js";
import type { ThinkingConfig } from "../state/types.js";

export interface OmcClientConfig {
  cwd: string;
  allowedTools: string[];
  disallowedTools: string[];
  allowedPaths: string[];
  timeoutMs: number;
  permissionMode: "acceptEdits" | "default";
  thinkingConfig?: ThinkingConfig;
  issueNumber?: number;
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
        `다음 구현 계획에 따라 코드를 변경해주세요.`,
        `빌드와 테스트가 통과하는지 반드시 검증해주세요.`,
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

  // 5. 테스트 실패 수정 (Self-Healing 용)
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
    let output   = "";
    let sessionId = "";
    let toolUses  = 0;

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
            if (["Edit", "Write"].includes(toolName) && toolInput?.file_path) {
              const allowed = this.config.allowedPaths.some(
                (p: string) => toolInput.file_path.includes(p)
              );
              if (!allowed) {
                return { allowed: false, reason: `Path not in allowedPaths` };
              }
            }
            return { allowed: true };
          },
        },
      };

      if (invocation.sessionId) {
        queryOptions.options.resume = invocation.sessionId;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

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
            }
            if ("type" in block && block.type === "tool_use") {
              toolUses++;
              recorder?.recordToolUse(
                block.name ?? "unknown",
                block.input as Record<string, unknown> ?? {},
                undefined
              );
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
            throw new Error(errorMsg);
          }
        }
      }

      clearTimeout(timeout);

      return { success: true, output, sessionId, durationMs: Date.now() - startTime, toolUses };
    } catch (error: any) {
      return {
        success: false,
        output,
        sessionId,
        durationMs: Date.now() - startTime,
        toolUses,
        error: error.message || String(error),
      };
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
