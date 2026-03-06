import { Card } from "../common/Card";
import type { PipelineResponse, IssueState } from "../../api/types";

interface PipelineStage {
  state: IssueState;
  color: string;
  dotColor: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  { state: "이슈 플랜", color: "border-blue-400 text-blue-400", dotColor: "bg-blue-400" },
  { state: "플랜중", color: "border-yellow-400 text-yellow-400", dotColor: "bg-yellow-400" },
  { state: "플랜 완료", color: "border-emerald-400 text-emerald-400", dotColor: "bg-emerald-400" },
  { state: "플랜 수정", color: "border-orange-400 text-orange-400", dotColor: "bg-orange-400" },
  { state: "개발 진행", color: "border-violet-400 text-violet-400", dotColor: "bg-violet-400" },
  { state: "개발 실패", color: "border-red-400 text-red-400", dotColor: "bg-red-400" },
  { state: "완료", color: "border-green-400 text-green-400", dotColor: "bg-green-400" },
];

const PULSE_STATES: IssueState[] = ["플랜중", "개발 진행"];

interface PipelineFlowProps {
  pipeline: PipelineResponse | null;
}

export function PipelineFlow({ pipeline }: PipelineFlowProps) {
  const byState = pipeline?.byState ?? {};

  return (
    <Card title="파이프라인 플로우">
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-0 min-w-max">
          {PIPELINE_STAGES.map((stage, idx) => {
            const issues = byState[stage.state] ?? [];
            const count = issues.length;
            const isPulse = PULSE_STATES.includes(stage.state);
            const isLast = idx === PIPELINE_STAGES.length - 1;

            return (
              <div key={stage.state} className="flex items-center">
                {/* Stage box */}
                <div
                  className={`w-28 rounded-lg border ${stage.color} bg-gray-900 p-3 flex flex-col items-center gap-2`}
                >
                  <div className="flex items-center gap-1.5">
                    {isPulse && count > 0 ? (
                      <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${stage.dotColor} opacity-75`} />
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${stage.dotColor}`} />
                      </span>
                    ) : (
                      <span className={`inline-flex rounded-full h-2 w-2 ${count > 0 ? stage.dotColor : "bg-gray-700"}`} />
                    )}
                    <span className="text-xs font-medium text-center leading-tight">
                      {stage.state}
                    </span>
                  </div>
                  <div className={`text-2xl font-bold ${count > 0 ? stage.color.split(" ")[1] : "text-gray-600"}`}>
                    {count}
                  </div>
                  <div className="text-xs text-gray-500">이슈</div>
                </div>

                {/* Arrow */}
                {!isLast && (
                  <div className="flex items-center px-1">
                    <div className="flex items-center">
                      <div className="w-6 h-px bg-gray-600" />
                      <div
                        className="w-0 h-0"
                        style={{
                          borderTop: "5px solid transparent",
                          borderBottom: "5px solid transparent",
                          borderLeft: "6px solid rgb(75 85 99)",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Total count */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex justify-end">
        <span className="text-xs text-gray-500">
          총{" "}
          <span className="text-gray-300 font-medium">
            {Object.values(byState).reduce((sum, arr) => sum + arr.length, 0)}
          </span>
          개 이슈 추적 중
        </span>
      </div>
    </Card>
  );
}
