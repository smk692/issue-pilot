import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import { MainLayout } from "../components/layout/MainLayout";
import { IssueTable } from "../components/project/IssueTable";
import { StateBadge } from "../components/common/StateBadge";
import { api } from "../api/client";
import type { IssueState } from "../api/types";

const STATE_ORDER: IssueState[] = [
  "이슈 플랜",
  "플랜중",
  "플랜 완료",
  "플랜 수정",
  "개발 진행",
  "개발 실패",
  "완료",
];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, loading, error } = useApi(
    () => api.getProject(id!),
    { enabled: !!id }
  );
  const { status: sseStatus } = useSSE("/api/events");

  return (
    <MainLayout
      title={project ? `${project.owner}/${project.repo}` : "프로젝트 상세"}
      sseStatus={sseStatus}
    >
      <div className="space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <Link to="/projects" className="hover:text-gray-300 transition-colors">
            프로젝트
          </Link>
          <span>/</span>
          <span className="text-gray-300">{id}</span>
        </nav>

        {loading && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center text-sm text-gray-600">
            로딩 중...
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-400">
            오류: {error}
          </div>
        )}

        {project && (
          <>
            {/* Project Info */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-100">
                    {project.owner}/{project.repo}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">ID: {project.id}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-100">
                    {project.issues.length}
                  </div>
                  <div className="text-xs text-gray-500">전체 이슈</div>
                </div>
              </div>

              {/* State counts */}
              <div className="flex flex-wrap gap-2">
                {STATE_ORDER.filter(
                  (s) => (project.stateCounts[s] ?? 0) > 0
                ).map((s) => (
                  <div key={s} className="flex items-center gap-1">
                    <StateBadge state={s} />
                    <span className="text-xs text-gray-500">
                      {project.stateCounts[s]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Issue Table */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-4">이슈 목록</h3>
              <IssueTable issues={project.issues} />
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
