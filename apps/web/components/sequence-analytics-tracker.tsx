"use client";

import { useEffect, useRef } from "react";
import type { SequenceRun, TaskRun } from "@agentswarm/shared-types";
import { useSocket } from "../src/hooks/useSocket";
import { trackEvent } from "../src/utils/analytics";
import { useAuth } from "./auth-provider";

interface RunSnapshot {
  status: SequenceRun["status"];
  failedStepIndex: number | null;
  waitingForApprovalAfterStepIndex: number | null;
  stepStates: SequenceRun["steps"][number]["state"][];
}

export function SequenceAnalyticsTracker() {
  const socket = useSocket();
  const { can } = useAuth();
  const canReadTasks = can("task:read");
  const snapshotsRef = useRef(new Map<string, RunSnapshot>());
  const taskRunsByIdRef = useRef(new Map<string, Pick<TaskRun, "action" | "changeOutcome">>());

  useEffect(() => {
    if (!socket || !canReadTasks) {
      return;
    }

    const onRunUpdated = (run: SequenceRun) => {
      const previous = snapshotsRef.current.get(run.id);
      const currentStepStates = run.steps.map((step) => step.state);

      if (!previous && run.status === "running") {
        trackEvent("sequence_run_started", { step_count: run.stepCount });
      }

      run.steps.forEach((step, index) => {
        const previousState = previous?.stepStates[index];
        if (step.state === "succeeded" && previousState !== "succeeded") {
          trackEvent("sequence_step_completed", {
            step_count: run.stepCount,
            step_index: index
          });

          const taskRunId = step.taskRunId?.trim();
          const taskRun = taskRunId ? taskRunsByIdRef.current.get(taskRunId) : undefined;
          const nextStepIndex = index + 1;
          if (taskRun?.action === "build" && taskRun.changeOutcome === "no_change") {
            trackEvent("sequence_no_change", {
              step_count: run.stepCount,
              step_index: index
            });
          }
          if (nextStepIndex < run.stepCount && run.executionMode === "auto_apply_changes") {
            trackEvent("sequence_auto_advanced", {
              step_count: run.stepCount,
              from_step_index: index,
              to_step_index: nextStepIndex
            });
          }
        }

        if (step.state === "failed" && previousState !== "failed") {
          trackEvent("sequence_step_failed", {
            step_count: run.stepCount,
            failed_step_index: index
          });
        }
      });

      if (run.status === "failed" && previous?.status !== "failed") {
        const failedStep = run.failedStepIndex !== null ? run.steps[run.failedStepIndex] : null;
        trackEvent("sequence_stalled", {
          step_count: run.stepCount,
          failed_step_index: run.failedStepIndex,
          reason: failedStep?.errorMessage ?? null
        });
        trackEvent("sequence_run_failed", {
          step_count: run.stepCount,
          failed_step_index: run.failedStepIndex
        });
      }

      if (run.status === "succeeded" && previous?.status !== "succeeded") {
        trackEvent("sequence_run_succeeded", { step_count: run.stepCount });
      }

      if (run.status === "waiting_for_approval" && previous?.status !== "waiting_for_approval") {
        trackEvent("sequence_paused_for_approval", {
          step_count: run.stepCount,
          after_step_index: run.waitingForApprovalAfterStepIndex
        });
      }

      if (run.status === "running" && previous?.status === "waiting_for_approval") {
        trackEvent("sequence_resumed", {
          step_count: run.stepCount,
          after_step_index: previous.waitingForApprovalAfterStepIndex
        });
      }

      snapshotsRef.current.set(run.id, {
        status: run.status,
        failedStepIndex: run.failedStepIndex,
        waitingForApprovalAfterStepIndex: run.waitingForApprovalAfterStepIndex,
        stepStates: currentStepStates
      });
    };
    const onTaskRunUpdated = (run: TaskRun) => {
      taskRunsByIdRef.current.set(run.id, {
        action: run.action,
        changeOutcome: run.changeOutcome ?? null
      });
    };

    socket.on("sequence:run_updated", onRunUpdated);
    socket.on("task:run_updated", onTaskRunUpdated);
    return () => {
      socket.off("sequence:run_updated", onRunUpdated);
      socket.off("task:run_updated", onTaskRunUpdated);
    };
  }, [socket, canReadTasks]);

  return null;
}
