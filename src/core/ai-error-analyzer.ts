import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ErrorType, AIAnalyzerConfig, ErrorAnalysis } from "../state/types.js";
import { errorClassifier } from "./error-classifier.js";
import { saveErrorAnalysis, getLatestErrorAnalysis } from "../state/store.js";
import { getHealingAttempts } from "../state/store.js";

export interface AnalysisContext {
  projectId: string;
  issueNumber: number;
  errorMessage: string;
  errorType: ErrorType;
  codeContext?: string;
  healingHistory?: string;
}

export interface AnalysisResult {
  success: boolean;
  analysis?: ErrorAnalysis;
  error?: string;
  reportPath?: string;
}

export class AIErrorAnalyzer {
  private config: AIAnalyzerConfig;

  constructor(config: AIAnalyzerConfig) {
    this.config = config;
  }

  /**
   * 최종 실패 시 AI 기반 에러 분석을 수행한다.
   */
  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        error: "AI Error Analyzer is disabled",
      };
    }

    if (!this.config.analyzeOnFinalFailure) {
      return {
        success: false,
        error: "AI analysis is only triggered on final failure",
      };
    }

    try {
      // Healing 히스토리 수집
      const healingAttempts = getHealingAttempts(
        context.projectId,
        context.issueNumber
      );

      const healingHistory = healingAttempts
        .map(
          (a) =>
            `- [${a.createdAt}] ${a.errorType}: ${a.strategy} (${
              a.success ? "성공" : "실패"
            })`
        )
        .join("\n");

      // AI 분석 프롬프트 생성
      const analysisPrompt = this.buildAnalysisPrompt({
        ...context,
        healingHistory: healingHistory || "이전 healing 시도 기록 없음",
      });

      // AI 분석 수행
      const analysisResult = await this.performAnalysis(analysisPrompt);

      if (!analysisResult) {
        return {
          success: false,
          error: "AI analysis returned no result",
        };
      }

      // 분석 결과 파싱
      const analysis = this.parseAnalysisResult(
        analysisResult,
        context.errorType
      );

      // DB에 저장
      saveErrorAnalysis(
        context.projectId,
        context.issueNumber,
        analysis.errorType,
        analysis.rootCause,
        analysis.suggestedFix,
        analysis.confidence
      );

      // 분석 리포트 파일 생성
      const reportPath = this.generateReport(context, analysis);

      return {
        success: true,
        analysis,
        reportPath,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `AI analysis failed: ${errorMsg}`,
      };
    }
  }

  private buildAnalysisPrompt(context: AnalysisContext): string {
    return [
      `# 에러 분석 요청`,
      ``,
      `## 에러 정보`,
      `- **에러 타입**: ${context.errorType}`,
      `- **에러 설명**: ${errorClassifier.getDescription(context.errorType)}`,
      `- **프로젝트**: ${context.projectId}`,
      `- **이슈 번호**: #${context.issueNumber}`,
      ``,
      `## 에러 메시지`,
      "```",
      context.errorMessage,
      "```",
      ``,
      context.codeContext
        ? [
            `## 관련 코드 컨텍스트`,
            "```",
            context.codeContext,
            "```",
            ``,
          ].join("\n")
        : "",
      `## Self-Healing 히스토리`,
      context.healingHistory || "이전 시도 없음",
      ``,
      `## 분석 요청`,
      `위 에러에 대해 다음을 분석해주세요:`,
      ``,
      `1. **근본 원인 (Root Cause)**: 에러가 발생한 근본적인 원인`,
      `2. **해결 방안 (Suggested Fix)**: 이 에러를 해결하기 위한 구체적인 방안`,
      `3. **신뢰도 (Confidence)**: 분석의 신뢰도 (0.0 ~ 1.0)`,
      ``,
      `## 응답 형식`,
      `다음 JSON 형식으로 응답해주세요:`,
      "```json",
      `{`,
      `  "rootCause": "에러의 근본 원인 설명",`,
      `  "suggestedFix": "해결 방안 설명",`,
      `  "confidence": 0.8`,
      `}`,
      "```",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async performAnalysis(prompt: string): Promise<string | null> {
    try {
      let output = "";

      for await (const message of query({
        prompt,
        options: {
          maxTurns: 1,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
          },
        } as any,
      })) {
        if (message.type === "assistant") {
          const msg = message as any;
          if (msg.message?.content) {
            for (const block of msg.message.content) {
              if ("text" in block) {
                output += block.text;
              }
            }
          }
        }
        if (message.type === "result") {
          const msg = message as any;
          if (msg.subtype === "success" && msg.result) {
            output = msg.result;
          }
        }
      }

      return output || null;
    } catch (error) {
      console.error("AI analysis query failed:", error);
      return null;
    }
  }

  private parseAnalysisResult(
    result: string,
    errorType: ErrorType
  ): ErrorAnalysis {
    // JSON 블록 추출
    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : result;

    try {
      const parsed = JSON.parse(jsonContent);
      return {
        errorType,
        rootCause: parsed.rootCause || "분석 결과 없음",
        suggestedFix: parsed.suggestedFix || "해결 방안 없음",
        confidence: Math.min(
          1,
          Math.max(0, parseFloat(parsed.confidence) || 0.5)
        ),
        analyzedAt: new Date().toISOString(),
      };
    } catch {
      // JSON 파싱 실패 시 텍스트 기반 파싱
      return {
        errorType,
        rootCause: this.extractSection(result, "근본 원인", "Root Cause") || result.substring(0, 500),
        suggestedFix: this.extractSection(result, "해결 방안", "Suggested Fix") || "수동 검토 필요",
        confidence: 0.3, // 파싱 실패 시 낮은 신뢰도
        analyzedAt: new Date().toISOString(),
      };
    }
  }

  private extractSection(text: string, ...keywords: string[]): string | null {
    for (const keyword of keywords) {
      const pattern = new RegExp(`${keyword}[:\\s]*(.+?)(?=\\n\\n|\\n#|$)`, "is");
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }

  private generateReport(
    context: AnalysisContext,
    analysis: ErrorAnalysis
  ): string {
    const outputDir = join(process.cwd(), this.config.outputDir);
    mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `error-${context.issueNumber}-${context.errorType}-${timestamp}.md`;
    const filePath = join(outputDir, fileName);

    const report = [
      `# Error Analysis Report`,
      ``,
      `- **Generated At**: ${new Date().toISOString()}`,
      `- **Project**: ${context.projectId}`,
      `- **Issue**: #${context.issueNumber}`,
      `- **Error Type**: ${context.errorType}`,
      `- **Confidence**: ${(analysis.confidence * 100).toFixed(1)}%`,
      ``,
      `---`,
      ``,
      `## Error Message`,
      ``,
      "```",
      context.errorMessage,
      "```",
      ``,
      `## Root Cause Analysis`,
      ``,
      analysis.rootCause,
      ``,
      `## Suggested Fix`,
      ``,
      analysis.suggestedFix,
      ``,
      context.healingHistory
        ? [
            `## Self-Healing History`,
            ``,
            context.healingHistory,
            ``,
          ].join("\n")
        : "",
      `---`,
      ``,
      `*This report was automatically generated by Issue Pilot AI Error Analyzer.*`,
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(filePath, report, "utf-8");

    return filePath;
  }

  /**
   * GitHub 이슈에 첨부할 분석 요약을 생성한다.
   */
  formatForGitHubComment(analysis: ErrorAnalysis): string {
    return [
      `## AI 에러 분석 결과`,
      ``,
      `**에러 타입**: ${analysis.errorType}`,
      `**신뢰도**: ${(analysis.confidence * 100).toFixed(1)}%`,
      ``,
      `### 근본 원인`,
      analysis.rootCause,
      ``,
      `### 해결 방안`,
      analysis.suggestedFix,
      ``,
      `---`,
      `_분석 시간: ${analysis.analyzedAt}_`,
    ].join("\n");
  }
}

/**
 * 기본 AIAnalyzerConfig를 반환한다.
 */
export function getDefaultAIAnalyzerConfig(): AIAnalyzerConfig {
  return {
    enabled: true,
    analyzeOnFinalFailure: true,
    outputDir: ".omc/errors",
  };
}
