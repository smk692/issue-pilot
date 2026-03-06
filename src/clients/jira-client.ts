import type { Config } from "../state/types.js";

export interface JiraTicket {
  key: string;       // e.g. "LODEV-123"
  id: string;
  self: string;
}

export class JiraClient {
  private host: string;
  private projectKey: string;
  private issueType: string;
  private auth: string;

  constructor(config: Config) {
    this.host = config.jira.host;
    this.projectKey = config.jira.projectKey;
    this.issueType = config.jira.issueType;

    const email = process.env.JIRA_USER_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!email || !token) {
      throw new Error("JIRA_USER_EMAIL 및 JIRA_API_TOKEN 환경변수가 필요합니다.");
    }
    this.auth = Buffer.from(`${email}:${token}`).toString("base64");
  }

  private get baseUrl(): string {
    return `https://${this.host}/rest/api/3`;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Basic ${this.auth}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options.headers as Record<string, string> ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API ${response.status}: ${body}`);
    }

    return response.json();
  }

  /**
   * Jira 티켓 생성
   */
  async createTicket(summary: string, description: string): Promise<JiraTicket> {
    const body = {
      fields: {
        project: { key: this.projectKey },
        summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        },
        issuetype: { name: this.issueType },
      },
    };

    const result = await this.request("/issue", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      key: result.key,
      id: result.id,
      self: result.self,
    };
  }

  /**
   * 티켓 상태를 "Done"으로 전이
   */
  async transitionToDone(ticketKey: string): Promise<void> {
    // 사용 가능한 전이 조회
    const transitions = await this.request(`/issue/${ticketKey}/transitions`);
    const doneTrans = transitions.transitions?.find(
      (t: any) => t.name.toLowerCase() === "done" || t.name === "완료"
    );

    if (!doneTrans) {
      console.warn(`[JiraClient] '${ticketKey}' Done 전이를 찾을 수 없습니다.`);
      return;
    }

    await this.request(`/issue/${ticketKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: doneTrans.id } }),
    });
  }
}
