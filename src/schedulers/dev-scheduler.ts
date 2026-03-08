import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { BaseScheduler } from "./base-scheduler.js";
import { GitHubClient } from "../clients/github-client.js";
import { OmcClient } from "../clients/omc-client.js";
import { registerAgent } from "../state/active-agents.js";
import { createDashboardObserver } from "../server/observer-factory.js";
import { JiraClient } from "../clients/jira-client.js";
import { sanitizeIssueBody } from "../security/input-sanitizer.js";
import { scanBeforePR } from "../security/pre-pr-scanner.js";
import { acquireLock, releaseLock } from "../state/lock-manager.js";
import { updateState, getIssue, setIssuePrMap, resetHealingAttempts } from "../state/store.js";
import { IssueState } from "../state/types.js";
import type { Config, ProjectConfig, ThinkingConfig, HealingConfig } from "../state/types.js";
import { eventBus } from "../server/event-bus.js";
import { SelfHealer, getDefaultHealingConfig } from "../core/self-healer.js";
import { errorClassifier } from "../core/error-classifier.js";
import { ThinkingRecorder, getDefaultThinkingConfig } from "../core/thinking-recorder.js";
import { AIErrorAnalyzer, getDefaultAIAnalyzerConfig } from "../core/ai-error-analyzer.js";
import type { AIAnalyzerConfig } from "../state/types.js";
import { sendWebhook } from "../utils/webhook.js";
import { IssueLogger } from "../utils/issue-logger.js";
import { getProjectRoot } from "../config/config.js";

const PLAN_START_MARKER = "<!-- ISSUE_PILOT_PLAN_START -->";
const PLAN_END_MARKER = "<!-- ISSUE_PILOT_PLAN_END -->";

export class DevScheduler extends BaseScheduler {
  private jira: JiraClient | null = null;
  private selfHealer: SelfHealer;
  private healingConfig: HealingConfig;
  private thinkingConfig: ThinkingConfig;
  private aiAnalyzer: AIErrorAnalyzer;
  private aiAnalyzerConfig: AIAnalyzerConfig;

  constructor(config: Config) {
    super({
      name: "dev-scheduler",
      pollIntervalSec: config.schedulers.devPollIntervalSec,
      config,
    });

    // Healing 설정
    this.healingConfig = config.healing ?? getDefaultHealingConfig();
    this.selfHealer = new SelfHealer(this.healingConfig);

    // Thinking 설정
    this.thinkingConfig = config.thinking ?? getDefaultThinkingConfig();

    // AI Analyzer 설정
    this.aiAnalyzerConfig = config.aiAnalyzer ?? getDefaultAIAnalyzerConfig();
    this.aiAnalyzer = new AIErrorAnalyzer(this.aiAnalyzerConfig);

    // Jira 연동 (활성화된 경우) - 전역 공유
    if (config.jira.enabled) {
      try {
        this.jira = new JiraClient(config);
        this.log("Jira 연동 활성화");
      } catch (err) {
        this.logError("Jira 클라이언트 초기화 실패 (Jira 없이 진행)", err);
      }
    }

    if (this.healingConfig.enabled) {
      this.log("Self-Healing 기능 활성화");
    }
    if (this.thinkingConfig.enabled) {
      this.log("Thinking Mode 기록 활성화");
    }
    if (this.aiAnalyzerConfig.enabled) {
      this.log("AI Error Analyzer 활성화");
    }
  }

  protected async poll(): Promise<void> {
    const labels = this.config.labels;

    for (const project of this.config.projects) {
      if (!this.isProjectEnabled(project.id)) {
        continue;
      }

      const github = new GitHubClient(project.github.owner, project.github.repo);

      const rateLimitInfo = github.getRateLimitInfo();
      this.adjustPollInterval(rateLimitInfo);

      // "개발 진행" 라벨 이슈 조회
      const issues = await github.getIssuesByLabel(labels.developing);

      if (issues.length === 0) continue;

      eventBus.emit("dashboard", {
        id: 0,
        ts: new Date().toISOString(),
        type: "scheduler_tick",
        scheduler: "dev-scheduler",
        projectId: project.id,
        processedCount: issues.length,
      });

      this.log(`[${project.id}] 처리 대상 이슈 ${issues.length}건 발견`);

      // 파일 충돌 방지를 위해 순차 처리
      for (const issue of issues) {
        await this.processIssue(project, github, {
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
        });
      }
    }
  }

  private async processIssue(
    project: ProjectConfig,
    github: GitHubClient,
    issue: { number: number; title: string; body: string }
  ): Promise<void> {
    const projectId = project.id;
    const issueNumber = issue.number;

    // 이미 PR이 생성된 이슈는 스킵 (merge-scheduler가 처리)
    const existing = getIssue(projectId, issueNumber);
    if (existing?.prNumber) {
      this.log(`[${projectId}] 이슈 #${issueNumber} PR #${existing.prNumber} 이미 존재, 스킵`);
      return;
    }

    // 락 획득 (Claude 작업 TTL: 30분)
    const locked = acquireLock(projectId, issueNumber, "dev-scheduler", true);
    if (!locked) {
      this.log(`[${projectId}] 이슈 #${issueNumber} 락 획득 실패, 스킵`);
      return;
    }

    const labels = this.config.labels;
    const repoPath = project.github.repoPath;
    let worktreePath = "";
    let branchName = "";
    const issueLog = new IssueLogger(projectId, issueNumber, getProjectRoot());

    try {
      issueLog.info("개발 시작");
      // 1) 대상 레포 클론 확인
      this.ensureRepoCloned(project);

      // 2) fetch 최신 상태
      const baseBranch = project.github.baseBranch;
      execSync(`git -C "${repoPath}" fetch origin`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      this.log(`[${projectId}] git fetch origin 완료`);

      const record = getIssue(projectId, issueNumber);
      const retryCount = record?.retryCount ?? 0;

      // 재시도 시 이전 healing 시도 기록 초기화 (카운터 누적 방지)
      if (retryCount > 0) {
        resetHealingAttempts(projectId, issueNumber);
      }

      // 3) 플랜 마커 파싱
      const planContent = await this.extractPlanContent(projectId, github, issueNumber);
      if (!planContent) {
        await github.addComment(
          issueNumber,
          "플랜 마커(`<!-- ISSUE_PILOT_PLAN_START/END -->`)를 찾을 수 없습니다. '플랜 완료' 단계가 완료되었는지 확인해주세요."
        );
        releaseLock(projectId, issueNumber);
        return;
      }

      // 4) Jira 티켓 생성 (활성화 시)
      let jiraTicketKey: string | undefined;
      if (this.jira) {
        try {
          const ticket = await this.jira.createTicket(
            issue.title,
            planContent.replace(/<!-- ISSUE_PILOT_PLAN_START -->/, "").replace(/<!-- ISSUE_PILOT_PLAN_END -->/, "").trim()
          );
          jiraTicketKey = ticket.key;
          this.log(`[${projectId}] Jira 티켓 생성: ${jiraTicketKey}`);
        } catch (err) {
          this.logError(`[${projectId}] Jira 티켓 생성 실패 (Jira 없이 진행)`, err);
        }
      }

      // 5) 브랜치명 생성
      branchName = jiraTicketKey
        ? `feature/${jiraTicketKey}`
        : `feature/issue-${issueNumber}`;
      issueLog.info(`브랜치 생성: ${branchName}`);

      // 6) 워크트리 생성 (프로젝트별 repoPath 하위)
      const worktreeBase = join(repoPath, ".worktrees");
      worktreePath = join(worktreeBase, `issue-${issueNumber}`);

      // 이전 워크트리가 남아있으면 정리
      this.cleanupWorktree(repoPath, worktreePath, branchName);

      mkdirSync(worktreeBase, { recursive: true });
      this.log(`[${projectId}] 워크트리 생성: ${worktreePath}`);
      try {
        const result = execSync(
          `git -C "${repoPath}" worktree add "${worktreePath}" -b ${branchName} origin/${baseBranch}`,
          { stdio: "pipe", timeout: 30_000, encoding: "utf-8" }
        );
        this.log(`[${projectId}] git worktree add 성공: ${result.trim()}`);
      } catch (err: any) {
        const stderr = err.stderr?.toString() || err.message;
        this.log(`[${projectId}] ERROR git worktree add 실패: ${stderr}`);
        throw new Error(`git worktree add failed: ${stderr}`);
      }

      // 상태 업데이트
      updateState(projectId, issueNumber, IssueState.DEVELOPING, { title: issue.title, branchName, retryCount });

      // 7) uipro-cli 초기화 (프론트엔드 프로젝트)
      if (project.frontend) {
        this.initUipro(worktreePath, projectId, issueNumber);
      }

      // 8) 플랜 사니타이징
      const sanitizedPlan = this.config.security.sanitizeInput
        ? sanitizeIssueBody(planContent)
        : planContent;

      // 8) OMC autopilot으로 코드 변경 (cwd = 워크트리)
      this.log(`[${projectId}] 이슈 #${issueNumber} autopilot 실행 중 (워크트리: ${worktreePath})...`);
      issueLog.info("autopilot 실행 중...");

      // ThinkingRecorder 생성 (Thinking Mode 활성화 시)
      const thinkingRecorder = this.thinkingConfig.enabled
        ? new ThinkingRecorder(this.thinkingConfig, worktreePath, issueNumber, "dev-scheduler")
        : null;

      thinkingRecorder?.recordThought("init", `Starting development for issue #${issueNumber}`);

      const agentStartedAt = new Date().toISOString();
      registerAgent({
        projectId,
        issueNumber,
        skill: "autopilot",
        sessionId: "",
        startedAt: agentStartedAt,
        toolUses: 0,
      });

      const observer = createDashboardObserver(projectId, issueNumber, "autopilot");

      const omc = new OmcClient({
        cwd: worktreePath,
        allowedTools: this.config.omc.allowedTools,
        disallowedTools: this.config.omc.disallowedTools,
        allowedPaths: [worktreePath],  // 워크트리 경로만 허용 (main 브랜치 오염 방지)
        timeoutMs: this.config.omc.timeoutMs,
        permissionMode: this.config.omc.permissionMode,
        thinkingConfig: this.thinkingConfig,
        issueNumber,
        observer,
      });

      const execResult = await omc.executeCode(sanitizedPlan);

      if (!execResult.success) {
        const errorMessage = execResult.error ?? "코드 실행 실패";
        thinkingRecorder?.recordError(errorMessage, "Code execution failed");

        // Self-Healing 시도
        if (this.healingConfig.enabled) {
          const healingResult = await this.selfHealer.heal({
            projectId,
            issueNumber,
            worktreePath,
            baseBranch,
            errorMessage,
            omc,
            thinkingRecorder,
          });

          if (healingResult.success) {
            this.log(`[${projectId}] Self-Healing 성공: ${healingResult.strategy}`);
            thinkingRecorder?.recordThought("healing_success", `Self-healing succeeded with strategy: ${healingResult.strategy}`);
            
            // Webhook 발송
            await sendWebhook({
              eventType: "self_healing_success",
              projectId,
              issueNumber,
              message: `자동 복구 성공: ${healingResult.strategy}`
            });
            
            // 재시도 (healing 성공 후)
            const retryResult = await omc.executeCode(sanitizedPlan);
            if (!retryResult.success) {
              throw new Error(retryResult.error ?? "Self-healing 후 재시도 실패");
            }
          } else {
            this.log(`[${projectId}] Self-Healing 실패: ${healingResult.message}`);
            thinkingRecorder?.recordThought("healing_failed", healingResult.message);
            
            // Webhook 발송
            await sendWebhook({
              eventType: "error",
              projectId,
              issueNumber,
              errorMessage: `Self-Healing 실패: ${healingResult.message}`
            });

            thinkingRecorder?.recordResult(false, `Development failed: ${healingResult.message}`);
            throw new Error(`코드 구현 실패 (Self-Healing도 불가): ${healingResult.message}`);
          }
        } else {
          // Self-Healing 비활성화 시 기존 로직
          const fixed = await this.tryFixBuild(omc, errorMessage);
          if (!fixed) {
            thinkingRecorder?.recordResult(false, `Development failed: ${errorMessage}`);
            throw new Error(errorMessage);
          }
        }
      }

      thinkingRecorder?.recordThought("code_execution_complete", "Code changes applied successfully");

      // 9) PR 전 보안 스캐닝
      if (this.config.security.preScanEnabled) {
        const changedFiles = this.getChangedFiles(worktreePath);
        const scanResult = scanBeforePR(changedFiles, worktreePath);
        if (!scanResult.passed) {
          throw new Error(`보안 스캔 실패:\n${scanResult.issues.join("\n")}`);
        }
      }

      // autopilot이 올바른 브랜치에서 작업했는지 검증
      const currentBranch = execSync(`git -C "${worktreePath}" branch --show-current`, {
        encoding: "utf-8", stdio: "pipe"
      }).trim();
      if (currentBranch !== branchName) {
        throw new Error(`브랜치 불일치: ${currentBranch} (예상: ${branchName}). autopilot이 잘못된 브랜치에서 작업했습니다.`);
      }

      // 10) 커밋 & 푸시 (워크트리에서)
      const statusOutput = execSync(`git -C "${worktreePath}" status --porcelain`, {
        encoding: "utf-8", stdio: "pipe"
      }).trim();
      if (!statusOutput) {
        throw new Error(`코드 변경사항 없음: 이슈 구현이 완료되지 않았습니다 (#${issueNumber})`);
      }
      execSync(`git -C "${worktreePath}" add -A`, { stdio: "pipe" });
      execSync(
        `git -C "${worktreePath}" commit -m "[Issue #${issueNumber}] ${issue.title}"`,
        { stdio: "pipe" }
      );
      execSync(`git -C "${worktreePath}" push origin ${branchName}`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      this.log(`[${projectId}] 브랜치 ${branchName} 푸시 완료`);

      // 11) PR 생성
      const prTitle = jiraTicketKey
        ? `[${jiraTicketKey}] ${issue.title}`
        : `[Issue #${issueNumber}] ${issue.title}`;
      const prBody = [
        `## 구현 내용`,
        ``,
        jiraTicketKey ? `**Jira**: [${jiraTicketKey}](https://${this.config.jira.host}/browse/${jiraTicketKey})` : "",
        ``,
        planContent,
        ``,
        `---`,
        `Closes #${issueNumber}`,
      ].filter(Boolean).join("\n");

      const pr = await github.createPullRequest(prTitle, prBody, branchName, baseBranch);
      const prNumber = pr.number;

      // 상태 및 PR 매핑 업데이트
      updateState(projectId, issueNumber, IssueState.DEVELOPING, {
        branchName,
        prNumber,
        jiraTicket: jiraTicketKey,
        retryCount: 0,
        errorLog: undefined,
      });
      setIssuePrMap(projectId, issueNumber, prNumber);

      eventBus.emit("dashboard", {
        id: 0,
        ts: new Date().toISOString(),
        type: "pr_created",
        projectId,
        issueNumber,
        prNumber,
        branchName,
      });

      const jiraLink = jiraTicketKey
        ? `\nJira: [${jiraTicketKey}](https://${this.config.jira.host}/browse/${jiraTicketKey})`
        : "";
      await github.addComment(
        issueNumber,
        `코드 변경 및 PR이 생성되었습니다. :rocket:\n\nPR: #${prNumber}${jiraLink}`
      );

      issueLog.info(`PR #${prNumber} 생성 완료 (${branchName})`);
      this.log(`[${projectId}] 이슈 #${issueNumber} PR #${prNumber} 생성 완료`);

      // Webhook 발송
      const prUrl = `https://github.com/${project.github.owner}/${project.github.repo}/pull/${prNumber}`;
      await sendWebhook({
        eventType: "pr_created",
        projectId,
        issueNumber,
        prNumber,
        prUrl,
        message: "PR 생성 완료"
      });
    } catch (err) {
      await this.handleFailure(projectId, github, issueNumber, err);
    } finally {
      // 워크트리 정리
      if (worktreePath) {
        this.cleanupWorktree(repoPath, worktreePath, branchName);
      }
      releaseLock(projectId, issueNumber);
    }
  }

  /**
   * 대상 레포가 로컬에 없으면 clone 한다.
   */
  private ensureRepoCloned(project: ProjectConfig): void {
    const repoPath = project.github.repoPath;
    const gitDir = join(repoPath, ".git");

    if (existsSync(gitDir)) return;

    const { owner, repo } = project.github;
    const parentDir = dirname(repoPath);
    mkdirSync(parentDir, { recursive: true });

    this.log(`[${project.id}] 레포 클론 시작: ${owner}/${repo} → ${repoPath}`);
    execSync(
      `git clone https://github.com/${owner}/${repo}.git "${repoPath}"`,
      { stdio: "pipe", timeout: 120_000 }
    );
    this.log(`[${project.id}] 레포 클론 완료`);
  }

  /**
   * 워크트리를 안전하게 정리한다.
   */
  private cleanupWorktree(repoPath: string, worktreePath: string, branchName: string): void {
    try {
      execSync(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`, {
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch {
      // 워크트리가 없으면 무시
    }
    // 로컬 브랜치 정리 (push 완료 후이므로 삭제해도 안전)
    try {
      execSync(`git -C "${repoPath}" branch -D ${branchName}`, {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // 브랜치가 없으면 무시
    }
    // remote 브랜치 정리 (재시도 시 이전 잘못된 상태가 남지 않도록)
    try {
      execSync(`git -C "${repoPath}" push origin --delete ${branchName}`, {
        stdio: "pipe", timeout: 15_000,
      });
    } catch {
      // remote 브랜치 없으면 무시
    }
  }

  /**
   * 프론트엔드 프로젝트 worktree에 uipro-cli를 초기화한다.
   * 실패해도 개발 진행을 막지 않는다.
   */
  private initUipro(worktreePath: string, projectId: string, issueNumber: number): void {
    try {
      execSync("npm install -g uipro-cli", { stdio: "pipe", timeout: 60_000 });
      execSync("uipro init --ai claude", { cwd: worktreePath, stdio: "pipe", timeout: 30_000 });
      this.log(`[${projectId}] 이슈 #${issueNumber} uipro-cli 초기화 완료`);
    } catch (err) {
      this.logError(`[${projectId}] 이슈 #${issueNumber} uipro-cli 초기화 실패 (계속 진행)`, err);
    }
  }

  /**
   * 이슈 코멘트에서 플랜 마커 블록을 추출한다.
   * DB → GitHub 코멘트 순으로 확인.
   */
  private async extractPlanContent(
    projectId: string,
    github: GitHubClient,
    issueNumber: number
  ): Promise<string | null> {
    // DB에서 먼저 확인
    const record = getIssue(projectId, issueNumber);
    if (record?.planContent) {
      const start = record.planContent.indexOf(PLAN_START_MARKER);
      const end = record.planContent.indexOf(PLAN_END_MARKER);
      if (start !== -1 && end !== -1) {
        return record.planContent.slice(start, end + PLAN_END_MARKER.length);
      }
    }

    // GitHub 코멘트에서 검색
    const comments = await github.getComments(issueNumber);
    for (const comment of [...comments].reverse()) {
      const body = comment.body ?? "";
      const start = body.indexOf(PLAN_START_MARKER);
      const end = body.indexOf(PLAN_END_MARKER);
      if (start !== -1 && end !== -1 && end > start) {
        return body.slice(start, end + PLAN_END_MARKER.length);
      }
    }

    return null;
  }

  /**
   * 빌드 에러 자동 수정 (최대 2회).
   */
  private async tryFixBuild(omc: OmcClient, errorLog: string): Promise<boolean> {
    const maxFix = 2;
    for (let i = 0; i < maxFix; i++) {
      this.log(`빌드 수정 시도 ${i + 1}/${maxFix}...`);
      const fixResult = await omc.fixBuild(errorLog);
      if (fixResult.success) {
        this.log("빌드 수정 성공");
        return true;
      }
      this.logError(`빌드 수정 ${i + 1}/${maxFix} 실패`, fixResult.error);
    }
    return false;
  }

  /**
   * git diff --name-only로 변경 파일 목록 반환.
   */
  private getChangedFiles(cwd: string): string[] {
    try {
      const output = execSync(`git -C "${cwd}" diff --name-only HEAD`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return output
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async handleFailure(
    projectId: string,
    github: GitHubClient,
    issueNumber: number,
    err: unknown
  ): Promise<void> {
    const labels = this.config.labels;
    const record = getIssue(projectId, issueNumber);
    const retryCount = (record?.retryCount ?? 0) + 1;
    const errMsg = err instanceof Error ? err.message : String(err);

    this.logError(`[${projectId}] 이슈 #${issueNumber} 처리 실패 (${retryCount}/${this.retryPolicy.maxRetries})`, err);

    eventBus.emit("dashboard", {
      id: 0,
      ts: new Date().toISOString(),
      type: "error",
      scheduler: "dev-scheduler",
      projectId,
      issueNumber,
      message: errMsg,
    });

    if (retryCount < this.retryPolicy.maxRetries) {
      const delayMs = this.getRetryDelay(retryCount - 1);
      updateState(projectId, issueNumber, IssueState.DEVELOPING, { retryCount, errorLog: errMsg });

      await github.addComment(
        issueNumber,
        `개발 중 오류가 발생했습니다. ${Math.ceil(delayMs / 1000)}초 후 재시도합니다. (${retryCount}/${this.retryPolicy.maxRetries})\n\`\`\`\n${errMsg}\n\`\`\``
      );
    } else {
      await github.removeLabel(issueNumber, labels.developing);
      await github.addLabel(issueNumber, labels.devFailed);
      updateState(projectId, issueNumber, IssueState.DEV_FAILED, { retryCount, errorLog: errMsg });

      // AI 에러 분석 수행 (최종 실패 시)
      let aiAnalysisComment = "";
      if (this.aiAnalyzerConfig.enabled && this.aiAnalyzerConfig.analyzeOnFinalFailure) {
        this.log(`[${projectId}] 이슈 #${issueNumber} AI 에러 분석 시작...`);
        const errorType = errorClassifier.classify(errMsg);
        const analysisResult = await this.aiAnalyzer.analyze({
          projectId,
          issueNumber,
          errorMessage: errMsg,
          errorType,
        });

        if (analysisResult.success && analysisResult.analysis) {
          this.log(`[${projectId}] AI 에러 분석 완료: ${analysisResult.reportPath}`);
          aiAnalysisComment = "\n\n" + this.aiAnalyzer.formatForGitHubComment(analysisResult.analysis);
        } else {
          this.logError(`[${projectId}] AI 에러 분석 실패`, analysisResult.error);
        }
      }

      await github.addComment(
        issueNumber,
        `개발이 ${this.retryPolicy.maxRetries}회 모두 실패했습니다. 수동 개입이 필요합니다.\n\`\`\`\n${errMsg}\n\`\`\`${aiAnalysisComment}`
      );
    }
  }
}
