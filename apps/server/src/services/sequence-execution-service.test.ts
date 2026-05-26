import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SequenceRun, TaskRun } from "@agentswarm/shared-types";
import { SequenceExecutionService } from "./sequence-execution-service.js";

const createTaskRun = (input: { id: string; taskId: string; changeOutcome: "changed" | "no_change" }): TaskRun => ({
  id: input.id,
  taskId: input.taskId,
  action: "build",
  provider: "codex",
  providerProfile: "high",
  modelOverride: null,
  branchName: "feature/test",
  status: "succeeded",
  startedAt: "2026-05-26T00:00:00.000Z",
  finishedAt: "2026-05-26T00:00:01.000Z",
  summary: "done",
  changeOutcome: input.changeOutcome,
  errorMessage: null,
  changeProposalCheckpointRef: null,
  changeProposalUntrackedPaths: null,
  logs: []
});

const createSequenceRun = (stepCount: number): SequenceRun => ({
  id: "sequence-run-1",
  sequenceId: "sequence-1",
  taskId: "task-1",
  status: "running",
  failPolicy: "fail_fast",
  stepCount,
  failedStepIndex: null,
  startedAt: "2026-05-26T00:00:00.000Z",
  finishedAt: null,
  steps: Array.from({ length: stepCount }, (_entry, index) => ({
    index,
    prompt: `step-${index + 1}`,
    state: "pending",
    taskRunId: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null
  }))
});

describe("SequenceExecutionService", () => {
  it("continues to the next step after a build step with no code changes", async () => {
    let run = createSequenceRun(2);
    const taskRuns = [createTaskRun({ id: "run-1", taskId: "task-1", changeOutcome: "no_change" }), createTaskRun({
      id: "run-2",
      taskId: "task-1",
      changeOutcome: "changed"
    })];
    const logs: string[] = [];
    let listRunsCallCount = 0;
    let getTaskCallCount = 0;
    let triggerActionCount = 0;

    const sequenceStore = {
      getRun: async () => run,
      updateRun: async (_runId: string, patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps">>) => {
        run = {
          ...run,
          ...patch,
          steps: patch.steps ?? run.steps
        };
        return run;
      }
    };
    const taskStore = {
      appendLog: async (_taskId: string, line: string) => {
        logs.push(line);
      },
      listRuns: async () => {
        listRunsCallCount += 1;
        return listRunsCallCount === 1 ? [taskRuns[0]!] : [taskRuns[0]!, taskRuns[1]!];
      },
      getRun: async (runId: string) => taskRuns.find((runItem) => runItem.id === runId) ?? null,
      getTask: async () => {
        getTaskCallCount += 1;
        return {
          id: "task-1",
          status: getTaskCallCount === 1 ? "building" : "open",
          hasPendingCheckpoint: false,
          activeInteractiveSession: false
        };
      }
    };
    const scheduler = {
      triggerAction: async () => {
        triggerActionCount += 1;
        return true;
      }
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>()
    });

    assert.equal(run.status, "succeeded");
    assert.equal(run.steps[0]?.state, "succeeded");
    assert.equal(run.steps[1]?.state, "succeeded");
    assert.equal(triggerActionCount, 1);
    assert.ok(getTaskCallCount >= 2);
    assert.ok(logs.includes("No changes needed for this step. Continuing."));
  });
});
