import type { ActiveAgent, IssueRecord } from "../../api/types";
import { skillToCharacterId } from "../../utils/sprites";
import { SpriteCharacter } from "./SpriteCharacter";
import { SpeechBubble } from "./SpeechBubble";
import { IssueSummaryCard } from "./IssueSummaryCard";
import { RoomIssueList } from "./RoomIssueList";
import { AgentChatRoom } from "./AgentChatRoom";
import { Confetti } from "./Confetti";
import type { ChatMessage } from "./AgentChatRoom";

interface RecentCompletion {
  issueNumber: number;
  ts: string;
}

interface OfficeRoomProps {
  projectId: string;
  agents: ActiveAgent[];
  latestTexts: Map<string, string>;
  latestEventSubtypes: Map<string, { eventSubtype?: string; toolName?: string; isError?: boolean }>;
  onAgentClick: (agent: ActiveAgent) => void;
  stateCounts: Record<string, number>;
  onRoomClick?: (projectId: string) => void;
  recentCompletions?: RecentCompletion[];
  // Expand
  isExpanded?: boolean;
  issueData?: IssueRecord[];
  onToggleExpand?: () => void;
  // Activity
  agentActivity?: Map<string, { toolUses: number; elapsedMs: number }>;
  // GitHub info
  owner?: string;
  repo?: string;
  // Chat
  chatMessages?: ChatMessage[];
  isChatExpanded?: boolean;
  onToggleChat?: () => void;
  // Confetti
  showConfetti?: boolean;
  // Issue creation
  onCreateIssue?: () => void;
}

const ROOM_ACCENT: Record<string, string> = {
  "issue-pilot": "border-violet-500/30",
  "wedding-invitation": "border-pink-500/30",
  "order-management-system": "border-emerald-500/30",
  "auto-trading-system": "border-amber-500/30",
};

const MAX_VISIBLE_AGENTS = 4;

function deriveWorkState(eventSubtype?: string, isError?: boolean): "idle" | "thinking" | "tool_use" | "error" {
  if (eventSubtype === "thinking") return "thinking";
  if (eventSubtype === "tool_use") return "tool_use";
  if (eventSubtype === "tool_result" && isError) return "error";
  return "idle";
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function OfficeRoom({
  projectId,
  agents,
  latestTexts,
  latestEventSubtypes,
  onAgentClick,
  stateCounts,
  onRoomClick,
  recentCompletions,
  isExpanded,
  issueData,
  onToggleExpand,
  agentActivity,
  owner,
  repo,
  chatMessages,
  isChatExpanded,
  onToggleChat,
  showConfetti,
  onCreateIssue,
}: OfficeRoomProps) {
  const accent = ROOM_ACCENT[projectId] ?? "border-gray-700";
  const visibleAgents = agents.slice(0, MAX_VISIBLE_AGENTS);
  const extraCount = agents.length - MAX_VISIBLE_AGENTS;
  const totalIssues = Object.values(stateCounts).reduce((a, b) => a + b, 0);
  const working = (stateCounts["개발 진행"] ?? 0) + (stateCounts["플랜중"] ?? 0);

  return (
    <div
      className={`relative bg-gray-800 border ${accent} rounded-xl p-4 min-h-[200px] flex flex-col`}
    >
      {/* Room header - clickable for navigation */}
      <div
        className={`flex items-center justify-between mb-3 group ${onRoomClick ? "cursor-pointer hover:bg-gray-700/50 rounded-lg px-2 py-1 -mx-2 -mt-1 transition-colors" : ""}`}
        onClick={() => onRoomClick?.(projectId)}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${agents.length > 0 ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
          <h3 className="text-sm font-semibold text-white truncate">
            {projectId}
          </h3>
          {onRoomClick && (
            <span className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs">
              →
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{working} 진행 / {totalIssues} 이슈</span>
          {onCreateIssue && (
            <button
              onClick={(e) => { e.stopPropagation(); onCreateIssue(); }}
              className="w-5 h-5 flex items-center justify-center rounded bg-gray-700 hover:bg-violet-600 text-gray-400 hover:text-white transition-colors cursor-pointer text-xs"
              title="이슈 등록"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Agents area */}
      <div className="flex-1 flex items-end justify-center gap-4 pb-2">
        {visibleAgents.length === 0 ? (
          issueData && issueData.length > 0 ? (
            <div className="w-full self-start">
              <RoomIssueList issues={issueData} owner={owner} repo={repo} />
            </div>
          ) : (
            <IssueSummaryCard
              stateCounts={stateCounts}
              projectId={projectId}
              recentCompletions={recentCompletions}
              owner={owner}
              repo={repo}
            />
          )
        ) : (
          visibleAgents.map((agent) => {
            const key = `${agent.projectId}#${agent.issueNumber}`;
            const latestText = latestTexts.get(key);
            const eventInfo = latestEventSubtypes.get(key);
            const charId = skillToCharacterId(agent.skill, agent.issueNumber);
            const workState = deriveWorkState(eventInfo?.eventSubtype, eventInfo?.isError);
            const activity = agentActivity?.get(key);

            return (
              <div key={key} className="flex flex-col items-center gap-1">
                {(latestText || eventInfo?.eventSubtype) && (
                  <SpeechBubble
                    text={latestText}
                    eventSubtype={eventInfo?.eventSubtype as "text" | "tool_use" | "tool_result" | "thinking" | undefined}
                    toolName={eventInfo?.toolName}
                    isError={eventInfo?.isError}
                  />
                )}
                <SpriteCharacter
                  characterId={charId}
                  size={48}
                  onClick={() => onAgentClick(agent)}
                  label={`#${agent.issueNumber} ${agent.skill}`}
                  workState={workState}
                />
                {/* Desk */}
                <div className="w-14 h-3 bg-gray-700/60 rounded-sm border border-gray-600/40 -mt-1" />
                {/* Activity indicator */}
                {activity && (
                  <div className="flex items-center gap-1 -mt-0.5">
                    <span className="bg-violet-500/20 text-violet-400 text-[10px] font-mono rounded-full px-1.5">
                      {activity.toolUses}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {formatElapsed(activity.elapsedMs)}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
        {extraCount > 0 && (
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-700/80 border border-gray-600 text-xs text-gray-300">
            +{extraCount}
          </div>
        )}
      </div>

      {/* Toggle buttons */}
      {(onToggleExpand || onToggleChat) && (totalIssues > 0 || (chatMessages && chatMessages.length > 0)) && (
        <div className="border-t border-gray-700/50 mt-2 pt-1">
          <div className="flex items-center justify-center gap-3">
            {onToggleExpand && totalIssues > 0 && agents.length > 0 && (
              <button
                onClick={onToggleExpand}
                className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer py-1 transition-colors"
              >
                {isExpanded ? "▲ 접기" : `▼ 이슈 목록 (${totalIssues})`}
              </button>
            )}
            {onToggleChat && (
              <button
                onClick={onToggleChat}
                className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer py-1 transition-colors"
              >
                {isChatExpanded ? "▲ 채팅 닫기" : `💬 채팅 (${chatMessages?.length ?? 0})`}
              </button>
            )}
          </div>
          {isExpanded && issueData && (
            <div className="mt-1 transition-all duration-300">
              <RoomIssueList issues={issueData} owner={owner} repo={repo} />
            </div>
          )}
          {isChatExpanded && chatMessages && (
            <div className="mt-1">
              <AgentChatRoom messages={chatMessages} />
            </div>
          )}
        </div>
      )}

      {/* Confetti effect */}
      {showConfetti && <Confetti />}
    </div>
  );
}
