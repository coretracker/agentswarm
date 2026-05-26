import type { SequenceRunStep, TaskAction } from "@agentswarm/shared-types";
import type { SchedulerService } from "./scheduler.js";
import type { SequenceStore } from "./sequence-store.js";
import type { TaskStore } from "./task-store.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const RUN_POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 8 * 60 * 60 * 1000;

export class SequenceExecutionService {
  constructor(
    private readonly sequenceStore: SequenceStore,
    private readonly taskStore: TaskStore,
    private readonly scheduler: SchedulerService
  ) {}

  async initializeRun(sequenceId: string, taskId: string, stepPrompts: string[]): Promise<{ runId: string; steps: SequenceRunStep[] }> {
    const run = await this.sequenceStore.createRun({ sequenceId, taskId, stepCount: stepPrompts.length, stepPrompts });
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
  }): Promise<void> {
    let run = await this.sequenceStore.getRun(input.runId);
    if (!run) {
      return;
    }
    let knownRunIds = new Set(input.initialKnownRunIds);

    for (let stepIndex = 0; stepIndex < input.stepPrompts.length; stepIndex += 1) {
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
      run = (await this.sequenceStore.updateRun(run.id, { steps: runningSteps })) ?? run;
      await this.taskStore.appendLog(input.taskId, `Sequence step ${stepIndex + 1}/${input.stepPrompts.length} started.`);

      let taskRunId: string | null = null;
      if (stepIndex > 0) {
        const accepted = await this.scheduler.triggerAction(input.taskId, input.action, {
          content: input.stepPrompts[stepIndex]!
        });
        if (!accepted) {
          await this.failAtStep(run, input.taskId, stepIndex, "Step could not be started. The task is currently unavailable for execution.");
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
    }

    await this.sequenceStore.updateRun(run.id, {
      status: "succeeded",
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
}
