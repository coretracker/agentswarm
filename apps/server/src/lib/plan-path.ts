import path from "node:path";
import type { Task } from "@agentswarm/shared-types";

const sanitizePathSegment = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\\+/g, "/")
    .replace(/\/+$/g, "")
    .replace(/^\/+/, "")
    .replace(/\/+/, "/");
  const safe = cleaned
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return safe || "plans";
};

const resolveTaskPlansBaseDir = (
  task: Pick<Task, "id" | "repoName" | "repoId" | "repoPlansDir">,
  localPlansRoot: string
): string => {
  const repoSlug = sanitizePathSegment(task.repoName || task.repoId || "repo").replace(/\//g, "-");
  const plansDir = sanitizePathSegment(task.repoPlansDir || "plans");
  return path.join(localPlansRoot, repoSlug, plansDir, task.id);
};

export const resolveLocalPlanDirectory = (
  task: Pick<Task, "id" | "repoName" | "repoId" | "repoPlansDir">,
  localPlansRoot: string
): string => resolveTaskPlansBaseDir(task, localPlansRoot);

export const resolveLocalPlanRevisionPath = (
  task: Pick<Task, "id" | "repoName" | "repoId" | "repoPlansDir">,
  localPlansRoot: string,
  revisionKey: string
): string => {
  const safeRevisionKey = sanitizePathSegment(revisionKey).replace(/\//g, "-");
  return path.join(resolveTaskPlansBaseDir(task, localPlansRoot), `${safeRevisionKey}.md`);
};

export const resolveLocalPlanPath = (
  task: Pick<Task, "id" | "planPath" | "repoName" | "repoId" | "repoPlansDir">,
  localPlansRoot: string
): string => {
  if (task.planPath?.startsWith(localPlansRoot)) {
    return task.planPath;
  }

  return resolveLocalPlanRevisionPath(task, localPlansRoot, "current");
};
