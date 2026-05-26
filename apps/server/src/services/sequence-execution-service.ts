import { isActiveTaskStatus, isQueuedTaskStatus, type SequenceExecutionMode, type SequenceRunStep, type TaskAction } from "@agentswarm/shared-types";
import type { SchedulerService } from "./scheduler.js";
import type { SequenceStore } from "./sequence-store.js";
import type { TaskStore } from "./task-store.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const RUN_POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 8 * 60 * 60 * 1000;
const TASK_READY_WAIT_MS = 5 * 60 * 1000;

export class SequenceExecutionService {
  constructor(
    private readonly sequenceStore: SequenceStore,
    private readonly taskStore: TaskStore,
    private readonly scheduler: SchedulerService
  ) {}

  async initializeRun(
    sequenceId: string,
    taskId: string,
    stepPrompts: string[],
    executionMode: SequenceExecutionMode = "auto_apply_changes"
  ): Promise<{ runId: string; steps: SequenceRunStep[] }> {
    const run = await this.sequenceStore.createRun({ sequenceId, taskId, stepCount: stepPrompts.length, stepPrompts, executionMode });
    await this.taskStore.patchTask(taskId, { sequenceRunId: run.id });
    return { runId: run.id, steps: run.steps };
  }

  async failRunImmediately(input: { runId: string; failedStepIndex: number; errorMessage: string }): Promise<void> {
    const run = await this.sequenceStore.getRun(input.runId);
    if (!run) {
      return;
    }
    const now = new Date().toISOString();
    const steps = run.steps.map((step, index) => {
      if (index < input.failedStepIndex) {
        return step;
      }
      if (index === input.failedStepIndex) {
        return {
          ...step,
          state: "failed" as const,
          errorMessage: input.errorMessage,
          finishedAt: now
        };
      }
      return {
        ...step,
        state: "skipped" as const,
        finishedAt: now
      };
    });
    await this.sequenceStore.updateRun(input.runId, {
      status: "failed",
      failedStepIndex: input.failedStepIndex,
      waitingForApprovalAfterStepIndex: null,
      finishedAt: now,
      steps
    });
  }

  async runSteps(input: {
    runId: string;
    taskId: string;
    action: TaskAction;
    stepPrompts: string[];
    initialKnownRunIds: Set<string>;
    startStepIndex?: number;
  }): Promise<void> {
    let run = await this.sequenceStore.getRun(input.runId);
    if (!run) {
      return;
    }
    let knownRunIds = new Set(input.initialKnownRunIds);
    const startStepIndex =
      typeof input.startStepIndex === "number" && Number.isFinite(input.startStepIndex)
        ? Math.max(0, Math.min(Math.floor(input.startStepIndex), input.stepPrompts.length))
        : 0;

    for (let stepIndex = startStepIndex; stepIndex < input.stepPrompts.length; stepIndex += 1) {
      const startedAt = new Date().toISOString();
      const runningSteps = run.steps.map((step, index) =>
        index === stepIndex
          ? {
              ...step,
              state: "running" as const,
              startedAt
            }
          : step
      );
      run = (await this.sequenceStore.updateRun(run.id, {
        status: "running",
        waitingForApprovalAfterStepIndex: null,
        steps: runningSteps
      })) ?? run;
      await this.taskStore.appendLog(input.taskId, `Sequence step ${stepIndex + 1}/${input.stepPrompts.length} started.`);

      let taskRunId: string | null = null;
      if (stepIndex > 0) {
        const taskReadyResult = await this.waitForTaskReady(input.taskId);
        if (!taskReadyResult.ready) {
          await this.failAtStep(run, input.taskId, stepIndex, taskReadyResult.reason);
          return;
        }

        const accepted = await this.scheduler.triggerAction(input.taskId, input.action, {
          content: input.stepPrompts[stepIndex]!
        });
        if (!accepted) {
          await this.failAtStep(run, input.taskId, stepIndex, await this.buildStepStartBlockedMessage(input.taskId));
          return;
        }
      }

      try {
        const taskRun = await this.waitForNewTaskRun(input.taskId, knownRunIds);
        taskRunId = taskRun.id;
        knownRunIds.add(taskRun.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not detect the step run.";
        await this.failAtStep(run, input.taskId, stepIndex, message);
        return;
      }

      run = await this.updateStepTaskRunId(run.id, stepIndex, taskRunId, startedAt);
      let completedRun: Awaited<ReturnType<SequenceExecutionService["waitForTaskRunCompletion"]>>;
      try {
        completedRun = await this.waitForTaskRunCompletion(taskRunId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Step run did not finish.";
        await this.failAtStep(run, input.taskId, stepIndex, message);
        return;
      }
      if (!completedRun) {
        await this.failAtStep(run, input.taskId, stepIndex, "Step run could not be loaded.");
        return;
      }

      if (completedRun.status !== "succeeded") {
        const errorMessage = completedRun.errorMessage?.trim() || `Step run ended with status: ${completedRun.status}.`;
        await this.failAtStep(run, input.taskId, stepIndex, errorMessage);
        return;
      }

      const finishedAt = new Date().toISOString();
      const succeededSteps = run.steps.map((step, index) =>
        index === stepIndex
          ? {
              ...step,
              state: "succeeded" as const,
              taskRunId,
              errorMessage: null,
              startedAt: step.startedAt ?? startedAt,
              finishedAt
            }
          : step
      );
      run = (await this.sequenceStore.updateRun(run.id, { steps: succeededSteps })) ?? run;
      await this.taskStore.appendLog(input.taskId, `Sequence step ${stepIndex + 1}/${input.stepPrompts.length} succeeded.`);
      if (completedRun.action === "build" && completedRun.changeOutcome === "no_change" && stepIndex + 1 < input.stepPrompts.length) {
        if (run.executionMode === "approve_before_continuing") {
          await this.taskStore.appendLog(input.taskId, "No changes needed for this step. Waiting for approval to continue.");
        } else {
          await this.taskStore.appendLog(input.taskId, "No changes needed for this step. Continuing.");
        }
      }

      if (run.executionMode === "approve_before_continuing" && stepIndex + 1 < input.stepPrompts.length) {
        run = (await this.sequenceStore.updateRun(run.id, {
          status: "waiting_for_approval",
          waitingForApprovalAfterStepIndex: stepIndex
        })) ?? run;
        await this.taskStore.appendLog(
          input.taskId,
          `Sequence paused after step ${stepIndex + 1}/${input.stepPrompts.length}. Awaiting approval to continue.`
        );
        return;
      }
    }

    await this.sequenceStore.updateRun(run.id, {
      status: "succeeded",
      waitingForApprovalAfterStepIndex: null,
      failedStepIndex: null,
      finishedAt: new Date().toISOString()
    });
  }

  private async updateStepTaskRunId(runId: string, stepIndex: number, taskRunId: string, startedAt: string) {
    const current = await this.sequenceStore.getRun(runId);
    if (!current) {
      throw new Error("Sequence run no longer exists.");
    }
    const steps = current.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            state: "running" as const,
            taskRunId,
            startedAt: step.startedAt ?? startedAt
          }
        : step
    );
    return (await this.sequenceStore.updateRun(runId, { steps })) ?? current;
  }

  private async failAtStep(run: { id: string; steps: SequenceRunStep[] }, taskId: string, stepIndex: number, errorMessage: string): Promise<void> {
    const finishedAt = new Date().toISOString();
    const nextSteps = run.steps.map((step, index) => {
      if (index < stepIndex) {
        return step;
      }
      if (index === stepIndex) {
        return {
          ...step,
          state: "failed" as const,
          errorMessage,
          finishedAt
        };
      }
      return {
        ...step,
        state: "skipped" as const,
        finishedAt
      };
    });
    await this.sequenceStore.updateRun(run.id, {
      status: "failed",
      failedStepIndex: stepIndex,
      waitingForApprovalAfterStepIndex: null,
      finishedAt,
      steps: nextSteps
    });
    await this.taskStore.appendLog(taskId, `Sequence step ${stepIndex + 1} failed: ${errorMessage}`);
  }

  private async waitForNewTaskRun(taskId: string, knownRunIds: Set<string>) {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const runs = await this.taskStore.listRuns(taskId);
      const next = runs.find((run) => !knownRunIds.has(run.id));
      if (next) {
        return next;
      }
      await sleep(RUN_POLL_INTERVAL_MS);
    }
    throw new Error("Timed out waiting for the step run to start.");
  }

  private async waitForTaskRunCompletion(runId: string) {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const run = await this.taskStore.getRun(runId);
      if (!run) {
        return null;
      }
      if (run.status !== "running") {
        return run;
      }
      await sleep(RUN_POLL_INTERVAL_MS);
    }
    throw new Error("Timed out waiting for the step run to finish.");
  }

  private async waitForTaskReady(taskId: string): Promise<{ ready: true } | { ready: false; reason: string }> {
    const deadline = Date.now() + TASK_READY_WAIT_MS;
    while (Date.now() < deadline) {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        return {
          ready: false,
          reason: "Step could not be started because the task could not be loaded."
        };
      }

      if (task.status === "archived") {
        return {
          ready: false,
          reason: "Step could not be started because the task is archived."
        };
      }

      if (!isActiveTaskStatus(task.status) && !isQueuedTaskStatus(task.status)) {
        return { ready: true };
      }

      await sleep(RUN_POLL_INTERVAL_MS);
    }

    return {
      ready: false,
      reason: "Timed out waiting for the previous step to become ready for the next run."
    };
  }

  private async buildStepStartBlockedMessage(taskId: string): Promise<string> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return "Step could not be started because the task could not be loaded.";
    }

    if (task.status === "archived") {
      return "Step could not be started because the task is archived.";
    }

    if (task.hasPendingCheckpoint) {
      return "Step could not be started because a pending checkpoint must be reviewed first.";
    }

    if (task.activeInteractiveSession) {
      return "Step could not be started because an interactive terminal session is active.";
    }

    return "Step could not be started. The task is currently unavailable for execution.";
  }
}
