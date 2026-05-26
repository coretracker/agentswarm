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

const createSequenceRun = (stepCount: number, executionMode: SequenceRun["executionMode"] = "auto_apply_changes"): SequenceRun => ({
  id: "sequence-run-1",
  sequenceId: "sequence-1",
  taskId: "task-1",
  status: "running",
  executionMode,
  failPolicy: "fail_fast",
  stepCount,
  waitingForApprovalAfterStepIndex: null,
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
      updateRun: async (
        _runId: string,
        patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
      ) => {
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
      listChangeProposals: async () => [],
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
    const spawner = {
      applyChangeProposal: async () => ({ ok: true as const })
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never, spawner as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>()
    });

    assert.equal(run.status, "succeeded");
    assert.equal(run.waitingForApprovalAfterStepIndex, null);
    assert.equal(run.steps[0]?.state, "succeeded");
    assert.equal(run.steps[1]?.state, "succeeded");
    assert.equal(triggerActionCount, 1);
    assert.ok(getTaskCallCount >= 2);
    assert.ok(logs.includes("No changes needed for this step. Continuing."));
  });

  it("pauses after each succeeded step when approval mode is enabled", async () => {
    let run = createSequenceRun(2, "approve_before_continuing");
    const taskRuns = [createTaskRun({ id: "run-1", taskId: "task-1", changeOutcome: "no_change" })];
    const logs: string[] = [];
    let listRunsCallCount = 0;
    let triggerActionCount = 0;

    const sequenceStore = {
      getRun: async () => run,
      updateRun: async (
        _runId: string,
        patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
      ) => {
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
      listChangeProposals: async () => [],
      listRuns: async () => {
        listRunsCallCount += 1;
        return listRunsCallCount === 1 ? [taskRuns[0]!] : taskRuns;
      },
      getRun: async (runId: string) => taskRuns.find((runItem) => runItem.id === runId) ?? null
    };
    const scheduler = {
      triggerAction: async () => {
        triggerActionCount += 1;
        return true;
      }
    };
    const spawner = {
      applyChangeProposal: async () => ({ ok: true as const })
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never, spawner as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>()
    });

    assert.equal(run.status, "waiting_for_approval");
    assert.equal(run.waitingForApprovalAfterStepIndex, 0);
    assert.equal(run.steps[0]?.state, "succeeded");
    assert.equal(run.steps[1]?.state, "pending");
    assert.equal(triggerActionCount, 0);
    assert.ok(logs.includes("No changes needed for this step. Waiting for approval to continue."));
    assert.ok(logs.some((line) => line.includes("Awaiting approval to continue")));
  });

  it("resumes from the next pending step after approval", async () => {
    let run = createSequenceRun(2, "approve_before_continuing");
    run.status = "waiting_for_approval";
    run.waitingForApprovalAfterStepIndex = 0;
    run.steps[0] = {
      ...run.steps[0]!,
      state: "succeeded",
      taskRunId: "run-1",
      startedAt: "2026-05-26T00:00:00.000Z",
      finishedAt: "2026-05-26T00:00:01.000Z"
    };
    const taskRuns = [
      createTaskRun({ id: "run-1", taskId: "task-1", changeOutcome: "changed" }),
      createTaskRun({ id: "run-2", taskId: "task-1", changeOutcome: "changed" })
    ];
    let triggerActionCount = 0;

    const sequenceStore = {
      getRun: async () => run,
      updateRun: async (
        _runId: string,
        patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
      ) => {
        run = {
          ...run,
          ...patch,
          steps: patch.steps ?? run.steps
        };
        return run;
      }
    };
    const taskStore = {
      appendLog: async () => undefined,
      listChangeProposals: async () => [],
      listRuns: async () => taskRuns,
      getRun: async (runId: string) => taskRuns.find((runItem) => runItem.id === runId) ?? null,
      getTask: async () => ({
        id: "task-1",
        status: "open",
        hasPendingCheckpoint: false,
        activeInteractiveSession: false
      })
    };
    const scheduler = {
      triggerAction: async () => {
        triggerActionCount += 1;
        return true;
      }
    };
    const spawner = {
      applyChangeProposal: async () => ({ ok: true as const })
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never, spawner as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>(["run-1"]),
      startStepIndex: 1
    });

    assert.equal(run.status, "succeeded");
    assert.equal(run.waitingForApprovalAfterStepIndex, null);
    assert.equal(run.steps[1]?.state, "succeeded");
    assert.equal(run.steps[1]?.taskRunId, "run-2");
    assert.equal(triggerActionCount, 1);
  });

  it("auto-applies pending checkpoints in auto mode before continuing", async () => {
    let run = createSequenceRun(2, "auto_apply_changes");
    const taskRuns = [
      createTaskRun({ id: "run-1", taskId: "task-1", changeOutcome: "changed" }),
      createTaskRun({ id: "run-2", taskId: "task-1", changeOutcome: "changed" })
    ];
    let triggerActionCount = 0;
    let applyCount = 0;
    const logs: string[] = [];
    let listRunsCallCount = 0;

    const sequenceStore = {
      getRun: async () => run,
      updateRun: async (
        _runId: string,
        patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
      ) => {
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
      listChangeProposals: async () => [{ id: "cp-1", taskId: "task-1", status: "pending" }],
      listRuns: async () => {
        listRunsCallCount += 1;
        return listRunsCallCount === 1 ? [taskRuns[0]!] : [taskRuns[0]!, taskRuns[1]!];
      },
      getRun: async (runId: string) => taskRuns.find((runItem) => runItem.id === runId) ?? null,
      getTask: async () => ({
        id: "task-1",
        status: "open",
        hasPendingCheckpoint: false,
        activeInteractiveSession: false
      })
    };
    const scheduler = {
      triggerAction: async () => {
        triggerActionCount += 1;
        return true;
      }
    };
    const spawner = {
      applyChangeProposal: async () => {
        applyCount += 1;
        return { ok: true as const };
      }
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never, spawner as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>()
    });

    assert.equal(run.status, "succeeded");
    assert.equal(applyCount, 1);
    assert.equal(triggerActionCount, 1);
    assert.ok(logs.some((line) => line.includes("auto-applied checkpoint")));
  });

  it("waits for checkpoint resolution when auto-apply fails", async () => {
    let run = createSequenceRun(2, "auto_apply_changes");
    const taskRuns = [createTaskRun({ id: "run-1", taskId: "task-1", changeOutcome: "changed" })];
    let triggerActionCount = 0;
    const logs: string[] = [];

    const sequenceStore = {
      getRun: async () => run,
      updateRun: async (
        _runId: string,
        patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
      ) => {
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
      listChangeProposals: async () => [{ id: "cp-1", taskId: "task-1", status: "pending" }],
      listRuns: async () => taskRuns,
      getRun: async (runId: string) => taskRuns.find((runItem) => runItem.id === runId) ?? null,
      getTask: async () => ({
        id: "task-1",
        status: "open",
        hasPendingCheckpoint: true,
        activeInteractiveSession: false
      })
    };
    const scheduler = {
      triggerAction: async () => {
        triggerActionCount += 1;
        return true;
      }
    };
    const spawner = {
      applyChangeProposal: async () => ({ ok: false as const, message: "conflict" })
    };

    const service = new SequenceExecutionService(sequenceStore as never, taskStore as never, scheduler as never, spawner as never);
    await service.runSteps({
      runId: run.id,
      taskId: "task-1",
      action: "build",
      stepPrompts: ["step-1", "step-2"],
      initialKnownRunIds: new Set<string>()
    });

    assert.equal(run.status, "waiting_for_checkpoint_resolution");
    assert.equal(run.steps[0]?.state, "succeeded");
    assert.equal(run.steps[1]?.state, "pending");
    assert.equal(triggerActionCount, 0);
    assert.ok(logs.some((line) => line.includes("could not auto-apply checkpoint")));
  });
});
