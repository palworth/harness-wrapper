import type { OrchestrationV2WorkflowAgent, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rollUpState, subagentGroupCardModel, workflowCardModel } from "./workflowCard.logic";

function agent(
  overrides: Partial<OrchestrationV2WorkflowAgent> &
    Pick<OrchestrationV2WorkflowAgent, "index" | "state">,
): OrchestrationV2WorkflowAgent {
  return {
    label: `agent-${overrides.index}`,
    phaseIndex: null,
    model: null,
    attempt: null,
    tokens: null,
    toolCalls: null,
    durationMs: null,
    startedAt: null,
    lastToolName: null,
    lastToolSummary: null,
    resultPreview: null,
    error: null,
    ...overrides,
  };
}

const phases = [
  { index: 1, title: "Review", detail: "find bugs" },
  { index: 2, title: "Write", detail: null },
];

describe("rollUpState", () => {
  it("reads running while anything runs and done only when all are", () => {
    expect(rollUpState([])).toBe("queued");
    expect(rollUpState(["done", "running"])).toBe("running");
    expect(rollUpState(["done", "done"])).toBe("done");
    expect(rollUpState(["done", "failed"])).toBe("failed");
    expect(rollUpState(["done", "queued"])).toBe("running");
    expect(rollUpState(["queued", "queued"])).toBe("queued");
  });
});

describe("workflowCardModel", () => {
  it("groups agents under their phases and summarizes progress", () => {
    const model = workflowCardModel({
      status: "running",
      title: "Review the diff",
      usage: undefined,
      workflow: {
        name: "review-changes",
        phases,
        agents: [
          agent({ index: 1, phaseIndex: 1, state: "done", tokens: 1000, durationMs: 5000 }),
          agent({
            index: 2,
            phaseIndex: 1,
            state: "running",
            startedAt: 1_790_000_000_000,
            lastToolName: "Read",
            lastToolSummary: "src/app.ts",
            tokens: 500,
          }),
          agent({ index: 3, phaseIndex: 2, state: "queued" }),
        ],
      },
    });
    expect(model.title).toBe("review-changes");
    expect(model.description).toBe("Review the diff");
    expect(model.state).toBe("running");
    expect(model.phases.map((phase) => [phase.number, phase.title, phase.state])).toEqual([
      [1, "Review", "running"],
      [2, "Write", "queued"],
    ]);
    expect(model.currentPhaseNumber).toBe(1);
    expect([model.doneCount, model.agentCount, model.runningCount]).toEqual([1, 3, 1]);
    expect(model.totalTokens).toBe(1500);
    expect(model.phases[0]?.agents[1]?.activity).toBe("Read · src/app.ts");
    expect(model.phases[0]?.agents[1]?.startedAt).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it("collects unphased agents and settles stale running rows once the run ends", () => {
    const model = workflowCardModel({
      status: "completed",
      title: "Run",
      usage: { totalTokens: 9000, toolUses: 4, durationMs: 100 },
      workflow: {
        name: null,
        phases: [],
        agents: [
          agent({ index: 1, state: "running", startedAt: 1 }),
          agent({ index: 2, state: "queued" }),
        ],
      },
    });
    expect(model.title).toBe("Run");
    expect(model.phases).toHaveLength(1);
    expect(model.phases[0]?.title).toBe("Agents");
    expect(model.phases[0]?.number).toBeNull();
    expect(model.phases[0]?.agents.map((row) => row.state)).toEqual(["done", "queued"]);
    expect(model.state).toBe("done");
    // Provider usage wins when it exceeds what the agents reported.
    expect(model.totalTokens).toBe(9000);
  });

  it("shows a just-started workflow with no snapshot yet", () => {
    const model = workflowCardModel({
      status: "running",
      title: "Review",
      usage: undefined,
      workflow: { name: "review", phases: [], agents: [] },
    });
    expect(model.phases).toEqual([]);
    expect(model.agentCount).toBe(0);
    expect(model.state).toBe("queued");
  });
});

describe("subagentGroupCardModel", () => {
  it("shows plain subagents as one phase with their usage and child threads", () => {
    const model = subagentGroupCardModel([
      {
        id: "a",
        title: "Audit",
        model: "claude-haiku-4-5",
        status: "completed",
        startedAt: "2026-10-05T00:00:00.000Z",
        completedAt: "2026-10-05T00:01:00.000Z",
        usage: { totalTokens: 300, toolUses: 2, durationMs: 60_000 },
        progress: null,
        result: "No issues.",
        childThreadId: "child-a" as ThreadId,
      },
      {
        id: "b",
        title: "Fix",
        model: null,
        status: "running",
        startedAt: "2026-10-05T00:00:00.000Z",
        completedAt: null,
        usage: undefined,
        progress: "Editing files",
        result: null,
        childThreadId: null,
      },
    ]);
    expect(model.title).toBe("2 subagents");
    expect(model.state).toBe("running");
    expect(model.phases[0]?.agents.map((row) => [row.label, row.state, row.tokens])).toEqual([
      ["Audit", "done", 300],
      ["Fix", "running", null],
    ]);
    expect(model.phases[0]?.agents[0]?.detail).toBe("No issues.");
    expect(model.phases[0]?.agents[1]?.activity).toBe("Editing files");
    expect(model.phases[0]?.agents[0]?.childThreadId).toBe("child-a");
  });
});
