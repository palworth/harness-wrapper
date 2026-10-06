import type {
  OrchestrationV2Subagent,
  OrchestrationV2WorkflowAgent,
  ThreadId,
} from "@t3tools/contracts";

/** One row in a workflow card: a workflow agent, or a plain subagent shown the same way. */
export interface WorkflowCardAgent {
  readonly key: string;
  readonly label: string;
  readonly model: string | null;
  readonly state: OrchestrationV2WorkflowAgent["state"];
  readonly tokens: number | null;
  readonly toolCalls: number | null;
  /** ISO start for a live ticking clock; settled agents use durationMs. */
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly attempt: number | null;
  /** Latest activity while running, e.g. "Edit · src/app.ts". */
  readonly activity: string | null;
  /** Shown when the row is expanded: the agent's result or error. */
  readonly detail: string | null;
  readonly childThreadId: ThreadId | null;
}

export interface WorkflowCardPhase {
  readonly key: string;
  /** 1-based position, or null for agents without a phase. */
  readonly number: number | null;
  readonly title: string;
  readonly detail: string | null;
  readonly state: WorkflowCardAgent["state"];
  readonly agents: ReadonlyArray<WorkflowCardAgent>;
}

export interface WorkflowCardModel {
  readonly title: string;
  readonly description: string | null;
  readonly state: WorkflowCardAgent["state"];
  readonly phases: ReadonlyArray<WorkflowCardPhase>;
  readonly currentPhaseNumber: number | null;
  readonly agentCount: number;
  readonly doneCount: number;
  readonly failedCount: number;
  readonly runningCount: number;
  readonly totalTokens: number | null;
}

const SETTLED_SUBAGENT: Partial<
  Record<OrchestrationV2Subagent["status"], WorkflowCardAgent["state"]>
> = {
  completed: "done",
  idle: "done",
  failed: "failed",
  cancelled: "failed",
  interrupted: "failed",
};

export function subagentCardState(
  status: OrchestrationV2Subagent["status"],
): WorkflowCardAgent["state"] {
  return SETTLED_SUBAGENT[status] ?? (status === "pending" ? "queued" : "running");
}

/** A phase or run reads failed if anything failed, running while anything runs, done when all are. */
export function rollUpState(
  states: ReadonlyArray<WorkflowCardAgent["state"]>,
): WorkflowCardAgent["state"] {
  if (states.length === 0) return "queued";
  if (states.includes("running")) return "running";
  if (states.every((state) => state === "done")) return "done";
  if (states.includes("failed") && !states.includes("queued")) return "failed";
  return states.some((state) => state !== "queued") ? "running" : "queued";
}

function isoFromMs(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function workflowAgentRow(agent: OrchestrationV2WorkflowAgent): WorkflowCardAgent {
  const activity =
    agent.state === "running" && agent.lastToolName
      ? agent.lastToolSummary
        ? `${agent.lastToolName} · ${agent.lastToolSummary}`
        : agent.lastToolName
      : null;
  return {
    key: `agent:${agent.index}`,
    label: agent.label ?? `agent ${agent.index}`,
    model: agent.model,
    state: agent.state,
    tokens: agent.tokens,
    toolCalls: agent.toolCalls,
    startedAt: isoFromMs(agent.startedAt),
    completedAt:
      agent.startedAt !== null && agent.durationMs !== null && agent.state !== "running"
        ? isoFromMs(agent.startedAt + agent.durationMs)
        : null,
    durationMs: agent.durationMs,
    attempt: agent.attempt,
    activity,
    detail: agent.error ?? agent.resultPreview,
    childThreadId: null,
  };
}

function summarize(
  base: Pick<WorkflowCardModel, "title" | "description">,
  phases: ReadonlyArray<WorkflowCardPhase>,
  settledState: WorkflowCardAgent["state"] | null,
  usageTokens: number | null,
): WorkflowCardModel {
  const agents = phases.flatMap((phase) => phase.agents);
  const agentTokens = agents.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0);
  const totalTokens = Math.max(agentTokens, usageTokens ?? 0);
  const current =
    phases.find((phase) => phase.state === "running") ??
    phases.find((phase) => phase.state !== "done") ??
    phases.at(-1);
  return {
    ...base,
    state: settledState ?? rollUpState(agents.map((agent) => agent.state)),
    phases,
    currentPhaseNumber: current?.number ?? null,
    agentCount: agents.length,
    doneCount: agents.filter((agent) => agent.state === "done").length,
    failedCount: agents.filter((agent) => agent.state === "failed").length,
    runningCount: agents.filter((agent) => agent.state === "running").length,
    totalTokens: totalTokens > 0 ? totalTokens : null,
  };
}

/** The card for a scripted workflow run (a subagent carrying `workflow`). */
export function workflowCardModel(
  subagent: Pick<OrchestrationV2Subagent, "status" | "title" | "usage" | "workflow">,
): WorkflowCardModel {
  const workflow = subagent.workflow ?? { name: null, phases: [], agents: [] };
  const settled = SETTLED_SUBAGENT[subagent.status] ?? null;
  // The last snapshot can predate the run's end; nothing is still running after it.
  const rows = workflow.agents.map((agent) => ({
    agent,
    row: workflowAgentRow(
      settled !== null && agent.state === "running" ? { ...agent, state: settled } : agent,
    ),
  }));
  const known = new Set(workflow.phases.map((phase) => phase.index));
  const phases: WorkflowCardPhase[] = workflow.phases.map((phase, position) => {
    const agents = rows
      .filter(({ agent }) => agent.phaseIndex === phase.index)
      .map(({ row }) => row);
    return {
      key: `phase:${phase.index}`,
      number: position + 1,
      title: phase.title,
      detail: phase.detail,
      state: rollUpState(agents.map((agent) => agent.state)),
      agents,
    };
  });
  const unphased = rows
    .filter(({ agent }) => agent.phaseIndex === null || !known.has(agent.phaseIndex))
    .map(({ row }) => row);
  if (unphased.length > 0) {
    phases.push({
      key: "phase:none",
      number: null,
      title: phases.length === 0 ? "Agents" : "Other agents",
      detail: null,
      state: rollUpState(unphased.map((agent) => agent.state)),
      agents: unphased,
    });
  }
  return summarize(
    {
      title: workflow.name ?? subagent.title ?? "Workflow",
      description: workflow.name && subagent.title !== workflow.name ? subagent.title : null,
    },
    phases,
    settled,
    subagent.usage?.totalTokens ?? null,
  );
}

/** Plain subagents launched together, shown as a one-phase workflow. */
export function subagentGroupCardModel(
  members: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly model: string | null;
    readonly status: OrchestrationV2Subagent["status"];
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly usage: OrchestrationV2Subagent["usage"];
    readonly progress: string | null;
    readonly result: string | null;
    readonly childThreadId: ThreadId | null;
  }>,
): WorkflowCardModel {
  const agents: WorkflowCardAgent[] = members.map((member) => {
    const state = subagentCardState(member.status);
    const result = member.result?.trim() || null;
    const progress = member.progress?.trim() || null;
    const settled = state === "done" || state === "failed";
    return {
      key: member.id,
      label: member.title,
      model: member.model,
      state,
      tokens: member.usage?.totalTokens ?? null,
      toolCalls: member.usage?.toolUses ?? null,
      startedAt: member.startedAt,
      completedAt: member.completedAt,
      durationMs: null,
      attempt: null,
      activity: state === "running" ? progress : null,
      // Same preference as the single-subagent row: the outcome once settled, the latest step before.
      detail: settled ? (result ?? progress) : (progress ?? result),
      childThreadId: member.childThreadId,
    };
  });
  return summarize(
    { title: `${members.length} subagents`, description: null },
    [
      {
        key: "phase:agents",
        number: null,
        title: "Agents",
        detail: null,
        state: rollUpState(agents.map((agent) => agent.state)),
        agents,
      },
    ],
    null,
    null,
  );
}
