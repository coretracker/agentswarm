export interface WorkspaceFileLinkTarget {
  taskId: string;
  executionId: string | null;
  filePath: string;
  line: number | null;
}

const askWorkspaceFileLinkPathRe = /^\/task-workspaces\/\.ask-runs\/([^/]+)\/([^/]+)\/(.+)$/;
const workspaceFileLinkPathRe = /^\/task-workspaces\/([^/]+)\/(.+)$/;

function parseLineFromHash(hash: string): number | null {
  const match = /^#L(\d+)(?:[-:].*)?$/.exec(hash);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function splitLineSuffix(rawFilePath: string): { filePath: string; line: number | null } {
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(rawFilePath);
  if (!match) {
    return { filePath: rawFilePath, line: null };
  }

  return {
    filePath: match[1] ?? rawFilePath,
    line: Number.parseInt(match[2] ?? "", 10)
  };
}

export function parseWorkspaceFileLink(href?: string): WorkspaceFileLinkTarget | null {
  if (!href?.trim()) {
    return null;
  }

  try {
    const url = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const askMatch = askWorkspaceFileLinkPathRe.exec(url.pathname);
    if (askMatch) {
      const parsedPath = splitLineSuffix(decodeURIComponent(askMatch[3] ?? ""));
      return {
        taskId: askMatch[1] ?? "",
        executionId: askMatch[2] ?? "",
        filePath: parsedPath.filePath,
        line: parseLineFromHash(url.hash) ?? parsedPath.line
      };
    }

    const match = workspaceFileLinkPathRe.exec(url.pathname);
    if (!match) {
      return null;
    }

    const parsedPath = splitLineSuffix(decodeURIComponent(match[2] ?? ""));
    return {
      taskId: match[1] ?? "",
      executionId: null,
      filePath: parsedPath.filePath,
      line: parseLineFromHash(url.hash) ?? parsedPath.line
    };
  } catch {
    return null;
  }
}
