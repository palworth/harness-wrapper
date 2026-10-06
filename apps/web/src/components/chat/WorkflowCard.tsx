import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { formatTokens } from "@t3tools/shared/usageFormat";
import type { ThreadId } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { AgentElapsed } from "./AgentElapsed";
import type { WorkflowCardAgent, WorkflowCardModel, WorkflowCardPhase } from "./workflowCard.logic";

type CardState = WorkflowCardAgent["state"];

const STATE_LABEL: Record<CardState, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

function StateIcon({ state, className }: { state: CardState; className?: string }) {
  const iconClass = cn("size-3.5 shrink-0", className);
  switch (state) {
    case "running":
      return <LoaderCircleIcon aria-hidden className={cn(iconClass, "animate-spin text-info")} />;
    case "done":
      return <CheckIcon aria-hidden className={cn(iconClass, "text-success")} />;
    case "failed":
      return <XIcon aria-hidden className={cn(iconClass, "text-destructive")} />;
    default:
      return <CircleDashedIcon aria-hidden className={cn(iconClass, "text-muted-foreground")} />;
  }
}

const SEGMENT_CLASS: Record<CardState, string> = {
  queued: "bg-muted-foreground/20",
  running: "bg-info animate-pulse",
  done: "bg-success",
  failed: "bg-destructive",
};

/** One segment per agent, so progress and failures read at a glance. */
function ProgressSegments({ agents }: { agents: ReadonlyArray<WorkflowCardAgent> }) {
  if (agents.length === 0) {
    return <div className="h-1 w-full animate-pulse rounded-full bg-muted-foreground/20" />;
  }
  return (
    <div className="flex h-1 w-full gap-0.5" aria-hidden>
      {agents.map((agent) => (
        <span
          key={agent.key}
          className={cn("h-full flex-1 rounded-full", SEGMENT_CLASS[agent.state])}
        />
      ))}
    </div>
  );
}

/** "claude-sonnet-5-5" reads as "sonnet-5-5" in a dense row. */
function shortModel(model: string | null): string | null {
  return model?.replace(/^claude-/, "") ?? null;
}

function AgentClock({ agent }: { agent: WorkflowCardAgent }) {
  if (agent.state === "running" && agent.startedAt) {
    return (
      <AgentElapsed agent={{ status: "running", startedAt: agent.startedAt, completedAt: null }} />
    );
  }
  if (agent.durationMs !== null) return <>{formatDuration(agent.durationMs)}</>;
  if (agent.startedAt && agent.completedAt) {
    return (
      <AgentElapsed
        agent={{ status: "completed", startedAt: agent.startedAt, completedAt: agent.completedAt }}
      />
    );
  }
  return null;
}

function AgentRow({
  agent,
  onOpenThread,
}: {
  agent: WorkflowCardAgent;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = agent.detail !== null || agent.childThreadId !== null;
  const metrics = [
    agent.tokens !== null ? `${formatTokens(agent.tokens)} tok` : null,
    agent.toolCalls !== null ? `${agent.toolCalls} tools` : null,
    agent.attempt !== null && agent.attempt > 1 ? `try ${agent.attempt}` : null,
  ].filter((part) => part !== null);
  return (
    <li data-workflow-agent-state={agent.state}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left",
          expandable && "hover:bg-accent/50",
          agent.state === "queued" && "opacity-60",
        )}
      >
        <StateIcon state={agent.state} />
        <span className="min-w-0 truncate font-mono text-xs text-foreground">{agent.label}</span>
        {shortModel(agent.model) ? (
          <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-3xs text-muted-foreground">
            {shortModel(agent.model)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground">
          {agent.activity}
        </span>
        <span className="shrink-0 font-mono text-3xs text-muted-foreground tabular-nums">
          {metrics.join(" · ")}
          {metrics.length > 0 ? " · " : null}
          <AgentClock agent={agent} />
        </span>
      </button>
      {open && expandable ? (
        <div className="mb-1 ml-7 mr-2 rounded-md border border-border/60 bg-muted/30 p-2">
          {agent.detail ? (
            <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-3xs text-muted-foreground">
              {agent.detail}
            </p>
          ) : null}
          {agent.childThreadId !== null ? (
            <button
              type="button"
              onClick={() => agent.childThreadId && onOpenThread(agent.childThreadId)}
              className="mt-1 text-3xs font-medium text-info hover:underline"
            >
              Open agent thread
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PhaseSection({
  phase,
  showHeader,
  onOpenThread,
}: {
  phase: WorkflowCardPhase;
  showHeader: boolean;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const done = phase.agents.filter((agent) => agent.state === "done").length;
  return (
    <section data-workflow-phase-state={phase.state}>
      {showHeader ? (
        <header className="flex items-baseline gap-2 px-2 pt-2 pb-1">
          <span className="font-mono text-3xs text-muted-foreground tabular-nums">
            {phase.number !== null ? String(phase.number).padStart(2, "0") : "··"}
          </span>
          <span
            className={cn(
              "font-mono text-3xs font-semibold uppercase tracking-widest",
              phase.state === "queued" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {phase.title}
          </span>
          {phase.detail ? (
            <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground">
              {phase.detail}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {phase.agents.length > 0 ? (
            <span className="shrink-0 font-mono text-3xs text-muted-foreground tabular-nums">
              {done}/{phase.agents.length}
            </span>
          ) : null}
        </header>
      ) : null}
      {phase.agents.length > 0 ? (
        <ul>
          {phase.agents.map((agent) => (
            <AgentRow key={agent.key} agent={agent} onOpenThread={onOpenThread} />
          ))}
        </ul>
      ) : (
        <p className="px-2 pb-1 pl-9 text-3xs text-muted-foreground">Waiting to start</p>
      )}
    </section>
  );
}

/**
 * Workflow-style view of multi-agent work: a header with overall progress and
 * phases listing their agents, modeled on Claude's workflow view. Used for
 * Claude Workflow runs and for any group of subagents launched together.
 */
export function WorkflowCard({
  model,
  timing,
  onOpenThread,
  defaultExpanded,
  onExpandedChange,
}: {
  model: WorkflowCardModel;
  /** Defaults to open while the run is in flight. */
  defaultExpanded?: boolean | undefined;
  onExpandedChange?: (expanded: boolean) => void;
  /** Overall run clock. */
  timing: { status: "running" | "completed"; startedAt: string | null; completedAt: string | null };
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [expanded, setExpandedState] = useState(
    defaultExpanded ?? (model.state === "running" || model.state === "queued"),
  );
  const setExpanded = (open: boolean) => {
    setExpandedState(open);
    onExpandedChange?.(open);
  };
  const agents = model.phases.flatMap((phase) => phase.agents);
  const numbered = model.phases.filter((phase) => phase.number !== null).length;
  const stats = [
    numbered > 1 && model.currentPhaseNumber !== null
      ? `phase ${model.currentPhaseNumber}/${numbered}`
      : null,
    model.agentCount > 0 ? `${model.doneCount}/${model.agentCount} agents` : null,
    model.failedCount > 0 ? `${model.failedCount} failed` : null,
    model.totalTokens !== null ? `${formatTokens(model.totalTokens)} tok` : null,
  ].filter((part) => part !== null);
  return (
    <div data-workflow-card className="my-1 rounded-lg border border-border/70 bg-card/40">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          aria-label={`${model.title}: ${STATE_LABEL[model.state]}`}
          className="flex w-full min-w-0 flex-col gap-2 px-3 py-2 text-left"
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <WorkflowIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-mono text-xs font-semibold text-foreground">
              {model.title}
            </span>
            <StateIcon state={model.state} />
            <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground">
              {model.description}
            </span>
            <span className="shrink-0 font-mono text-3xs text-muted-foreground tabular-nums">
              {stats.join(" · ")}
              {timing.startedAt ? (
                <>
                  {stats.length > 0 ? " · " : null}
                  <AgentElapsed agent={timing} />
                </>
              ) : null}
            </span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </span>
          <ProgressSegments agents={agents} />
        </CollapsibleTrigger>
        {/* Virtualized rows must settle before disclosure scroll anchoring resumes. */}
        <CollapsiblePanel animate={false}>
          {expanded ? (
            <div className="border-t border-border/60 px-1 pb-1">
              {model.phases.length === 0 ? (
                <p className="px-2 py-2 text-3xs text-muted-foreground">Starting workflow…</p>
              ) : (
                model.phases.map((phase) => (
                  <PhaseSection
                    key={phase.key}
                    phase={phase}
                    showHeader={model.phases.length > 1 || phase.number !== null}
                    onOpenThread={onOpenThread}
                  />
                ))
              )}
            </div>
          ) : null}
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
