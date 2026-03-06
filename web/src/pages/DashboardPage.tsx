import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import { MainLayout } from "../components/layout/MainLayout";
import { StatsSummary } from "../components/dashboard/StatsSummary";
import { SchedulerStatusCard } from "../components/dashboard/SchedulerStatusCard";
import { PipelineFlow } from "../components/dashboard/PipelineFlow";
import { RecentActivityFeed } from "../components/dashboard/RecentActivityFeed";
import { api } from "../api/client";
import type { DashboardEvent } from "../api/types";

export function DashboardPage() {
  const { data: status, loading: statusLoading } = useApi(api.getStatus);
  const { data: pipeline } = useApi(api.getPipeline);
  const { events, status: sseStatus } = useSSE("/api/events");

  return (
    <MainLayout
      title="대시보드"
      sseStatus={sseStatus}
      uptime={status?.uptime}
    >
      <div className="space-y-6">
        {/* Stats Summary */}
        <StatsSummary status={status} />

        {/* Scheduler Status */}
        {statusLoading ? (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-sm text-gray-600">
            로딩 중...
          </div>
        ) : status ? (
          <SchedulerStatusCard schedulers={status.schedulers} />
        ) : null}

        {/* Pipeline Flow */}
        <PipelineFlow pipeline={pipeline} />

        {/* Activity Feed */}
        <RecentActivityFeed events={events as DashboardEvent[]} />
      </div>
    </MainLayout>
  );
}
