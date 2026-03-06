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
  `);
}

function rowToRecord(row: any): IssueRecord {
  return {
    issueNumber: row.issue_number,
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
         (project_id, issue_number, current_state, pr_number, branch_name, jira_ticket,
          plan_content, retry_count, error_log, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, issue_number) DO UPDATE SET
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
      `SELECT rowid as id, updated_at as ts, current_state as type, project_id, issue_number, pr_number
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
    }[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    type: r.type,
    projectId: r.project_id,
    issueNumber: r.issue_number,
    prNumber: r.pr_number ?? undefined,
    message: `이슈 #${r.issue_number} 상태: ${r.type}`,
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
