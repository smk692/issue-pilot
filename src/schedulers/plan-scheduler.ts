import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { BaseScheduler } from "./base-scheduler.js";
import { GitHubClient } from "../clients/github-client.js";
import { OmcClient } from "../clients/omc-client.js";
import { sanitizeIssueBody } from "../security/input-sanitizer.js";
import { acquireLock, releaseLock } from "../state/lock-manager.js";
import { updateState, getIssue } from "../state/store.js";
import { IssueState } from "../state/types.js";
import type { Config, ProjectConfig } from "../state/types.js";
import { eventBus } from "../server/event-bus.js";

const PLAN_START_MARKER = "<!-- ISSUE_PILOT_PLAN_START -->";
const PLAN_END_MARKER = "<!-- ISSUE_PILOT_PLAN_END -->";

export class PlanScheduler extends BaseScheduler {
  constructor(config: Config) {
    super({
      name: "plan-scheduler",
      pollIntervalSec: config.schedulers.planPollIntervalSec,
      config,
    });
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

      // "이슈 플랜" 라벨 이슈 조회
      const planIssues = await github.getIssuesByLabel(labels.planRequest);
      // "플랜 수정" 라벨 이슈 조회
      const reviseIssues = await github.getIssuesByLabel(labels.planRevise);

      const issues = [...planIssues, ...reviseIssues];

      if (issues.length === 0) continue;

      eventBus.emit("dashboard", {
        id: 0,
        ts: new Date().toISOString(),
        type: "scheduler_tick",
        scheduler: "plan-scheduler",
        projectId: project.id,
        processedCount: issues.length,
      });

      this.log(`[${project.id}] 처리 대상 이슈 ${issues.length}건 발견`);

      const concurrency = this.config.schedulers.concurrency;
      const batch = issues.slice(0, concurrency);

      for (const issue of batch) {
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

    // 락 획득 (Claude 작업 TTL: 30분)
    const locked = acquireLock(projectId, issueNumber, "plan-scheduler", true);
    if (!locked) {
      this.log(`[${projectId}] 이슈 #${issueNumber} 락 획득 실패, 스킵`);
      return;
    }

    const labels = this.config.labels;

    try {
      const record = getIssue(projectId, issueNumber);
      const retryCount = record?.retryCount ?? 0;

      // 현재 라벨 제거 후 "플랜중" 추가
      await github.removeLabel(issueNumber, labels.planRequest);
      await github.removeLabel(issueNumber, labels.planRevise);
      await github.addLabel(issueNumber, labels.planning);
      updateState(projectId, issueNumber, IssueState.PLANNING, { retryCount });

      await github.addComment(issueNumber, "플랜 작성을 시작합니다... :pencil:");

      // 대상 레포 클론 확인 & 최신 코드 pull
      const repoPath = project.github.repoPath;
      const baseBranch = project.github.baseBranch;
      this.ensureRepoCloned(project);
      try {
        execSync(`git -C "${repoPath}" fetch origin`, {
          stdio: "pipe",
          timeout: 60_000,
        });
        execSync(`git -C "${repoPath}" checkout ${baseBranch}`, {
          stdio: "pipe",
          timeout: 15_000,
        });
        execSync(`git -C "${repoPath}" pull origin ${baseBranch}`, {
          stdio: "pipe",
          timeout: 30_000,
        });
        this.log(`[${projectId}] git pull origin ${baseBranch} 완료`);
      } catch (gitErr) {
        this.logError(`[${projectId}] git pull 실패 (로컬 코드로 계속 진행)`, gitErr);
      }

      // 이슈 본문 사니타이징
      const rawBody = `# ${issue.title}\n\n${issue.body}`;
      const sanitized = this.config.security.sanitizeInput
        ? sanitizeIssueBody(rawBody)
        : rawBody;

      // OMC ralplan 실행 (cwd = 대상 레포)
      const omc = new OmcClient({
        cwd: repoPath,
        allowedTools: this.config.omc.allowedTools,
        disallowedTools: this.config.omc.disallowedTools,
        allowedPaths: this.config.omc.allowedPaths,
        timeoutMs: this.config.omc.timeoutMs,
        permissionMode: this.config.omc.permissionMode,
      });

      this.log(`[${projectId}] 이슈 #${issueNumber} ralplan 실행 중...`);
      const result = await omc.createPlan(sanitized);

      if (!result.success) {
        throw new Error(result.error ?? "ralplan 실패");
      }

      // 플랜 마커 추출 또는 감싸기
      const planContent = this.extractOrWrapPlan(result.output);

      // 플랜 코멘트 등록
      await github.addComment(issueNumber, planContent);

      // 라벨: "플랜중" → "플랜 완료"
      await github.removeLabel(issueNumber, labels.planning);
      await github.addLabel(issueNumber, labels.planDone);
      updateState(projectId, issueNumber, IssueState.PLAN_DONE, {
        planContent,
        retryCount: 0,
        errorLog: undefined,
      });

      eventBus.emit("dashboard", {
        id: 0,
        ts: new Date().toISOString(),
        type: "state_change",
        projectId,
        issueNumber,
        from: IssueState.PLANNING,
        to: IssueState.PLAN_DONE,
      });

      await github.addComment(
        issueNumber,
        [
          "플랜 작성 완료. :white_check_mark:",
          "",
          "검토 후 **'개발 진행'** 라벨을 달아주세요.",
          "수정이 필요하면 **'플랜 수정'** 라벨을 달고 수정 요청 코멘트를 남겨주세요.",
        ].join("\n")
      );

      this.log(`[${projectId}] 이슈 #${issueNumber} 플랜 완료`);
    } catch (err) {
      await this.handleFailure(projectId, github, issueNumber, err);
    } finally {
      releaseLock(projectId, issueNumber);
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
      scheduler: "plan-scheduler",
      projectId,
      issueNumber,
      message: errMsg,
    });

    if (retryCount < this.retryPolicy.maxRetries) {
      // 재시도: "이슈 플랜"으로 롤백
      await github.removeLabel(issueNumber, labels.planning);
      await github.addLabel(issueNumber, labels.planRequest);
      updateState(projectId, issueNumber, IssueState.IDLE, { retryCount, errorLog: errMsg });

      const delayMs = this.getRetryDelay(retryCount - 1);
      await github.addComment(
        issueNumber,
        `플랜 작성 중 오류가 발생했습니다. ${Math.ceil(delayMs / 1000)}초 후 재시도합니다. (${retryCount}/${this.retryPolicy.maxRetries})\n\`\`\`\n${errMsg}\n\`\`\``
      );
    } else {
      // 재시도 초과: "개발 실패"
      await github.removeLabel(issueNumber, labels.planning);
      await github.addLabel(issueNumber, labels.devFailed);
      updateState(projectId, issueNumber, IssueState.DEV_FAILED, { retryCount, errorLog: errMsg });

      await github.addComment(
        issueNumber,
        `플랜 작성이 ${this.retryPolicy.maxRetries}회 모두 실패했습니다. 수동 개입이 필요합니다.\n\`\`\`\n${errMsg}\n\`\`\``
      );
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

  private extractOrWrapPlan(output: string): string {
    const startIdx = output.indexOf(PLAN_START_MARKER);
    const endIdx = output.indexOf(PLAN_END_MARKER);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return output.slice(startIdx, endIdx + PLAN_END_MARKER.length);
    }

    return `${PLAN_START_MARKER}\n${output.trim()}\n${PLAN_END_MARKER}`;
  }
}
