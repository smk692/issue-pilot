import type {
  StatusResponse,
  PipelineResponse,
  ProjectSummary,
  ActivityEntry,
  ProjectDetailResponse,
} from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () => get<StatusResponse>("/status"),
  getPipeline: () => get<PipelineResponse>("/pipeline"),
  getProjects: () => get<ProjectSummary[]>("/projects"),
  getProject: (id: string) => get<ProjectDetailResponse>(`/projects/${id}`),
  getActivity: (limit = 50) =>
    get<ActivityEntry[]>(`/activity?limit=${limit}`),
  setProjectEnabled: (id: string, enabled: boolean) =>
    put<{ projectId: string; enabled: boolean }>(`/projects/${id}/enabled`, { enabled }),
};
