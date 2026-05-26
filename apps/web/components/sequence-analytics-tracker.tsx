"use client";

import { useEffect, useRef } from "react";
import type { SequenceRun } from "@agentswarm/shared-types";
import { useSocket } from "../src/hooks/useSocket";
import { trackEvent } from "../src/utils/analytics";
import { useAuth } from "./auth-provider";

interface RunSnapshot {
  status: SequenceRun["status"];
  failedStepIndex: number | null;
  stepStates: SequenceRun["steps"][number]["state"][];
}

export function SequenceAnalyticsTracker() {
  const socket = useSocket();
  const { can } = useAuth();
  const canReadTasks = can("task:read");
  const snapshotsRef = useRef(new Map<string, RunSnapshot>());

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
        if (step.state === "failed" && previousState !== "failed") {
          trackEvent("sequence_step_failed", {
            step_count: run.stepCount,
            failed_step_index: index
          });
        }
      });

      if (run.status === "failed" && previous?.status !== "failed") {
        trackEvent("sequence_run_failed", {
          step_count: run.stepCount,
          failed_step_index: run.failedStepIndex
        });
      }

      if (run.status === "succeeded" && previous?.status !== "succeeded") {
        trackEvent("sequence_run_succeeded", { step_count: run.stepCount });
      }

      snapshotsRef.current.set(run.id, {
        status: run.status,
        failedStepIndex: run.failedStepIndex,
        stepStates: currentStepStates
      });
    };

    socket.on("sequence:run_updated", onRunUpdated);
    return () => {
      socket.off("sequence:run_updated", onRunUpdated);
    };
  }, [socket, canReadTasks]);

  return null;
}
