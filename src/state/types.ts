export interface IssueLock {
  issueNumber: number;
  lockedBy: "plan-scheduler" | "dev-scheduler" | "merge-scheduler";
  lockedAt: string; // ISO timestamp
  ttlMs: number;    // 기본 600,000ms (10분), Claude 작업은 1,800,000ms (30분)
}

export interface RetryPolicy {
  maxRetries: number;        // 기본 3회
  retryDelayMs: number;      // 기본 60,000ms (1분)
  backoffMultiplier: number; // 기본 2 (지수 백오프)
}

export enum IssueState {
  IDLE        = "이슈 플랜",
  PLANNING    = "플랜중",
  PLAN_DONE   = "플랜 완료",
  PLAN_REVISE = "플랜 수정",
  DEVELOPING  = "개발 진행",
  DEV_FAILED  = "개발 실패",
  DONE        = "완료",
}

export interface IssueRecord {
  issueNumber: number;
  currentState: IssueState;
  prNumber?: number;
  branchName?: string;
  jiraTicket?: string;
  planContent?: string;
  retryCount: number;
  errorLog?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface GitHubLabelsConfig {
  planRequest: string;
  planning: string;
  planDone: string;
  planRevise: string;
  developing: string;
  devFailed: string;
  done: string;
}

export interface ProjectGitHubConfig {
  owner: string;
  repo: string;
  baseBranch: string;
  repoPath: string; // 대상 레포 로컬 클론 경로
}

export interface ProjectConfig {
  id: string;
  github: ProjectGitHubConfig;
}

export interface JiraConfig {
  enabled: boolean;
  host: string;
  projectKey: string;
  issueType: string;
}

export interface SchedulersConfig {
  planPollIntervalSec: number;
  devPollIntervalSec: number;
  mergePollIntervalSec: number;
  concurrency: number;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
}

export interface OmcSkillsConfig {
  plan: string;
  execute: string;
  buildFix: string;
}

export interface OmcConfig {
  enabled: boolean;
  timeoutMs: number;
  permissionMode: "acceptEdits" | "default";
  allowedTools: string[];
  disallowedTools: string[];
  allowedPaths: string[];
  skills: OmcSkillsConfig;
  fallbackIfOmcMissing: boolean;
}

export interface SecurityConfig {
  sanitizeInput: boolean;
  preScanEnabled: boolean;
  secretScanEnabled: boolean;
  blockedPatterns: string[];
}

export interface Config {
  projects: ProjectConfig[];
  labels: GitHubLabelsConfig;
  jira: JiraConfig;
  schedulers: SchedulersConfig;
  retry: RetryConfig;
  omc: OmcConfig;
  security: SecurityConfig;
  server?: ServerConfig;
}

export type SchedulerType = "plan-scheduler" | "dev-scheduler" | "merge-scheduler";

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: string; // ISO timestamp
}

// ── 대시보드 서버 설정 ──────────────────────────────────────────────
export interface ServerConfig {
  port: number;
  enabled: boolean;
}

// Config에 server 필드 추가를 위한 확장은 Config 인터페이스에 직접 반영

// ── 대시보드 이벤트 ────────────────────────────────────────────────
export interface DashboardEventBase {
  id: number; // monotonic ID
  ts: string; // ISO timestamp
}

export interface StateChangeEvent extends DashboardEventBase {
  type: "state_change";
  projectId: string;
  issueNumber: number;
  from: IssueState | null;
  to: IssueState;
}

export interface SchedulerTickEvent extends DashboardEventBase {
  type: "scheduler_tick";
  scheduler: SchedulerType;
  projectId: string;
  processedCount: number;
}

export interface PrCreatedEvent extends DashboardEventBase {
  type: "pr_created";
  projectId: string;
  issueNumber: number;
  prNumber: number;
  branchName: string;
}

export interface PrMergedEvent extends DashboardEventBase {
  type: "pr_merged";
  projectId: string;
  issueNumber: number;
  prNumber: number;
}

export interface ErrorEvent extends DashboardEventBase {
  type: "error";
  scheduler: SchedulerType;
  projectId: string;
  issueNumber?: number;
  message: string;
}

export type DashboardEvent =
  | StateChangeEvent
  | SchedulerTickEvent
  | PrCreatedEvent
  | PrMergedEvent
  | ErrorEvent;

// ── API 응답 타입 ──────────────────────────────────────────────────
export interface SchedulerStatus {
  name: SchedulerType;
  running: boolean;
  polling: boolean;
  basePollIntervalMs: number;
  currentPollIntervalMs: number;
  lastPollAt: string | null;
}

export interface StatusResponse {
  uptime: number; // seconds
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
