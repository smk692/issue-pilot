import { Octokit } from "@octokit/rest";
import type { RateLimitInfo } from "../state/types.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private rateLimitInfo: RateLimitInfo = {
    remaining: 5000,
    limit: 5000,
    resetAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  // ETag 캐시 (조건부 요청용)
  private etagCache = new Map<string, string>();

  constructor(owner: string, repo: string) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN 환경변수가 설정되지 않았습니다.");

    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo  = repo;
  }

  // Rate Limit 헤더 파싱 & 갱신
  private updateRateLimit(headers: Record<string, string | undefined>): void {
    const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "");
    const limit     = parseInt(headers["x-ratelimit-limit"] ?? "");
    const reset     = parseInt(headers["x-ratelimit-reset"] ?? "");

    if (!isNaN(remaining)) this.rateLimitInfo.remaining = remaining;
    if (!isNaN(limit))     this.rateLimitInfo.limit     = limit;
    if (!isNaN(reset))     this.rateLimitInfo.resetAt   = new Date(reset * 1000).toISOString();
  }

  getRateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  /** Rate limit 잔여량에 따른 대기 처리 */
  async waitIfRateLimited(): Promise<void> {
    if (this.rateLimitInfo.remaining < 100) {
      const resetMs = new Date(this.rateLimitInfo.resetAt).getTime();
      const waitMs  = Math.max(resetMs - Date.now(), 0) + 1000;
      console.warn(`[GitHubClient] Rate limit 임박 (${this.rateLimitInfo.remaining} 남음). ${waitMs}ms 대기`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  /** 현재 폴링 주기 배율 반환 (500 미만이면 2배) */
  getPollMultiplier(): number {
    return this.rateLimitInfo.remaining < 500 ? 2 : 1;
  }

  async getIssuesByLabel(label: string): Promise<GitHubIssue[]> {
    await this.waitIfRateLimited();
    const cacheKey = `issues:label:${label}`;
    const etag = this.etagCache.get(cacheKey);

    try {
      const response = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo:  this.repo,
        labels: label,
        state: "open",
        per_page: 100,
        headers: etag ? { "If-None-Match": etag } : {},
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);
      if (response.headers.etag) this.etagCache.set(cacheKey, response.headers.etag);

      return (response.data as any[]).map(issue => ({
        number: issue.number,
        title:  issue.title,
        body:   issue.body ?? "",
        labels: (issue.labels as any[]).map((l: any) => l.name ?? "").filter(Boolean),
        state:  issue.state,
      }));
    } catch (err: any) {
      if (err.status === 304) return []; // 변경 없음
      throw err;
    }
  }

  async addLabel(issueNumber: number, label: string): Promise<void> {
    await this.waitIfRateLimited();
    const response = await this.octokit.issues.addLabels({
      owner: this.owner,
      repo:  this.repo,
      issue_number: issueNumber,
      labels: [label],
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.waitIfRateLimited();
    try {
      const response = await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo:  this.repo,
        issue_number: issueNumber,
        name: label,
      });
      this.updateRateLimit(response.headers as Record<string, string | undefined>);
    } catch (err: any) {
      if (err.status === 404) return; // 이미 없는 라벨
      throw err;
    }
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.waitIfRateLimited();
    const response = await this.octokit.issues.createComment({
      owner: this.owner,
      repo:  this.repo,
      issue_number: issueNumber,
      body,
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
  }

  async getComments(issueNumber: number): Promise<GitHubComment[]> {
    await this.waitIfRateLimited();
    const response = await this.octokit.issues.listComments({
      owner: this.owner,
      repo:  this.repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
    return (response.data as any[]).map(c => ({
      id:         c.id,
      body:       c.body,
      created_at: c.created_at,
    }));
  }

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<GitHubPR> {
    await this.waitIfRateLimited();
    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo:  this.repo,
      title,
      body,
      head,
      base,
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
    const pr = response.data as any;
    return {
      number:   pr.number,
      title:    pr.title,
      body:     pr.body,
      state:    pr.state,
      merged:   pr.merged ?? false,
      head:     { ref: pr.head.ref },
      base:     { ref: pr.base.ref },
      html_url: pr.html_url,
    };
  }

  async getPullRequest(prNumber: number): Promise<GitHubPR> {
    await this.waitIfRateLimited();
    const response = await this.octokit.pulls.get({
      owner: this.owner,
      repo:  this.repo,
      pull_number: prNumber,
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
    const pr = response.data as any;
    return {
      number:   pr.number,
      title:    pr.title,
      body:     pr.body,
      state:    pr.state,
      merged:   pr.merged ?? false,
      head:     { ref: pr.head.ref },
      base:     { ref: pr.base.ref },
      html_url: pr.html_url,
    };
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.waitIfRateLimited();
    const response = await this.octokit.issues.update({
      owner: this.owner,
      repo:  this.repo,
      issue_number: issueNumber,
      state: "closed",
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
  }

  // ── 스케줄러 호환 별칭 메서드 ─────────────────────────────────────────

  /** 여러 라벨 중 하나라도 달린 이슈 목록 조회 (OR 조건) */
  async listIssuesByLabels(labels: string[]): Promise<GitHubIssue[]> {
    const results = await Promise.all(labels.map(l => this.getIssuesByLabel(l)));
    // 중복 제거
    const seen = new Set<number>();
    const merged: GitHubIssue[] = [];
    for (const list of results) {
      for (const issue of list) {
        if (!seen.has(issue.number)) {
          seen.add(issue.number);
          merged.push(issue);
        }
      }
    }
    return merged;
  }

  /** 이슈의 라벨을 지정된 목록으로 교체 (기존 라벨 전체 제거 후 추가) */
  async setLabels(issueNumber: number, newLabels: string[]): Promise<void> {
    await this.waitIfRateLimited();
    const response = await this.octokit.issues.setLabels({
      owner: this.owner,
      repo:  this.repo,
      issue_number: issueNumber,
      labels: newLabels,
    });
    this.updateRateLimit(response.headers as Record<string, string | undefined>);
  }

  /** PR 생성 후 PR 번호만 반환 */
  async createPR(title: string, body: string, head: string, base: string): Promise<number> {
    const pr = await this.createPullRequest(title, body, head, base);
    return pr.number;
  }

  /** PR 머지 여부 확인 */
  async isPRMerged(prNumber: number): Promise<boolean> {
    const pr = await this.getPullRequest(prNumber);
    return pr.merged;
  }

  /** 이슈 코멘트 목록 조회 (body를 string으로 정규화) */
  async listComments(issueNumber: number): Promise<Array<{ id: number; body: string; created_at: string }>> {
    const comments = await this.getComments(issueNumber);
    return comments.map(c => ({ id: c.id, body: c.body ?? "", created_at: c.created_at }));
  }
}
