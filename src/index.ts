/**
 * Issue Pilot - 엔트리포인트
 *
 * 3개의 스케줄러를 시작하고 graceful shutdown을 처리한다.
 * Agent SDK 중첩 실행 방지를 위해 CLAUDECODE 환경변수를 제거한다.
 */
import "dotenv/config";

// Agent SDK 충돌 방지: Claude Code 세션 내부에서 호출 시 중첩 실행 차단 우회
delete (process.env as Record<string, string | undefined>).CLAUDECODE;

import { getConfig } from "./config/config.js";
import { PlanScheduler } from "./schedulers/plan-scheduler.js";
import { DevScheduler } from "./schedulers/dev-scheduler.js";
import { MergeScheduler } from "./schedulers/merge-scheduler.js";
import { createApp } from "./server/app.js";
import type { Server } from "http";

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] [Issue Pilot] 시작`);

  // 설정 로드
  const config = getConfig();

  // 스케줄러 초기화
  const planScheduler = new PlanScheduler(config);
  const devScheduler = new DevScheduler(config);
  const mergeScheduler = new MergeScheduler(config);

  // 스케줄러 시작
  planScheduler.start();
  devScheduler.start();
  mergeScheduler.start();

  console.log(`[${new Date().toISOString()}] [Issue Pilot] 모든 스케줄러 시작 완료`);
  console.log(`  - plan-scheduler:  ${config.schedulers.planPollIntervalSec}초 간격`);
  console.log(`  - dev-scheduler:   ${config.schedulers.devPollIntervalSec}초 간격`);
  console.log(`  - merge-scheduler: ${config.schedulers.mergePollIntervalSec}초 간격`);
  console.log(`  - 등록 프로젝트: ${config.projects.map(p => `${p.id} (${p.github.owner}/${p.github.repo})`).join(", ")}`);

  // Express 서버 시작
  let server: Server | null = null;
  const serverConfig = config.server ?? { port: 3001, enabled: true };
  if (serverConfig.enabled) {
    const app = createApp({
      schedulers: [planScheduler, devScheduler, mergeScheduler],
    });
    server = app.listen(serverConfig.port, () => {
      console.log(`[${new Date().toISOString()}] [Issue Pilot] 대시보드 서버 시작: http://localhost:${serverConfig.port}`);
    });
  }

  // Graceful shutdown 처리
  const shutdown = (signal: string): void => {
    console.log(`\n[${new Date().toISOString()}] [Issue Pilot] ${signal} 수신, 종료 중...`);

    planScheduler.stop();
    devScheduler.stop();
    mergeScheduler.stop();

    if (server) {
      server.close(() => {
        console.log(`[${new Date().toISOString()}] [Issue Pilot] 대시보드 서버 종료 완료.`);
      });
    }

    console.log(`[${new Date().toISOString()}] [Issue Pilot] 모든 스케줄러 중지 완료. 종료.`);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // 프로세스가 종료되지 않도록 유지
  // (스케줄러 타이머가 이벤트 루프를 붙잡고 있으므로 별도 대기 불필요)
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] [Issue Pilot] 치명적 오류:`, err);
  process.exit(1);
});
