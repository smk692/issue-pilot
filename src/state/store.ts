import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "../config/config.js";
import type { IssueRecord, ActivityEntry } from "./types.js";
import { IssueState } from "./types.js";

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const dataDir = join(getProjectRoot(), "data");
  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      project_id    TEXT    NOT NULL,
      issue_number  INTEGER NOT NULL,
      current_state TEXT    NOT NULL,
      pr_number     INTEGER,
      branch_name   TEXT,
      jira_ticket   TEXT,
      plan_content  TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      error_log     TEXT,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL,
      PRIMARY KEY (project_id, issue_number)
    );

    CREATE TABLE IF NOT EXISTS issue_pr_map (
      project_id   TEXT    NOT NULL,
      issue_number INTEGER NOT NULL,
      pr_number    INTEGER NOT NULL,
      created_at   TEXT    NOT NULL,
      PRIMARY KEY (project_id, issue_number)
    );

    CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS healing_attempts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT    NOT NULL,
      issue_number  INTEGER NOT NULL,
      error_type    TEXT    NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      max_attempts  INTEGER NOT NULL DEFAULT 2,
      strategy      TEXT    NOT NULL,
      success       INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at    TEXT    NOT NULL,
      FOREIGN KEY (project_id, issue_number) REFERENCES issues(project_id, issue_number)
    );

    CREATE TABLE IF NOT EXISTS error_analyses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT    NOT NULL,
      issue_number  INTEGER NOT NULL,
      error_type    TEXT    NOT NULL,
      root_cause    TEXT    NOT NULL,
      suggested_fix TEXT    NOT NULL,
      confidence    REAL    NOT NULL DEFAULT 0.5,
      created_at    TEXT    NOT NULL,
      FOREIGN KEY (project_id, issue_number) REFERENCES issues(project_id, issue_number)
    );
  `);

  // 기존 테이블 마이그레이션 (컬럼 추가)
  migrateSchema(database);
}

function migrateSchema(database: Database.Database): void {
  // issues 테이블에 last_error_type 컬럼 추가 시도
  try {
    database.exec(`
      ALTER TABLE issues ADD COLUMN last_error_type TEXT;
    `);
  } catch {
    // 이미 컬럼이 존재하면 무시
  }

  // issues 테이블에 healing_attempts_count 컬럼 추가 시도
  try {
    database.exec(`
      ALTER TABLE issues ADD COLUMN healing_attempts_count INTEGER DEFAULT 0;
    `);
  } catch {
    // 이미 컬럼이 존재하면 무시
  }

  // issues 테이블에 title 컬럼 추가 시도
  try {
    database.exec(`ALTER TABLE issues ADD COLUMN title TEXT;`);
  } catch {
    // 이미 컬럼이 존재하면 무시
  }
}

function rowToRecord(row: any): IssueRecord {
  return {
    issueNumber: row.issue_number,
    title: row.title ?? undefined,
    currentState: row.current_state as IssueState,
    prNumber: row.pr_number ?? undefined,
    branchName: row.branch_name ?? undefined,
    jiraTicket: row.jira_ticket ?? undefined,
    planContent: row.plan_content ?? undefined,
    retryCount: row.retry_count,
    errorLog: row.error_log ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getIssue(projectId: string, issueNumber: number): IssueRecord | undefined {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM issues WHERE project_id = ? AND issue_number = ?")
    .get(projectId, issueNumber);
  return row ? rowToRecord(row) : undefined;
}

export function upsertIssue(projectId: string, record: IssueRecord): void {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO issues
         (project_id, issue_number, title, current_state, pr_number, branch_name, jira_ticket,
          plan_content, retry_count, error_log, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, issue_number) DO UPDATE SET
         title         = COALESCE(excluded.title, issues.title),
         current_state = excluded.current_state,
         pr_number     = excluded.pr_number,
         branch_name   = excluded.branch_name,
         jira_ticket   = excluded.jira_ticket,
         plan_content  = excluded.plan_content,
         retry_count   = excluded.retry_count,
         error_log     = excluded.error_log,
         updated_at    = excluded.updated_at`
    )
    .run(
      projectId,
      record.issueNumber,
      record.title ?? null,
      record.currentState,
      record.prNumber ?? null,
      record.branchName ?? null,
      record.jiraTicket ?? null,
      record.planContent ?? null,
      record.retryCount,
      record.errorLog ?? null,
      record.createdAt ?? now,
      now
    );
}

export function updateState(
  projectId: string,
  issueNumber: number,
  newState: IssueState,
  extra?: Partial<Omit<IssueRecord, "issueNumber" | "currentState" | "createdAt" | "updatedAt">>
): void {
  const now = new Date().toISOString();

  const existing = getIssue(projectId, issueNumber);
  if (!existing) {
    upsertIssue(projectId, {
      issueNumber,
      currentState: newState,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return;
  }

  upsertIssue(projectId, {
    ...existing,
    ...extra,
    issueNumber,
    currentState: newState,
    updatedAt: now,
  });
}

export function getAllByState(projectId: string, state: IssueState): IssueRecord[] {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM issues WHERE project_id = ? AND current_state = ?")
    .all(projectId, state);
  return rows.map(rowToRecord);
}

export function getIssuePrMap(projectId: string, issueNumber: number): number | undefined {
  const database = getDb();
  const row = database
    .prepare("SELECT pr_number FROM issue_pr_map WHERE project_id = ? AND issue_number = ?")
    .get(projectId, issueNumber) as { pr_number: number } | undefined;
  return row?.pr_number;
}

export function setIssuePrMap(projectId: string, issueNumber: number, prNumber: number): void {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO issue_pr_map (project_id, issue_number, pr_number, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, issue_number) DO UPDATE SET pr_number = excluded.pr_number`
    )
    .run(projectId, issueNumber, prNumber, now);
}

// ── 프로젝트 설정 쿼리 ──────────────────────────────────────────────

/**
 * 프로젝트의 활성화 여부를 반환한다. 레코드가 없으면 기본 true.
 */
export function isProjectEnabled(projectId: string): boolean {
  const database = getDb();
  const row = database
    .prepare("SELECT enabled FROM project_settings WHERE project_id = ?")
    .get(projectId) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

/**
 * 전체 프로젝트의 on/off 맵을 반환한다.
 */
export function getProjectEnabledMap(): Record<string, boolean> {
  const database = getDb();
  const rows = database
    .prepare("SELECT project_id, enabled FROM project_settings")
    .all() as { project_id: string; enabled: number }[];
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.project_id] = row.enabled === 1;
  }
  return result;
}

/**
 * 프로젝트의 활성화 여부를 설정한다 (UPSERT).
 */
export function setProjectEnabled(projectId: string, enabled: boolean): void {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO project_settings (project_id, enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    )
    .run(projectId, enabled ? 1 : 0, now);
}

// ── 대시보드용 쿼리 함수 ───────────────────────────────────────────

/**
 * 전체 프로젝트에 걸쳐 상태별 이슈 수를 반환한다.
 */
export function getGlobalStateCounts(): Record<string, number> {
  const database = getDb();
  const rows = database
    .prepare("SELECT current_state, COUNT(*) as cnt FROM issues GROUP BY current_state")
    .all() as { current_state: string; cnt: number }[];
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.current_state] = row.cnt;
  }
  return result;
}

/**
 * 최근 활동 엔트리를 반환한다 (updated_at 내림차순).
 */
export function getRecentActivity(limit: number = 50): ActivityEntry[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT rowid as id, updated_at as ts, current_state as type, project_id, issue_number, pr_number, title
       FROM issues
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as {
      id: number;
      ts: string;
      type: string;
      project_id: string;
      issue_number: number;
      pr_number: number | null;
      title: string | null;
    }[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    type: r.type,
    projectId: r.project_id,
    issueNumber: r.issue_number,
    prNumber: r.pr_number ?? undefined,
    title: r.title ?? undefined,
    message: r.title
      ? `이슈 #${r.issue_number} ${r.title} — 상태: ${r.type}`
      : `이슈 #${r.issue_number} 상태: ${r.type}`,
  }));
}

/**
 * 특정 프로젝트의 모든 이슈를 반환한다.
 */
export function getAllIssues(projectId: string): IssueRecord[] {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM issues WHERE project_id = ? ORDER BY updated_at DESC")
    .all(projectId);
  return rows.map(rowToRecord);
}

/**
 * 특정 프로젝트의 상태별 이슈 수를 반환한다.
 */
export function getProjectStateCounts(projectId: string): Record<string, number> {
  const database = getDb();
  const rows = database
    .prepare(
      "SELECT current_state, COUNT(*) as cnt FROM issues WHERE project_id = ? GROUP BY current_state"
    )
    .all(projectId) as { current_state: string; cnt: number }[];
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.current_state] = row.cnt;
  }
  return result;
}

// ── Self-Healing 관련 쿼리 함수 ────────────────────────────────────

/**
 * 특정 이슈의 에러 타입별 healing 시도 횟수를 반환한다.
 */
export function getHealingAttemptCount(
  projectId: string,
  issueNumber: number,
  errorType: string
): number {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT COUNT(*) as cnt FROM healing_attempts
       WHERE project_id = ? AND issue_number = ? AND error_type = ?`
    )
    .get(projectId, issueNumber, errorType) as { cnt: number };
  return row?.cnt ?? 0;
}

/**
 * Healing 시도를 기록한다.
 */
export function recordHealingAttempt(
  projectId: string,
  issueNumber: number,
  errorType: string,
  strategy: string,
  success: boolean,
  errorMessage?: string
): void {
  const database = getDb();
  const now = new Date().toISOString();
  const attemptCount = getHealingAttemptCount(projectId, issueNumber, errorType) + 1;

  database
    .prepare(
      `INSERT INTO healing_attempts
         (project_id, issue_number, error_type, attempt_count, strategy, success, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      issueNumber,
      errorType,
      attemptCount,
      strategy,
      success ? 1 : 0,
      errorMessage ?? null,
      now
    );
}

/**
 * 특정 이슈의 healing 시도 기록을 초기화한다 (dev-scheduler 재시도 시 호출).
 */
export function resetHealingAttempts(
  projectId: string,
  issueNumber: number
): void {
  const database = getDb();
  database
    .prepare(
      `DELETE FROM healing_attempts WHERE project_id = ? AND issue_number = ?`
    )
    .run(projectId, issueNumber);
}

/**
 * 특정 이슈의 모든 healing 시도를 반환한다.
 */
export function getHealingAttempts(
  projectId: string,
  issueNumber: number
): Array<{
  errorType: string;
  attemptCount: number;
  strategy: string;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}> {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT error_type, attempt_count, strategy, success, error_message, created_at
       FROM healing_attempts
       WHERE project_id = ? AND issue_number = ?
       ORDER BY created_at DESC`
    )
    .all(projectId, issueNumber) as Array<{
      error_type: string;
      attempt_count: number;
      strategy: string;
      success: number;
      error_message: string | null;
      created_at: string;
    }>;

  return rows.map((r) => ({
    errorType: r.error_type,
    attemptCount: r.attempt_count,
    strategy: r.strategy,
    success: r.success === 1,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
  }));
}

/**
 * 전체 healing 시도 이력을 반환한다 (대시보드용).
 */
export function getAllHealingAttempts(): Array<{
  id: number;
  projectId: string;
  issueNumber: number;
  errorType: string;
  attemptCount: number;
  maxAttempts: number;
  strategy: string;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}> {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT id, project_id, issue_number, error_type, attempt_count, max_attempts,
              strategy, success, error_message, created_at
       FROM healing_attempts
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all() as Array<{
      id: number;
      project_id: string;
      issue_number: number;
      error_type: string;
      attempt_count: number;
      max_attempts: number;
      strategy: string;
      success: number;
      error_message: string | null;
      created_at: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    issueNumber: r.issue_number,
    errorType: r.error_type,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    strategy: r.strategy,
    success: r.success === 1,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
  }));
}

// ── AI Error Analysis 관련 쿼리 함수 ───────────────────────────────

/**
 * 에러 분석 결과를 저장한다.
 */
export function saveErrorAnalysis(
  projectId: string,
  issueNumber: number,
  errorType: string,
  rootCause: string,
  suggestedFix: string,
  confidence: number
): void {
  const database = getDb();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO error_analyses
         (project_id, issue_number, error_type, root_cause, suggested_fix, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, issueNumber, errorType, rootCause, suggestedFix, confidence, now);
}

/**
 * 특정 이슈의 최신 에러 분석 결과를 반환한다.
 */
export function getLatestErrorAnalysis(
  projectId: string,
  issueNumber: number
): {
  errorType: string;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  createdAt: string;
} | undefined {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT error_type, root_cause, suggested_fix, confidence, created_at
       FROM error_analyses
       WHERE project_id = ? AND issue_number = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(projectId, issueNumber) as {
      error_type: string;
      root_cause: string;
      suggested_fix: string;
      confidence: number;
      created_at: string;
    } | undefined;

  if (!row) return undefined;

  return {
    errorType: row.error_type,
    rootCause: row.root_cause,
    suggestedFix: row.suggested_fix,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}
