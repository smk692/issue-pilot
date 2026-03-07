import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { ThinkingConfig } from "../state/types.js";

export interface ThinkingEntry {
  timestamp: string;
  phase: string;
  thought: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
}

export class ThinkingRecorder {
  private entries: ThinkingEntry[] = [];
  private filePath: string | null = null;
  private config: ThinkingConfig;
  private issueNumber: number;
  private skillName: string;

  constructor(
    config: ThinkingConfig,
    projectPath: string,
    issueNumber: number,
    skillName: string
  ) {
    this.config = config;
    this.issueNumber = issueNumber;
    this.skillName = skillName;

    if (config.enabled) {
      const outputDir = join(projectPath, config.outputDir);
      mkdirSync(outputDir, { recursive: true });

      const timestamp = config.includeTimestamp
        ? `-${new Date().toISOString().replace(/[:.]/g, "-")}`
        : "";
      const fileName = `${skillName}-issue-${issueNumber}${timestamp}.md`;
      this.filePath = join(outputDir, fileName);

      // 파일 헤더 작성
      this.writeHeader();
    }
  }

  private writeHeader(): void {
    if (!this.filePath) return;

    const header = [
      `# Thinking Mode Log`,
      ``,
      `- **Issue**: #${this.issueNumber}`,
      `- **Skill**: ${this.skillName}`,
      `- **Started At**: ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
    ].join("\n");

    writeFileSync(this.filePath, header, "utf-8");
  }

  /**
   * AI의 생각/추론 과정을 기록한다.
   */
  recordThought(phase: string, thought: string): void {
    if (!this.config.enabled) return;

    const entry: ThinkingEntry = {
      timestamp: new Date().toISOString(),
      phase,
      thought,
    };

    this.entries.push(entry);
    this.appendToFile(entry);
  }

  /**
   * 도구 사용을 기록한다.
   */
  recordToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResult?: string
  ): void {
    if (!this.config.enabled) return;

    const entry: ThinkingEntry = {
      timestamp: new Date().toISOString(),
      phase: "tool_use",
      thought: `Using tool: ${toolName}`,
      toolName,
      toolInput,
      toolResult: this.truncateResult(toolResult),
    };

    this.entries.push(entry);
    this.appendToFile(entry);
  }

  /**
   * 에러 발생을 기록한다.
   */
  recordError(errorMessage: string, context?: string): void {
    if (!this.config.enabled) return;

    const entry: ThinkingEntry = {
      timestamp: new Date().toISOString(),
      phase: "error",
      thought: context ? `${context}: ${errorMessage}` : errorMessage,
    };

    this.entries.push(entry);
    this.appendToFile(entry);
  }

  /**
   * Self-Healing 시도를 기록한다.
   */
  recordHealingAttempt(
    errorType: string,
    strategy: string,
    attemptNumber: number
  ): void {
    if (!this.config.enabled) return;

    const entry: ThinkingEntry = {
      timestamp: new Date().toISOString(),
      phase: "self_healing",
      thought: `Attempting self-healing for ${errorType} using strategy: ${strategy} (attempt ${attemptNumber})`,
    };

    this.entries.push(entry);
    this.appendToFile(entry);
  }

  /**
   * 최종 결과를 기록한다.
   */
  recordResult(success: boolean, summary: string): void {
    if (!this.config.enabled) return;

    const entry: ThinkingEntry = {
      timestamp: new Date().toISOString(),
      phase: success ? "success" : "failure",
      thought: summary,
    };

    this.entries.push(entry);
    this.appendToFile(entry);

    // 파일 푸터 작성
    this.writeFooter(success);
  }

  private appendToFile(entry: ThinkingEntry): void {
    if (!this.filePath) return;

    const lines: string[] = [];

    lines.push(`## [${entry.timestamp}] ${entry.phase.toUpperCase()}`);
    lines.push(``);
    lines.push(entry.thought);

    if (entry.toolName) {
      lines.push(``);
      lines.push(`### Tool: \`${entry.toolName}\``);
      lines.push(``);
      lines.push("```json");
      lines.push(JSON.stringify(entry.toolInput, null, 2));
      lines.push("```");

      if (entry.toolResult) {
        lines.push(``);
        lines.push("**Result:**");
        lines.push("```");
        lines.push(entry.toolResult);
        lines.push("```");
      }
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    const content = lines.join("\n");

    // 파일 크기 체크
    if (existsSync(this.filePath)) {
      const stats = require("fs").statSync(this.filePath);
      if (stats.size + content.length > this.config.maxFileSize) {
        // 최대 크기 초과 시 새 파일 생성
        this.rotateFile();
      }
    }

    appendFileSync(this.filePath, content, "utf-8");
  }

  private writeFooter(success: boolean): void {
    if (!this.filePath) return;

    const footer = [
      ``,
      `# Summary`,
      ``,
      `- **Status**: ${success ? "SUCCESS" : "FAILURE"}`,
      `- **Total Entries**: ${this.entries.length}`,
      `- **Completed At**: ${new Date().toISOString()}`,
      ``,
    ].join("\n");

    appendFileSync(this.filePath, footer, "utf-8");
  }

  private truncateResult(result?: string): string | undefined {
    if (!result) return undefined;

    const maxLength = 1000;
    if (result.length <= maxLength) return result;

    return result.substring(0, maxLength) + "\n... (truncated)";
  }

  private rotateFile(): void {
    if (!this.filePath) return;

    const ext = ".md";
    const base = this.filePath.replace(ext, "");
    const rotatedPath = `${base}-${Date.now()}${ext}`;

    // 기존 파일을 로테이션하고 새 파일 시작
    require("fs").renameSync(this.filePath, rotatedPath);
    this.writeHeader();
  }

  /**
   * 모든 기록된 엔트리를 반환한다.
   */
  getEntries(): ThinkingEntry[] {
    return [...this.entries];
  }

  /**
   * 기록된 파일 경로를 반환한다.
   */
  getFilePath(): string | null {
    return this.filePath;
  }
}

/**
 * 기본 ThinkingConfig를 반환한다.
 */
export function getDefaultThinkingConfig(): ThinkingConfig {
  return {
    enabled: true,
    outputDir: ".omc/thinking",
    includeTimestamp: true,
    maxFileSize: 5 * 1024 * 1024, // 5MB
  };
}
