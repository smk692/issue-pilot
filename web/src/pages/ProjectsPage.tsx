import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import { MainLayout } from "../components/layout/MainLayout";
import { ProjectCard } from "../components/project/ProjectCard";
import { api } from "../api/client";

export function ProjectsPage() {
  const { data: projects, loading, refetch } = useApi(api.getProjects);
  const { status: sseStatus } = useSSE("/api/events");

  const handleToggleEnabled = async (projectId: string, enabled: boolean) => {
    try {
      await api.setProjectEnabled(projectId, enabled);
      refetch();
    } catch (err) {
      console.error("프로젝트 토글 실패:", err);
    }
  };

  return (
    <MainLayout title="프로젝트" sseStatus={sseStatus}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {projects ? `${projects.length}개 프로젝트` : "로딩 중..."}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-800 border border-gray-700 rounded-xl p-5 h-32 animate-pulse"
              />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onToggleEnabled={handleToggleEnabled}
              />
            ))}
          </div>
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center">
            <p className="text-sm text-gray-500">등록된 프로젝트가 없습니다.</p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
