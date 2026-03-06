import { Card } from "../common/Card";
import { StatusDot } from "../common/StatusDot";
import type { SchedulerStatus } from "../../api/types";

const SCHEDULER_LABELS: Record<string, string> = {
  "plan-scheduler": "플랜 스케줄러",
  "dev-scheduler": "개발 스케줄러",
  "merge-scheduler": "머지 스케줄러",
};

function formatMs(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)}분`;
  if (ms >= 1000) return `${Math.round(ms / 1000)}초`;
  return `${ms}ms`;
}

function formatLastPoll(lastPollAt: string | null): string {
  if (!lastPollAt) return "없음";
  const diff = Math.floor((Date.now() - new Date(lastPollAt).getTime()) / 1000);
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  return `${Math.floor(diff / 3600)}시간 전`;
}

interface SchedulerStatusCardProps {
  schedulers: SchedulerStatus[];
}

export function SchedulerStatusCard({ schedulers }: SchedulerStatusCardProps) {
  return (
    <Card title="스케줄러 상태">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {schedulers.map((s) => (
          <div
            key={s.name}
            className="bg-gray-900 rounded-lg p-4 border border-gray-700 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-200">
                {SCHEDULER_LABELS[s.name] ?? s.name}
              </span>
              <StatusDot active={s.running} pulse={s.polling} />
            </div>

            <div className="space-y-1.5 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>상태</span>
                <span className={s.running ? "text-emerald-400" : "text-gray-500"}>
                  {s.running ? (s.polling ? "폴링 중" : "실행 중") : "중지"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>기본 간격</span>
                <span className="text-gray-300">{formatMs(s.basePollIntervalMs)}</span>
              </div>
              <div className="flex justify-between">
                <span>현재 간격</span>
                <span className={s.currentPollIntervalMs !== s.basePollIntervalMs ? "text-yellow-400" : "text-gray-300"}>
                  {formatMs(s.currentPollIntervalMs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>마지막 폴</span>
                <span className="text-gray-300">{formatLastPoll(s.lastPollAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
