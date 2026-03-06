import { Card } from "../common/Card";
import { StateBadge } from "../common/StateBadge";
import type { DashboardEvent } from "../../api/types";

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ event }: { event: DashboardEvent }) {
  if (event.type === "state_change") {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-700/50 last:border-0 transition-all">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5 w-20">{formatTime(event.ts)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-300 font-medium">
              {event.projectId} #{event.issueNumber}
            </span>
            {event.from && <StateBadge state={event.from} />}
            <span className="text-gray-600">→</span>
            <StateBadge state={event.to} />
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "pr_created") {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5 w-20">{formatTime(event.ts)}</span>
        <div className="flex-1 min-w-0 text-xs text-gray-300">
          <span className="text-violet-400 font-medium">PR 생성</span>{" "}
          {event.projectId} #{event.issueNumber} → PR #{event.prNumber}
        </div>
      </div>
    );
  }

  if (event.type === "pr_merged") {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5 w-20">{formatTime(event.ts)}</span>
        <div className="flex-1 min-w-0 text-xs text-gray-300">
          <span className="text-green-400 font-medium">PR 머지</span>{" "}
          {event.projectId} #{event.issueNumber} PR #{event.prNumber}
        </div>
      </div>
    );
  }

  if (event.type === "scheduler_tick") {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5 w-20">{formatTime(event.ts)}</span>
        <div className="flex-1 min-w-0 text-xs text-gray-400">
          <span className="text-blue-400">{event.scheduler}</span>{" "}
          폴 완료 — {event.processedCount}개 처리
        </div>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5 w-20">{formatTime(event.ts)}</span>
        <div className="flex-1 min-w-0 text-xs">
          <span className="text-red-400 font-medium">오류</span>{" "}
          <span className="text-gray-400">{event.message}</span>
        </div>
      </div>
    );
  }

  return null;
}

interface RecentActivityFeedProps {
  events: DashboardEvent[];
}

export function RecentActivityFeed({ events }: RecentActivityFeedProps) {
  const recent = [...events].reverse().slice(0, 30);

  return (
    <Card
      title="실시간 활동"
      headerRight={
        <span className="text-xs text-gray-500">{events.length}개 이벤트</span>
      }
    >
      <div className="max-h-80 overflow-y-auto -mx-5 px-5">
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-600">
            이벤트를 기다리는 중...
          </div>
        ) : (
          recent.map((event) => <EventRow key={`${event.type}-${event.id}`} event={event} />)
        )}
      </div>
    </Card>
  );
}
