import { Router } from "express";
import type { Request, Response } from "express";
import { eventBus } from "../event-bus.js";
import type { DashboardEvent } from "../../state/types.js";

const MAX_CONNECTIONS = 20;
let activeConnections = 0;

export function createEventsRouter(): Router {
  const router = Router();

  // GET /api/events
  router.get("/events", (req: Request, res: Response) => {
    if (activeConnections >= MAX_CONNECTIONS) {
      res.status(503).json({ error: "최대 연결 수 초과" });
      return;
    }

    const projectIdFilter = req.query.projectId as string | undefined;

    // Last-Event-Id 헤더로 재연결 시 누락 이벤트 재전송
    const lastEventIdRaw = req.headers["last-event-id"] ?? req.query.lastEventId;
    const sinceId = lastEventIdRaw ? parseInt(String(lastEventIdRaw), 10) : undefined;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    activeConnections++;

    const sendEvent = (event: DashboardEvent): void => {
      // projectId 필터 적용
      if (projectIdFilter && "projectId" in event && event.projectId !== projectIdFilter) {
        return;
      }
      res.write(`id: ${event.id}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 재연결 시 누락 이벤트 전송
    const recent = eventBus.getRecent(sinceId);
    for (const evt of recent) {
      sendEvent(evt);
    }

    // 30초 heartbeat
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30_000);

    eventBus.subscribe(sendEvent);

    req.on("close", () => {
      clearInterval(heartbeat);
      eventBus.unsubscribe(sendEvent);
      activeConnections--;
    });
  });

  return router;
}
