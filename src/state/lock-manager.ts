import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "../config/config.js";
import type { SchedulerType } from "./types.js";

const DEFAULT_TTL_MS = 600_000;    // 10분
const CLAUDE_TTL_MS  = 1_800_000;  // 30분

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const dataDir = join(getProjectRoot(), "data");
  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      project_id   TEXT    NOT NULL,
      issue_number INTEGER NOT NULL,
      locked_by    TEXT    NOT NULL,
      locked_at    TEXT    NOT NULL,
      ttl_ms       INTEGER NOT NULL,
      PRIMARY KEY (project_id, issue_number)
    );
  `);

  return db;
}

/**
 * 이슈 락 획득을 시도한다.
 * @returns 락 획득 성공 시 true, 이미 유효한 락이 존재하면 false
 */
export function acquireLock(
  projectId: string,
  issueNumber: number,
  lockedBy: SchedulerType,
  isClaude = false
): boolean {
  const database = getDb();
  cleanExpiredLocks();

  const ttlMs = isClaude ? CLAUDE_TTL_MS : DEFAULT_TTL_MS;
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `INSERT INTO locks (project_id, issue_number, locked_by, locked_at, ttl_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, issueNumber, lockedBy, now, ttlMs);
    return true;
  } catch {
    // UNIQUE constraint 위반 → 이미 락이 존재
    return false;
  }
}

/**
 * 이슈 락을 해제한다.
 */
export function releaseLock(projectId: string, issueNumber: number): void {
  const database = getDb();
  database
    .prepare("DELETE FROM locks WHERE project_id = ? AND issue_number = ?")
    .run(projectId, issueNumber);
}

/**
 * 유효한 락이 존재하는지 확인한다 (만료 락은 무시).
 */
export function isLocked(projectId: string, issueNumber: number): boolean {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM locks WHERE project_id = ? AND issue_number = ?")
    .get(projectId, issueNumber) as { locked_at: string; ttl_ms: number } | undefined;

  if (!row) return false;

  const lockedAt = new Date(row.locked_at).getTime();
  const expired = Date.now() > lockedAt + row.ttl_ms;

  if (expired) {
    releaseLock(projectId, issueNumber);
    return false;
  }

  return true;
}

/**
 * TTL이 만료된 락을 일괄 삭제한다.
 */
export function cleanExpiredLocks(): void {
  const database = getDb();
  const rows = database
    .prepare("SELECT project_id, issue_number, locked_at, ttl_ms FROM locks")
    .all() as Array<{ project_id: string; issue_number: number; locked_at: string; ttl_ms: number }>;

  const now = Date.now();
  for (const row of rows) {
    const lockedAt = new Date(row.locked_at).getTime();
    if (now > lockedAt + row.ttl_ms) {
      database
        .prepare("DELETE FROM locks WHERE project_id = ? AND issue_number = ?")
        .run(row.project_id, row.issue_number);
    }
  }
}
