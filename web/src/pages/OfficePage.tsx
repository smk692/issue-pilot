import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSSEContext } from "../contexts/SSEContext";
import { useApi } from "../hooks/useApi";
import { useToast } from "../hooks/useToast";
import { api } from "../api/client";
import type { ActiveAgent, ProjectSummary, ActivityEntry, IssueRecord, DashboardEvent, PipelineResponse } from "../api/types";
import type { HealingHistoryEntry } from "../api/client";
import { MainLayout } from "../components/layout/MainLayout";
import { OfficeRoom } from "../components/office/OfficeRoom";
import { AgentLogPanel } from "../components/office/AgentLogPanel";
import { DeptStatus } from "../components/office/DeptStatus";
import { MiniPipeline } from "../components/office/MiniPipeline";
import { ToastContainer } from "../components/common/ToastContainer";
import { AgentHistoryPanel } from "../components/office/AgentHistoryPanel";
import { AgentPerformanceSummary } from "../components/office/AgentPerformanceSummary";
import { CreateIssueModal } from "../components/office/CreateIssueModal";
import type { ChatMessage } from "../components/office/AgentChatRoom";

const MAX_CHAT_MESSAGES = 20;

export function OfficePage() {
  const navigate = useNavigate();
  const { events, status, subscribe } = useSSEContext();
  const { data: projects } = useApi<ProjectSummary[]>(api.getProjects, { pollInterval: 10000 });
  const { data: agents } = useApi<ActiveAgent[]>(api.getActiveAgents, { pollInterval: 5000 });
  const { data: statusData } = useApi(api.getStatus);
  const { data: activity } = useApi<ActivityEntry[]>(() => api.getActivity(50), { pollInterval: 30000 });
  const { data: pipelineData } = useApi<PipelineResponse>(api.getPipeline, { pollInterval: 15000 });
  const { data: healingHistory } = useApi<HealingHistoryEntry[]>(api.getHealingHistory, { pollInterval: 60000 });

  const [selectedAgent, setSelectedAgent] = useState<ActiveAgent | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [roomIssues, setRoomIssues] = useState<Map<string, IssueRecord[]>>(new Map());
  const [expandedChatRoomId, setExpandedChatRoomId] = useState<string | null>(null);
  const [confettiProjectId, setConfettiProjectId] = useState<string | null>(null);
  const [createIssueProjectId, setCreateIssueProjectId] = useState<string | null>(null);

  // Toast system
  const { toasts, addToast, removeToast } = useToast();
  const seenEventIds = useRef<Set<number>>(new Set());
  const mountTimeRef = useRef(Date.now());

  // Chat message buffer per project
  const chatBufferRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const [chatMessages, setChatMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // Subscribe to SSE events for toasts
  useEffect(() => {
    const unsub1 = subscribe("state_change", (event: DashboardEvent) => {
      if (event.type !== "state_change") return;
      if (event.id <= 0 || seenEventIds.current.has(event.id)) return;
      if (new Date(event.ts).getTime() < mountTimeRef.current) return;
      seenEventIds.current.add(event.id);

      if (event.to === "완료") {
        addToast({
          type: "success",
          title: `이슈 #${event.issueNumber} 완료`,
          message: `${event.projectId} 프로젝트`,
        });
      } else if (event.to === "개발 실패") {
        addToast({
          type: "error",
          title: `이슈 #${event.issueNumber} 실패`,
          message: `${event.projectId} 프로젝트`,
        });
      }
    });

    const unsub2 = subscribe("error", (event: DashboardEvent) => {
      if (event.type !== "error") return;
      if (seenEventIds.current.has(event.id)) return;
      if (new Date(event.ts).getTime() < mountTimeRef.current) return;
      seenEventIds.current.add(event.id);

      addToast({
        type: "error",
        title: "오류 발생",
        message: event.message,
      });
    });

    return () => { unsub1(); unsub2(); };
  }, [subscribe, addToast]);

  // Subscribe to agent_progress for chat messages
  useEffect(() => {
    const unsub = subscribe("agent_progress", (event: DashboardEvent) => {
      if (event.type !== "agent_progress" || !event.text) return;
      const msg: ChatMessage = {
        agentKey: `${event.projectId}#${event.issueNumber}`,
        skill: event.skill,
        text: event.text,
        eventSubtype: event.eventSubtype ?? "text",
        ts: event.ts,
      };
      const buf = chatBufferRef.current;
      const existing = buf.get(event.projectId) ?? [];
      existing.push(msg);
      if (existing.length > MAX_CHAT_MESSAGES) existing.shift();
      buf.set(event.projectId, existing);
      setChatMessages(new Map(buf));
    });
    return () => unsub();
  }, [subscribe]);

  // Subscribe to pr_merged for confetti
  useEffect(() => {
    const unsub = subscribe("pr_merged", (event: DashboardEvent) => {
      if (event.type !== "pr_merged") return;
      setConfettiProjectId(event.projectId);
      setTimeout(() => setConfettiProjectId(null), 2000);
    });
    return () => unsub();
  }, [subscribe]);

  // Agent activity from SSE heartbeats
  const agentActivity = useMemo(() => {
    const map = new Map<string, { toolUses: number; elapsedMs: number }>();
    for (const e of events) {
      if (e.type === "agent_heartbeat") {
        map.set(`${e.projectId}#${e.issueNumber}`, {
          toolUses: e.toolUses,
          elapsedMs: e.elapsedMs,
        });
      }
    }
    return map;
  }, [events]);

  // Build latest text map from agent_progress events
  const latestTexts = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.type === "agent_progress" && e.text) {
        map.set(`${e.projectId}#${e.issueNumber}`, e.text);
      }
    }
    return map;
  }, [events]);

  // Build latest event subtype map from agent_progress events
  const latestEventSubtypes = useMemo(() => {
    const map = new Map<string, { eventSubtype?: string; toolName?: string; isError?: boolean }>();
    for (const e of events) {
      if (e.type === "agent_progress") {
        map.set(`${e.projectId}#${e.issueNumber}`, {
          eventSubtype: e.eventSubtype,
          toolName: e.toolName,
          isError: e.isError,
        });
      }
    }
    return map;
  }, [events]);

  // Group agents by project
  const agentsByProject = useMemo(() => {
    const map = new Map<string, ActiveAgent[]>();
    for (const agent of agents ?? []) {
      const list = map.get(agent.projectId) ?? [];
      list.push(agent);
      map.set(agent.projectId, list);
    }
    return map;
  }, [agents]);

  // Aggregate stateCounts across all projects for MiniPipeline
  const totalStateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const project of projects ?? []) {
      for (const [key, val] of Object.entries(project.stateCounts)) {
        counts[key] = (counts[key] ?? 0) + val;
      }
    }
    return counts;
  }, [projects]);

  // Project info map for GitHub links
  const projectInfoMap = useMemo(() => {
    const map = new Map<string, { owner: string; repo: string }>();
    for (const p of projects ?? []) {
      map.set(p.id, { owner: p.owner, repo: p.repo });
    }
    return map;
  }, [projects]);

  // Recent completions by project (for empty rooms)
  const recentCompletionsByProject = useMemo(() => {
    const map = new Map<string, Array<{ issueNumber: number; title?: string; ts: string }>>();
    if (!activity) return map;
    for (const e of activity) {
      if (e.type !== "완료") continue;
      const list = map.get(e.projectId) ?? [];
      if (list.length < 3 && e.issueNumber != null) {
        list.push({ issueNumber: e.issueNumber, title: e.title, ts: e.ts });
        map.set(e.projectId, list);
      }
    }
    return map;
  }, [activity]);

  const handleAgentClick = useCallback((agent: ActiveAgent) => {
    setSelectedAgent(agent);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  const handleRoomClick = useCallback((projectId: string) => {
    navigate(`/office/${projectId}`);
  }, [navigate]);

  const handleStageClick = useCallback((key: string) => {
    setExpandedStage((prev) => (prev === key ? null : key));
  }, []);

  // Auto pre-load issues for all projects when projects list changes
  useEffect(() => {
    if (!projects) return;
    for (const project of projects) {
      if (!roomIssues.has(project.id)) {
        api.getProject(project.id)
          .then((data) => setRoomIssues((prev) => new Map(prev).set(project.id, data.issues)))
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const handleToggleExpand = useCallback(async (projectId: string) => {
    if (expandedRoomId === projectId) {
      setExpandedRoomId(null);
      return;
    }
    setExpandedRoomId(projectId);
    // Lazy fetch issues
    if (!roomIssues.has(projectId)) {
      try {
        const data = await api.getProject(projectId);
        setRoomIssues((prev) => new Map(prev).set(projectId, data.issues));
      } catch {
        // ignore
      }
    }
  }, [expandedRoomId, roomIssues]);

  const handleToggleChat = useCallback((projectId: string) => {
    setExpandedChatRoomId((prev) => (prev === projectId ? null : projectId));
  }, []);

  const totalWorking = agents?.length ?? 0;
  const totalIssues = projects?.reduce((sum, p) => sum + p.totalIssues, 0) ?? 0;

  return (
    <MainLayout title="오피스" sseStatus={status} uptime={statusData?.uptime}>
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6 text-sm text-gray-400">
        <span>{projects?.length ?? 0} 프로젝트</span>
        <span>{totalIssues} 이슈</span>
        <span>{totalWorking} 에이전트</span>
      </div>

      {/* Office rooms grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl">
        {projects?.map((project) => (
          <OfficeRoom
            key={project.id}
            projectId={project.id}
            agents={agentsByProject.get(project.id) ?? []}
            latestTexts={latestTexts}
            latestEventSubtypes={latestEventSubtypes}
            onAgentClick={handleAgentClick}
            stateCounts={project.stateCounts}
            onRoomClick={handleRoomClick}
            recentCompletions={recentCompletionsByProject.get(project.id)}
            isExpanded={expandedRoomId === project.id}
            issueData={roomIssues.get(project.id)}
            onToggleExpand={() => handleToggleExpand(project.id)}
            agentActivity={agentActivity}
            owner={project.owner}
            repo={project.repo}
            chatMessages={chatMessages.get(project.id)}
            isChatExpanded={expandedChatRoomId === project.id}
            onToggleChat={() => handleToggleChat(project.id)}
            showConfetti={confettiProjectId === project.id}
            onCreateIssue={() => setCreateIssueProjectId(project.id)}
          />
        ))}
      </div>

      {/* Empty state */}
      {projects && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-gray-600">
          <span className="text-sm mb-2">프로젝트가 없습니다</span>
          <span className="text-xs">config.json에서 프로젝트를 설정하세요</span>
        </div>
      )}

      {/* Pipeline & Dept status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl mt-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">파이프라인</h3>
          <MiniPipeline
            stateCounts={totalStateCounts}
            pipelineData={pipelineData ?? undefined}
            expandedStage={expandedStage}
            onStageClick={handleStageClick}
            projectInfoMap={projectInfoMap}
          />
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">부서 현황</h3>
          {projects && agents && (
            <DeptStatus projects={projects} agents={agents} />
          )}
        </div>
      </div>

      {/* Agent history */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl mt-6">
        <AgentHistoryPanel activity={activity} projectInfoMap={projectInfoMap} />
        <AgentPerformanceSummary activity={activity} healingHistory={healingHistory} />
      </div>

      {/* Agent log panel */}
      {selectedAgent && (
        <AgentLogPanel
          agent={selectedAgent}
          onClose={handleClosePanel}
        />
      )}

      {/* Create issue modal */}
      {createIssueProjectId && (
        <CreateIssueModal
          projectId={createIssueProjectId}
          onClose={() => setCreateIssueProjectId(null)}
          onSuccess={(issueNumber, title) => {
            addToast({
              type: "info",
              title: `이슈 #${issueNumber} 등록 완료`,
              message: title,
            });
            setCreateIssueProjectId(null);
          }}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </MainLayout>
  );
}
