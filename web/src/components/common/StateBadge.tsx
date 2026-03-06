import type { IssueState } from "../../api/types";

const STATE_STYLES: Record<IssueState, string> = {
  "이슈 플랜": "bg-blue-400/20 text-blue-400 border-blue-400/30",
  "플랜중": "bg-yellow-400/20 text-yellow-400 border-yellow-400/30",
  "플랜 완료": "bg-emerald-400/20 text-emerald-400 border-emerald-400/30",
  "플랜 수정": "bg-orange-400/20 text-orange-400 border-orange-400/30",
  "개발 진행": "bg-violet-400/20 text-violet-400 border-violet-400/30",
  "개발 실패": "bg-red-400/20 text-red-400 border-red-400/30",
  "완료": "bg-green-400/20 text-green-400 border-green-400/30",
};

const PULSE_STATES: IssueState[] = ["플랜중", "개발 진행"];

interface StateBadgeProps {
  state: string;
  className?: string;
}

export function StateBadge({ state, className = "" }: StateBadgeProps) {
  const style = STATE_STYLES[state as IssueState] ?? "bg-gray-400/20 text-gray-400 border-gray-400/30";
  const pulse = PULSE_STATES.includes(state as IssueState);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${style} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {state}
    </span>
  );
}
