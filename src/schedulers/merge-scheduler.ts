import { BaseScheduler } from "./base-scheduler.js";
import { GitHubClient } from "../clients/github-client.js";
import { JiraClient } from "../clients/jira-client.js";
import { releaseLock } from "../state/lock-manager.js";
import { updateState, getAllByState } from "../state/store.js";
import { IssueState } from "../state/types.js";
import type { Config } from "../state/types.js";
import { eventBus } from "../server/event-bus.js";

export class MergeScheduler extends BaseScheduler {
  private jira: JiraClient | null = null;

  constructor(config: Config) {
    super({
      name: "merge-scheduler",
      pollIntervalSec: config.schedulers.mergePollIntervalSec,
      config,
    });

    if (config.jira.enabled) {
      try {
        this.jira = new JiraClient(config);
      } catch {
        // Jira 없이 진행
      }
    }
  }

  protected async poll(): Promise<void> {
    const labels = this.config.labels;

    for (const project of this.config.projects) {
      if (!this.isProjectEnabled(project.id)) {
        continue;
      }

      const projectId = project.id;
      const github = new GitHubClient(project.github.owner, project.github.repo);

      const rateLimitInfo = github.getRateLimitInfo();
      this.adjustPollInterval(rateLimitInfo);

      // 상태 스토어에서 "개발 진행" 상태이면서 PR이 연결된 이슈 조회
      const developingIssues = getAllByState(projectId, IssueState.DEVELOPING);
      const issuesWithPR = developingIssues.filter((r) => r.prNumber != null);

      if (issuesWithPR.length === 0) continue;

      this.log(`[${projectId}] PR 머지 확인 대상 이슈 ${issuesWithPR.length}건`);

      for (const record of issuesWithPR) {
        const issueNumber = record.issueNumber;
        const prNumber = record.prNumber!;

        try {
          // getPullRequest로 PR 상태 확인
          const pr = await github.getPullRequest(prNumber);
          if (!pr.merged) continue;

          this.log(`[${projectId}] 이슈 #${issueNumber} PR #${prNumber} 머지 감지`);

          // 라벨: "개발 진행" → "완료"
          await github.removeLabel(issueNumber, labels.developing);
          await github.addLabel(issueNumber, labels.done);

          // 상태 업데이트
          updateState(projectId, issueNumber, IssueState.DONE);

          eventBus.emit("dashboard", {
            id: 0,
            ts: new Date().toISOString(),
            type: "state_change",
            projectId,
            issueNumber,
            from: IssueState.DEVELOPING,
            to: IssueState.DONE,
          });

          eventBus.emit("dashboard", {
            id: 0,
            ts: new Date().toISOString(),
            type: "pr_merged",
            projectId,
            issueNumber,
            prNumber,
          });

          // 완료 코멘트
          await github.addComment(
            issueNumber,
            `PR #${prNumber}이 머지되었습니다. 작업이 완료되었습니다! :tada:`
          );

          // Jira 티켓 Done 전이
          if (this.jira && record.jiraTicket) {
            try {
              await this.jira.transitionToDone(record.jiraTicket);
              this.log(`[${projectId}] Jira ${record.jiraTicket} → Done`);
            } catch (err) {
              this.logError(`[${projectId}] Jira ${record.jiraTicket} 전이 실패`, err);
            }
          }

          // 이슈 Close
          await github.closeIssue(issueNumber);

          // 잔여 락 해제
          releaseLock(projectId, issueNumber);

          this.log(`[${projectId}] 이슈 #${issueNumber} 완료 처리`);
        } catch (err) {
          this.logError(`[${projectId}] 이슈 #${issueNumber} 머지 확인 중 오류`, err);
          eventBus.emit("dashboard", {
            id: 0,
            ts: new Date().toISOString(),
            type: "error",
            scheduler: "merge-scheduler",
            projectId,
            issueNumber,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}
