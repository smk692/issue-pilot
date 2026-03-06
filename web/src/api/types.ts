export type IssueState =
  | "이슈 플랜"
  | "플랜중"
  | "플랜 완료"
  | "플랜 수정"
  | "개발 진행"
  | "개발 실패"
  | "완료";

export type SchedulerType =
  | "plan-scheduler"
  | "dev-scheduler"
  | "merge-scheduler";

export interface SchedulerStatus {
  name: SchedulerType;
  running: boolean;
  polling: boolean;
  basePollIntervalMs: number;
  currentPollIntervalMs: number;
  lastPollAt: string | null;
}

export interface StatusResponse {
  uptime: number;
  schedulers: SchedulerStatus[];
  totalIssues: number;
  stateCounts: Record<string, number>;
}

export interface PipelineIssue {
  projectId: string;
  issueNumber: number;
  currentState: IssueState;
  prNumber?: number;
  branchName?: string;
  updatedAt: string;
}

export interface PipelineResponse {
  byState: Record<string, PipelineIssue[]>;
}

export interface ProjectSummary {
  id: string;
  owner: string;
  repo: string;
  stateCounts: Record<string, number>;
  totalIssues: number;
  enabled: boolean;
}

export interface ActivityEntry {
  id: number;
  ts: string;
  type: string;
  projectId: string;
  issueNumber?: number;
  prNumber?: number;
  message: string;
}

export interface IssueRecord {
  issueNumber: number;
  currentState: IssueState;
  prNumber?: number;
  branchName?: string;
  jiraTicket?: string;
  retryCount: number;
  errorLog?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailResponse {
  id: string;
  owner: string;
  repo: string;
  baseBranch: string;
  issues: IssueRecord[];
  stateCounts: Record<string, number>;
}

// SSE Event types
export type DashboardEvent =
  | {
      id: number;
      type: "state_change";
      projectId: string;
      issueNumber: number;
      from: IssueState | null;
      to: IssueState;
      ts: string;
    }
  | {
      id: number;
      type: "scheduler_tick";
      scheduler: SchedulerType;
      projectId: string;
      processedCount: number;
      ts: string;
    }
  | {
      id: number;
      type: "pr_created";
      projectId: string;
      issueNumber: number;
      prNumber: number;
      branchName: string;
      ts: string;
    }
  | {
      id: number;
      type: "pr_merged";
      projectId: string;
      issueNumber: number;
      prNumber: number;
      ts: string;
    }
  | {
      id: number;
      type: "error";
      scheduler: SchedulerType;
      projectId: string;
      issueNumber?: number;
      message: string;
      ts: string;
    };
