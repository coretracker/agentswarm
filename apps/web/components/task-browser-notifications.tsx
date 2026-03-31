"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { Task, TaskRun } from "@agentswarm/shared-types";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { api } from "../src/api/client";
import { useSocket } from "../src/hooks/useSocket";

interface TaskDeletedPayload {
  id: string;
}

type BrowserNotificationPermission = NotificationPermission | "unsupported";

function getNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

function getOpenTaskIdFromPathname(pathname: string): string | null {
  const match = /^\/tasks\/([^/]+)(?:\/interactive)?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function buildTaskNotificationBody(task: Task | null, taskId: string): string {
  if (!task) {
    return `Task ${taskId}`;
  }

  return task.repoName?.trim() ? `${task.title}\n${task.repoName}` : task.title;
}

function getRunNotificationTitle(run: TaskRun): string {
  const actionLabel = run.action === "ask" ? "Ask" : "Build";

  if (run.status === "failed") {
    return `${actionLabel} Failed`;
  }

  if (run.status === "cancelled") {
    return `${actionLabel} Cancelled`;
  }

  return `${actionLabel} Completed`;
}

export function TaskBrowserNotifications() {
  const router = useRouter();
  const pathname = usePathname();
  const socket = useSocket();
  const { can, session } = useAuth();
  const [permission, setPermission] = useState<BrowserNotificationPermission>(getNotificationPermission);
  const canReadTasks = can("task:read");
  const canListTasks = can("task:list");
  const openTaskId = useMemo(() => getOpenTaskIdFromPathname(pathname), [pathname]);
  const knownTasksRef = useRef(new Map<string, Task>());
  const knownRunsRef = useRef(new Map<string, Pick<TaskRun, "taskId" | "status" | "finishedAt">>());

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, [session?.user.id]);

  useEffect(() => {
    if (!session || !canReadTasks) {
      knownTasksRef.current = new Map();
      knownRunsRef.current = new Map();
      return;
    }

    let cancelled = false;

    const seedKnownTasks = async () => {
      try {
        if (canListTasks) {
          const tasks = await api.listTasks();
          if (cancelled) {
            return;
          }

          knownTasksRef.current = new Map(tasks.map((task) => [task.id, task]));
          return;
        }

        if (openTaskId) {
          const task = await api.getTask(openTaskId);
          if (cancelled) {
            return;
          }

          knownTasksRef.current = new Map([[task.id, task]]);
          return;
        }

        knownTasksRef.current = new Map();
      } catch {
        if (!cancelled) {
          knownTasksRef.current = new Map();
        }
      }
    };

    void seedKnownTasks();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id, canListTasks, canReadTasks, openTaskId]);

  const openNotificationTarget = (href: string) => {
    if (typeof window !== "undefined") {
      window.focus();
    }
    router.push(href);
  };

  const showNotification = (title: string, body: string, href: string, tag: string) => {
    if (permission !== "granted" || typeof Notification === "undefined") {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        tag,
        icon: "/logo.svg"
      });
      notification.onclick = () => {
        notification.close();
        openNotificationTarget(href);
      };
    } catch {
      // Ignore browser notification errors; the app keeps working without them.
    }
  };

  useEffect(() => {
    if (!socket || !session || !canReadTasks) {
      return;
    }

    const onTaskCreated = (task: Task) => {
      knownTasksRef.current.set(task.id, task);
    };

    const onTaskUpdated = (task: Task) => {
      knownTasksRef.current.set(task.id, task);
    };

    const onTaskDeleted = (payload: TaskDeletedPayload) => {
      knownTasksRef.current.delete(payload.id);
    };

    const onTaskRunUpdated = (run: TaskRun) => {
      const previous = knownRunsRef.current.get(run.id);
      knownRunsRef.current.set(run.id, {
        taskId: run.taskId,
        status: run.status,
        finishedAt: run.finishedAt
      });

      if (run.action !== "build" && run.action !== "ask") {
        return;
      }

      if (!run.finishedAt || run.status === "running") {
        return;
      }

      if (openTaskId === run.taskId) {
        return;
      }

      if (previous?.status === run.status && previous?.finishedAt === run.finishedAt) {
        return;
      }

      const task = knownTasksRef.current.get(run.taskId) ?? null;
      showNotification(
        getRunNotificationTitle(run),
        buildTaskNotificationBody(task, run.taskId),
        `/tasks/${run.taskId}`,
        `task-run-${run.id}`
      );
    };

    socket.on("task:created", onTaskCreated);
    socket.on("task:updated", onTaskUpdated);
    socket.on("task:deleted", onTaskDeleted);
    socket.on("task:run_updated", onTaskRunUpdated);

    return () => {
      socket.off("task:created", onTaskCreated);
      socket.off("task:updated", onTaskUpdated);
      socket.off("task:deleted", onTaskDeleted);
      socket.off("task:run_updated", onTaskRunUpdated);
    };
  }, [socket, session, canReadTasks, permission, openTaskId, router]);

  if (permission !== "default" || !canReadTasks) {
    return null;
  }

  return (
    <Button
      icon={<BellOutlined />}
      onClick={async () => {
        if (typeof Notification === "undefined") {
          setPermission("unsupported");
          return;
        }

        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
      }}
    >
      Enable Notifications
    </Button>
  );
}
