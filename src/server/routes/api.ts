import { Router } from "express";
import type { Request, Response } from "express";
import { getConfig } from "../../config/config.js";
import {
  getGlobalStateCounts,
  getRecentActivity,
  getAllIssues,
  getProjectStateCounts,
  getProjectEnabledMap,
  setProjectEnabled,
} from "../../state/store.js";
import type { DashboardContext } from "../app.js";

export function createApiRouter(ctx: DashboardContext): Router {
  const router = Router();

  // GET /api/status
  router.get("/status", (_req: Request, res: Response) => {
    const stateCounts = getGlobalStateCounts();
    const totalIssues = Object.values(stateCounts).reduce((s, n) => s + n, 0);
    const uptimeSec = Math.floor(process.uptime());

    res.json({
      uptime: uptimeSec,
      schedulers: ctx.schedulers.map((s) => s.getStatus()),
      totalIssues,
      stateCounts,
    });
  });

  // GET /api/pipeline
  router.get("/pipeline", (_req: Request, res: Response) => {
    const config = getConfig();
    const byState: Record<string, unknown[]> = {};

    for (const project of config.projects) {
      const issues = getAllIssues(project.id);
      for (const issue of issues) {
        const state = issue.currentState;
        if (!byState[state]) byState[state] = [];
        byState[state].push({
          projectId: project.id,
          issueNumber: issue.issueNumber,
          currentState: issue.currentState,
          prNumber: issue.prNumber,
          branchName: issue.branchName,
          updatedAt: issue.updatedAt,
        });
      }
    }

    res.json({ byState });
  });

  // GET /api/projects
  router.get("/projects", (_req: Request, res: Response) => {
    const config = getConfig();
    const enabledMap = getProjectEnabledMap();
    const summaries = config.projects.map((p) => {
      const stateCounts = getProjectStateCounts(p.id);
      const totalIssues = Object.values(stateCounts).reduce((s, n) => s + n, 0);
      return {
        id: p.id,
        owner: p.github.owner,
        repo: p.github.repo,
        stateCounts,
        totalIssues,
        enabled: enabledMap[p.id] ?? true,
      };
    });
    res.json(summaries);
  });

  // PUT /api/projects/:projectId/enabled
  router.put("/projects/:projectId/enabled", (req: Request, res: Response) => {
    const projectId = req.params["projectId"] as string;
    const config = getConfig();
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return;
    }
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled 필드는 boolean이어야 합니다" });
      return;
    }
    setProjectEnabled(projectId, enabled);
    res.json({ projectId, enabled });
  });

  // GET /api/projects/:projectId
  router.get("/projects/:projectId", (req: Request, res: Response) => {
    const projectId = req.params["projectId"] as string;
    const config = getConfig();
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return;
    }
    const issues = getAllIssues(projectId);
    const stateCounts = getProjectStateCounts(projectId);
    res.json({
      id: project.id,
      owner: project.github.owner,
      repo: project.github.repo,
      baseBranch: project.github.baseBranch,
      issues,
      stateCounts,
    });
  });

  // GET /api/projects/:projectId/issues
  router.get("/projects/:projectId/issues", (req: Request, res: Response) => {
    const projectId = req.params["projectId"] as string;
    const stateFilter = req.query.state as string | undefined;

    let issues = getAllIssues(projectId);
    if (stateFilter) {
      issues = issues.filter((i) => i.currentState === stateFilter);
    }

    res.json(issues);
  });

  // GET /api/activity
  router.get("/activity", (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 200);
    const activity = getRecentActivity(limit);
    res.json(activity);
  });

  // GET /api/config
  router.get("/config", (_req: Request, res: Response) => {
    const config = getConfig();
    // 토큰 제외한 안전한 설정만 반환
    res.json({
      labels: config.labels,
      schedulers: config.schedulers,
      retry: config.retry,
    });
  });

  return router;
}
