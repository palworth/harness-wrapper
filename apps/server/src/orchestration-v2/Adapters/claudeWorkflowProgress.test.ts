import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  claudeSubagentUsage,
  parseClaudeWorkflowProgress,
  parseClaudeWorkflowRunRecord,
  readClaudeWorkflowRunSnapshot,
  sameWorkflowProgress,
} from "./claudeWorkflowProgress.ts";

// Shape as Claude Code writes it (numeric startedAt, "done" states).
const snapshot = [
  { type: "workflow_phase", index: 1, title: "Voices", detail: "four voices attack the pack" },
  { type: "workflow_phase", index: 2, title: "Write" },
  {
    type: "workflow_agent",
    index: 1,
    label: "voice:generalist",
    phaseIndex: 1,
    phaseTitle: "Voices",
    model: "claude-sonnet-5-5",
    state: "done",
    startedAt: 1790921219807,
    attempt: 1,
    lastToolName: "StructuredOutput",
    tokens: 208323,
    toolCalls: 37,
    durationMs: 517684,
    resultPreview: '{"voice":"Generalist partner"}',
  },
  { type: "workflow_agent", index: 2, label: "voice:technical", phaseIndex: 1, state: "start" },
  {
    type: "workflow_agent",
    index: 3,
    label: "write",
    phaseIndex: 2,
    state: "running",
    startedAt: "2026-10-02T06:30:00.000Z",
  },
  {
    type: "workflow_agent",
    index: 4,
    label: "broken",
    phaseIndex: 2,
    state: "error",
    error: "boom",
  },
];

describe("parseClaudeWorkflowProgress", () => {
  it("maps phases and agents from a workflow_progress snapshot", () => {
    const progress = parseClaudeWorkflowProgress(snapshot, "diligence");
    assert.isDefined(progress);
    assert.strictEqual(progress?.name, "diligence");
    assert.deepStrictEqual(progress?.phases, [
      { index: 1, title: "Voices", detail: "four voices attack the pack" },
      { index: 2, title: "Write", detail: null },
    ]);
    assert.deepStrictEqual(
      progress?.agents.map((agent) => [agent.index, agent.label, agent.state]),
      [
        [1, "voice:generalist", "done"],
        // "start" without a startedAt has not begun yet.
        [2, "voice:technical", "queued"],
        [3, "write", "running"],
        [4, "broken", "failed"],
      ],
    );
    const first = progress?.agents[0];
    assert.strictEqual(first?.tokens, 208323);
    assert.strictEqual(first?.toolCalls, 37);
    assert.strictEqual(first?.durationMs, 517684);
    assert.strictEqual(first?.startedAt, 1790921219807);
    assert.strictEqual(progress?.agents[2]?.startedAt, Date.parse("2026-10-02T06:30:00.000Z"));
    assert.strictEqual(progress?.agents[3]?.error, "boom");
  });

  it("ignores malformed and duplicate entries", () => {
    const progress = parseClaudeWorkflowProgress(
      [
        null,
        "phase",
        { type: "workflow_phase", title: "no index" },
        { type: "workflow_agent", index: 1, state: "running", startedAt: 1, label: "a" },
        { type: "workflow_agent", index: 1, state: "done", label: "duplicate" },
        { type: "something_new", index: 9 },
      ],
      null,
    );
    assert.deepStrictEqual(
      progress?.agents.map((agent) => agent.label),
      ["a"],
    );
    assert.deepStrictEqual(progress?.phases, []);
  });

  it("returns undefined when there is nothing to show", () => {
    assert.isUndefined(parseClaudeWorkflowProgress(undefined, "x"));
    assert.isUndefined(parseClaudeWorkflowProgress([], "x"));
    assert.isUndefined(parseClaudeWorkflowProgress([{ type: "other", index: 1 }], "x"));
  });
});

describe("sameWorkflowProgress", () => {
  it("treats identical snapshots as unchanged and token ticks as changed", () => {
    const a = parseClaudeWorkflowProgress(snapshot, "w");
    const b = parseClaudeWorkflowProgress(snapshot, "w");
    assert.isTrue(sameWorkflowProgress(a, b));
    const ticked = parseClaudeWorkflowProgress(
      snapshot.map((entry) =>
        entry.index === 3 && "state" in entry ? { ...entry, tokens: 5 } : entry,
      ),
      "w",
    );
    assert.isFalse(sameWorkflowProgress(a, ticked));
    assert.isFalse(sameWorkflowProgress(a, undefined));
  });
});

describe("claudeSubagentUsage", () => {
  it("maps SDK usage and rejects empty values", () => {
    assert.deepStrictEqual(
      claudeSubagentUsage({ total_tokens: 10, tool_uses: 2, duration_ms: 300 }),
      { totalTokens: 10, toolUses: 2, durationMs: 300 },
    );
    assert.isUndefined(claudeSubagentUsage(undefined));
    assert.isUndefined(claudeSubagentUsage({}));
  });
});

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

// Trimmed from a real saved run: the last live tick only had the two Draft agents.
const runRecord = {
  runId: "wf_d41fcd3a-184",
  taskId: "wtk3bkvpv",
  workflowName: "ui-smoke-test",
  status: "completed",
  phases: [
    { title: "Draft", detail: "two agents name an animal", model: "haiku" },
    { title: "Pick" },
  ],
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Draft" },
    { type: "workflow_phase", index: 2, title: "Pick" },
    {
      type: "workflow_agent",
      index: 1,
      label: "draft-1",
      phaseIndex: 1,
      state: "done",
      startedAt: 1,
    },
    {
      type: "workflow_agent",
      index: 2,
      label: "draft-2",
      phaseIndex: 1,
      state: "done",
      startedAt: 1,
    },
    { type: "workflow_agent", index: 3, label: "pick", phaseIndex: 2, state: "done", startedAt: 2 },
  ],
  totalTokens: 61000,
  totalToolCalls: 0,
  durationMs: 4100,
};

describe("parseClaudeWorkflowRunRecord", () => {
  it("reads the final agents, phase details, and totals for the matching task", () => {
    const snapshot = parseClaudeWorkflowRunRecord(runRecord, "wtk3bkvpv");
    assert.deepStrictEqual(
      snapshot?.workflow.agents.map((agent) => [agent.label, agent.state]),
      [
        ["draft-1", "done"],
        ["draft-2", "done"],
        ["pick", "done"],
      ],
    );
    assert.deepStrictEqual(snapshot?.workflow.phases, [
      { index: 1, title: "Draft", detail: "two agents name an animal" },
      { index: 2, title: "Pick", detail: null },
    ]);
    assert.strictEqual(snapshot?.workflow.name, "ui-smoke-test");
    assert.deepStrictEqual(snapshot?.usage, { totalTokens: 61000, toolUses: 0, durationMs: 4100 });
  });

  it("ignores another task's record", () => {
    assert.isUndefined(parseClaudeWorkflowRunRecord(runRecord, "other-task"));
  });
});

describe("readClaudeWorkflowRunSnapshot", () => {
  it.effect("finds the run under the session's workflows directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const configDir = yield* fileSystem.makeTempDirectoryScoped();
      const cwd = "/Users/me/dev/my-app";
      const sessionDir = path.join(configDir, "projects", "-Users-me-dev-my-app", "session-1");
      yield* fileSystem.makeDirectory(path.join(sessionDir, "workflows"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(sessionDir, "workflows", "wf_other.json"),
        encodeJson({ ...runRecord, taskId: "someone-else" }),
      );
      yield* fileSystem.writeFileString(
        path.join(sessionDir, "workflows", "wf_d41fcd3a-184.json"),
        encodeJson(runRecord),
      );

      const found = yield* readClaudeWorkflowRunSnapshot({
        configDir,
        cwd,
        sessionId: "session-1",
        taskId: "wtk3bkvpv",
      });
      assert.isTrue(Option.isSome(found));
      assert.strictEqual(Option.getOrUndefined(found)?.workflow.agents.length, 3);

      // The session is still found when the project slug does not match the cwd.
      const elsewhere = yield* readClaudeWorkflowRunSnapshot({
        configDir,
        cwd: "/somewhere/else",
        sessionId: "session-1",
        taskId: "wtk3bkvpv",
      });
      assert.isTrue(Option.isSome(elsewhere));

      const missing = yield* readClaudeWorkflowRunSnapshot({
        configDir,
        cwd,
        sessionId: "no-such-session",
        taskId: "wtk3bkvpv",
      });
      assert.isTrue(Option.isNone(missing));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
