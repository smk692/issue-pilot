import { EventEmitter } from "events";
import type { DashboardEvent } from "../state/types.js";

const RING_BUFFER_MAX = 200;

class EventBus extends EventEmitter {
  private counter = 0;
  private buffer: DashboardEvent[] = [];

  emit(event: "dashboard", data: DashboardEvent): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "dashboard") {
      const data = args[0] as DashboardEvent;
      // monotonic ID 부여
      (data as any).id = ++this.counter;
      if (!data.ts) {
        (data as any).ts = new Date().toISOString();
      }
      // 링 버퍼에 저장
      this.buffer.push(data);
      if (this.buffer.length > RING_BUFFER_MAX) {
        this.buffer.shift();
      }
    }
    return super.emit(event, ...args);
  }

  subscribe(listener: (event: DashboardEvent) => void): void {
    this.on("dashboard", listener);
  }

  unsubscribe(listener: (event: DashboardEvent) => void): void {
    this.off("dashboard", listener);
  }

  /**
   * sinceId 이후의 이벤트 반환 (초기 로드 / 재연결용)
   */
  getRecent(sinceId?: number): DashboardEvent[] {
    if (sinceId == null) {
      return [...this.buffer];
    }
    return this.buffer.filter((e) => e.id > sinceId);
  }

  getLastId(): number {
    return this.counter;
  }
}

// 싱글턴 인스턴스
export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
