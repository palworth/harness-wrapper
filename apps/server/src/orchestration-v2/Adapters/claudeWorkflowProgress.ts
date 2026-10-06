import type {
  OrchestrationV2SubagentUsage,
  OrchestrationV2WorkflowAgent,
  OrchestrationV2WorkflowProgress,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

// The wire repeats every phase and agent on each tick; caps bound what one
// update can carry into the projection.
const WORKFLOW_PHASE_CAP = 64;
const WORKFLOW_AGENT_CAP = 200;
const SHORT_TEXT_CAP = 240;
const PREVIEW_TEXT_CAP = 600;

function text(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > cap ? `${trimmed.slice(0, cap - 1)}…` : trimmed;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function agentState(
  state: string,
  startedAt: number | null,
): OrchestrationV2WorkflowAgent["state"] {
  switch (state) {
    case "queued":
    case "pending":
      return "queued";
    case "done":
    case "completed":
      return "done";
    case "error":
    case "failed":
    case "killed":
      return "failed";
    default:
      // "start", "running", and anything newer: running once it has started.
      return startedAt === null ? "queued" : "running";
  }
}

/**
 * Parses the `workflow_progress` array Claude Code puts on a workflow task's
 * `task_progress` messages. It is real on the wire but absent from sdk.d.ts, so
 * every field is read defensively: malformed entries are skipped, and an empty
 * or missing array yields undefined so the caller keeps the plain subagent row.
 */
export function parseClaudeWorkflowProgress(
  value: unknown,
  workflowName: string | null,
): OrchestrationV2WorkflowProgress | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const phases = new Map<number, OrchestrationV2WorkflowProgress["phases"][number]>();
  const agents = new Map<number, OrchestrationV2WorkflowAgent>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const index = count(record.index);
    if (index === null) continue;
    if (record.type === "workflow_phase") {
      const title = text(record.title, SHORT_TEXT_CAP);
      if (title !== null && !phases.has(index)) {
        phases.set(index, { index, title, detail: text(record.detail, SHORT_TEXT_CAP) });
      }
      continue;
    }
    if (record.type !== "workflow_agent" || agents.has(index)) continue;
    const state = typeof record.state === "string" ? record.state : "";
    const startedAt = epochMs(record.startedAt);
    agents.set(index, {
      index,
      label: text(record.label, SHORT_TEXT_CAP),
      phaseIndex: count(record.phaseIndex),
      model: text(record.model, SHORT_TEXT_CAP),
      state: agentState(state, startedAt),
      attempt: count(record.attempt),
      tokens: count(record.tokens),
      toolCalls: count(record.toolCalls),
      durationMs: count(record.durationMs),
      startedAt,
      lastToolName: text(record.lastToolName, SHORT_TEXT_CAP),
      lastToolSummary: text(record.lastToolSummary, SHORT_TEXT_CAP),
      resultPreview: text(record.resultPreview, PREVIEW_TEXT_CAP),
      error: text(record.error, PREVIEW_TEXT_CAP),
    });
  }
  if (phases.size === 0 && agents.size === 0) return undefined;
  return {
    name: workflowName,
    phases: Array.from(phases.values())
      .toSorted((a, b) => a.index - b.index)
      .slice(0, WORKFLOW_PHASE_CAP),
    agents: Array.from(agents.values())
      .toSorted((a, b) => a.index - b.index)
      .slice(0, WORKFLOW_AGENT_CAP),
  };
}

export function claudeSubagentUsage(value: unknown): OrchestrationV2SubagentUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const totalTokens = count(record.total_tokens);
  const toolUses = count(record.tool_uses);
  const durationMs = count(record.duration_ms);
  if (totalTokens === null && toolUses === null && durationMs === null) return undefined;
  return {
    totalTokens: totalTokens ?? 0,
    toolUses: toolUses ?? 0,
    durationMs: durationMs ?? 0,
  };
}

function sameRecords<T extends object>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  return (
    a.length === b.length &&
    a.every((left, i) => {
      const right = b[i] as Record<string, unknown> | undefined;
      return (
        right !== undefined &&
        Object.entries(left).every(([key, value]) => right[key] === value) &&
        Object.keys(right).length === Object.keys(left).length
      );
    })
  );
}

/** True when two snapshots would render identically. */
export function sameWorkflowProgress(
  a: OrchestrationV2WorkflowProgress | undefined,
  b: OrchestrationV2WorkflowProgress | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.name === b.name && sameRecords(a.phases, b.phases) && sameRecords(a.agents, b.agents);
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export interface ClaudeWorkflowRunSnapshot {
  readonly workflow: OrchestrationV2WorkflowProgress;
  readonly usage: OrchestrationV2SubagentUsage | undefined;
}

/** The run record Claude Code saves for a finished workflow, if it belongs to `taskId`. */
export function parseClaudeWorkflowRunRecord(
  value: unknown,
  taskId: string,
): ClaudeWorkflowRunSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.taskId !== taskId) return undefined;
  const workflow = parseClaudeWorkflowProgress(
    record.workflowProgress,
    text(record.workflowName, SHORT_TEXT_CAP),
  );
  if (workflow === undefined) return undefined;
  // The saved phase list carries the script's phase details; progress entries do not.
  const declared = Array.isArray(record.phases) ? record.phases : [];
  const phases = workflow.phases.map((phase, position) => {
    const entry = declared[position] as Record<string, unknown> | undefined;
    return phase.detail === null && entry?.title === phase.title
      ? { ...phase, detail: text(entry.detail, SHORT_TEXT_CAP) }
      : phase;
  });
  const usage = claudeSubagentUsage({
    total_tokens: record.totalTokens,
    tool_uses: record.totalToolCalls,
    duration_ms: record.durationMs,
  });
  return { workflow: { ...workflow, phases }, usage };
}

/**
 * Reads the final snapshot of a workflow run from Claude Code's session
 * directory (`<config>/projects/<cwd slug>/<session>/workflows/<run>.json`).
 * The last `task_progress` can predate agents that start and finish between
 * ticks, so this is the authoritative end state. Claude Code writes it before
 * the completion notification, so one read suffices and never stalls the
 * message stream; any failure yields none and the card keeps its last live
 * snapshot.
 */
export const readClaudeWorkflowRunSnapshot = Effect.fn("readClaudeWorkflowRunSnapshot")(
  function* (input: {
    readonly configDir: string;
    readonly cwd: string | null;
    readonly sessionId: string;
    readonly taskId: string;
  }): Effect.fn.Return<
    Option.Option<ClaudeWorkflowRunSnapshot>,
    never,
    FileSystem.FileSystem | Path.Path
  > {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projectsDir = path.join(input.configDir, "projects");
    const exists = (candidate: string) =>
      fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    const findWorkflowsDir = Effect.fnUntraced(function* () {
      if (input.cwd !== null) {
        const slug = path.resolve(input.cwd).replace(/[^a-zA-Z0-9]/g, "-");
        const direct = path.join(projectsDir, slug, input.sessionId, "workflows");
        if (yield* exists(direct)) return direct;
      }
      // Long paths get a shortened slug; fall back to finding the session anywhere.
      const projects = yield* fileSystem
        .readDirectory(projectsDir)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const project of projects) {
        const candidate = path.join(projectsDir, project, input.sessionId, "workflows");
        if (yield* exists(candidate)) return candidate;
      }
      return undefined;
    });
    const dir = yield* findWorkflowsDir();
    if (dir === undefined) return Option.none<ClaudeWorkflowRunSnapshot>();
    const files = yield* fileSystem
      .readDirectory(dir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const contents = yield* fileSystem
        .readFileString(path.join(dir, file))
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) continue;
      const snapshot = Option.flatMap(decodeJson(contents), (value) =>
        Option.fromUndefinedOr(parseClaudeWorkflowRunRecord(value, input.taskId)),
      );
      if (Option.isSome(snapshot)) return snapshot;
    }
    return Option.none<ClaudeWorkflowRunSnapshot>();
  },
);
