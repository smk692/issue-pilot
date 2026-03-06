import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Config } from "../state/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = join(projectRoot, "config.json");
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as Config;

  // server 기본값 주입
  parsed.server = parsed.server ?? { port: 3001, enabled: true };

  // 환경변수 주입
  if (process.env.GITHUB_TOKEN) {
    (parsed as any).githubToken = process.env.GITHUB_TOKEN;
  }
  if (process.env.JIRA_API_TOKEN) {
    (parsed as any).jiraApiToken = process.env.JIRA_API_TOKEN;
  }
  if (process.env.JIRA_USER_EMAIL) {
    (parsed as any).jiraUserEmail = process.env.JIRA_USER_EMAIL;
  }

  cachedConfig = parsed;
  return cachedConfig;
}

export function getProjectRoot(): string {
  return projectRoot;
}
