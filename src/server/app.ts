import express from "express";
import type { Express } from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { BaseScheduler } from "../schedulers/base-scheduler.js";
import { createApiRouter } from "./routes/api.js";
import { createEventsRouter } from "./routes/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardContext {
  schedulers: BaseScheduler[];
}

export function createApp(ctx: DashboardContext): Express {
  const app = express();

  // CORS - 개발 서버 허용
  app.use(
    cors({
      origin: ["http://localhost:5173", "http://localhost:3001"],
      methods: ["GET", "PUT"],
      credentials: false,
    })
  );

  app.use(express.json());

  // API 라우터
  app.use("/api", createApiRouter(ctx));
  app.use("/api", createEventsRouter());

  // 프로덕션: 정적 파일 서빙 + SPA fallback
  const webDistPath = join(__dirname, "..", "..", "web", "dist");
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(join(webDistPath, "index.html"));
    });
  }

  return app;
}
