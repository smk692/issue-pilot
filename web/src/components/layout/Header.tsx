import { StatusDot } from "../common/StatusDot";
import type { SSEStatus } from "../../hooks/useSSE";

interface HeaderProps {
  title: string;
  sseStatus: SSEStatus;
  uptime?: number;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const SSE_LABEL: Record<SSEStatus, string> = {
  connecting: "연결 중",
  connected: "실시간 연결",
  disconnected: "연결 끊김",
  error: "오류",
};

export function Header({ title, sseStatus, uptime }: HeaderProps) {
  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-base font-semibold text-gray-100">{title}</h1>

      <div className="flex items-center gap-5">
        {uptime !== undefined && (
          <span className="text-xs text-gray-500">
            가동시간:{" "}
            <span className="text-gray-400">{formatUptime(uptime)}</span>
          </span>
        )}

        <div className="flex items-center gap-2">
          <StatusDot
            active={sseStatus === "connected"}
            pulse={sseStatus === "connected"}
          />
          <span
            className={`text-xs ${
              sseStatus === "connected"
                ? "text-emerald-400"
                : sseStatus === "connecting"
                ? "text-yellow-400"
                : "text-red-400"
            }`}
          >
            {SSE_LABEL[sseStatus]}
          </span>
        </div>
      </div>
    </header>
  );
}
