import type { StatusResponse } from "../../api/types";

interface StatCardProps {
  label: string;
  value: number;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-gray-400 mt-1">{label}</div>
    </div>
  );
}

interface StatsSummaryProps {
  status: StatusResponse | null;
}

export function StatsSummary({ status }: StatsSummaryProps) {
  const counts = status?.stateCounts ?? {};
  const total = status?.totalIssues ?? 0;

  const active =
    (counts["플랜중"] ?? 0) +
    (counts["플랜 완료"] ?? 0) +
    (counts["플랜 수정"] ?? 0) +
    (counts["개발 진행"] ?? 0);

  const done = counts["완료"] ?? 0;
  const failed = counts["개발 실패"] ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label="전체 이슈" value={total} color="text-gray-100" />
      <StatCard label="진행 중" value={active} color="text-violet-400" />
      <StatCard label="완료" value={done} color="text-green-400" />
      <StatCard label="실패" value={failed} color="text-red-400" />
    </div>
  );
}
