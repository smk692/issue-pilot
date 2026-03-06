import { Link } from "react-router-dom";
import { StateBadge } from "../common/StateBadge";
import type { ProjectSummary, IssueState } from "../../api/types";

const STATE_ORDER: IssueState[] = [
  "이슈 플랜",
  "플랜중",
  "플랜 완료",
  "플랜 수정",
  "개발 진행",
  "개발 실패",
  "완료",
];

interface ProjectCardProps {
  project: ProjectSummary;
  onToggleEnabled: (projectId: string, enabled: boolean) => void;
}

export function ProjectCard({ project, onToggleEnabled }: ProjectCardProps) {
  const nonZeroStates = STATE_ORDER.filter(
    (s) => (project.stateCounts[s] ?? 0) > 0
  );

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleEnabled(project.id, !project.enabled);
  };

  return (
    <Link
      to={`/projects/${project.id}`}
      className={`block bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-gray-600 hover:bg-gray-750 transition-colors group ${
        !project.enabled ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-100 group-hover:text-white transition-colors">
              {project.owner}/{project.repo}
            </h3>
            {!project.enabled && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-900/50 text-yellow-400 rounded">
                일시정지
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{project.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              project.enabled ? "bg-green-600" : "bg-gray-600"
            }`}
            title={project.enabled ? "스케줄러 활성" : "스케줄러 비활성"}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                project.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <div className="text-right">
            <div className="text-xl font-bold text-gray-100">{project.totalIssues}</div>
            <div className="text-xs text-gray-500">이슈</div>
          </div>
        </div>
      </div>

      {nonZeroStates.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {nonZeroStates.map((state) => (
            <div key={state} className="flex items-center gap-1">
              <StateBadge state={state} />
              <span className="text-xs text-gray-500">{project.stateCounts[state]}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600">이슈 없음</p>
      )}
    </Link>
  );
}
