import { useState } from "react";
import { StateBadge } from "../common/StateBadge";
import type { IssueRecord, IssueState } from "../../api/types";

const ALL_STATES: IssueState[] = [
  "이슈 플랜",
  "플랜중",
  "플랜 완료",
  "플랜 수정",
  "개발 진행",
  "개발 실패",
  "완료",
];

type SortKey = "issueNumber" | "currentState" | "updatedAt" | "retryCount";
type SortDir = "asc" | "desc";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface IssueTableProps {
  issues: IssueRecord[];
}

export function IssueTable({ issues }: IssueTableProps) {
  const [filterState, setFilterState] = useState<IssueState | "전체">("전체");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered =
    filterState === "전체"
      ? issues
      : issues.filter((i) => i.currentState === filterState);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "issueNumber") cmp = a.issueNumber - b.issueNumber;
    else if (sortKey === "currentState")
      cmp = a.currentState.localeCompare(b.currentState);
    else if (sortKey === "updatedAt")
      cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    else if (sortKey === "retryCount") cmp = a.retryCount - b.retryCount;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      <span className="text-violet-400">{sortDir === "asc" ? " ↑" : " ↓"}</span>
    ) : (
      <span className="text-gray-600"> ↕</span>
    );

  return (
    <div>
      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["전체", ...ALL_STATES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterState(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterState === s
                ? "bg-violet-500/30 text-violet-300 border border-violet-500/50"
                : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
            }`}
          >
            {s}
            {s !== "전체" && (
              <span className="ml-1 text-gray-500">
                {issues.filter((i) => i.currentState === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800/80 border-b border-gray-700">
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200"
                onClick={() => handleSort("issueNumber")}
              >
                이슈 #<SortIcon k="issueNumber" />
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200"
                onClick={() => handleSort("currentState")}
              >
                상태<SortIcon k="currentState" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                PR / 브랜치
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200"
                onClick={() => handleSort("retryCount")}
              >
                재시도<SortIcon k="retryCount" />
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200"
                onClick={() => handleSort("updatedAt")}
              >
                업데이트<SortIcon k="updatedAt" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-xs">
                  이슈 없음
                </td>
              </tr>
            ) : (
              sorted.map((issue) => (
                <tr
                  key={issue.issueNumber}
                  className="hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                    #{issue.issueNumber}
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge state={issue.currentState} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {issue.prNumber && (
                      <span className="mr-2 text-violet-400">PR #{issue.prNumber}</span>
                    )}
                    {issue.branchName && (
                      <span className="font-mono text-gray-500 truncate max-w-[180px] block">
                        {issue.branchName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {issue.retryCount > 0 ? (
                      <span className="text-orange-400">{issue.retryCount}회</span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDate(issue.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-600 mt-2 text-right">
        {sorted.length} / {issues.length}개 표시
      </p>
    </div>
  );
}
