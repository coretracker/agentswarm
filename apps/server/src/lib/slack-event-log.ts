import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const resolveDefaultSlackEventLogPath = (): string => {
  const cwd = process.cwd();
  const cwdName = path.basename(cwd);
  const parentName = path.basename(path.dirname(cwd));
  const baseDir = cwdName === "server" && parentName === "apps" ? path.resolve(cwd, "..", "..") : cwd;
  return path.resolve(baseDir, "logs", "slack-events.log");
};

const DEFAULT_SLACK_EVENT_LOG_PATH = resolveDefaultSlackEventLogPath();
let slackEventLogReady: Promise<void> | null = null;
let slackEventLogLastError: string | null = null;

export const resolveSlackEventLogPath = (): string =>
  process.env.SLACK_EVENT_LOG_PATH?.trim() || DEFAULT_SLACK_EVENT_LOG_PATH;

export const getSlackEventLogLastError = (): string | null => slackEventLogLastError;

const ensureSlackEventLogDir = async (): Promise<void> => {
  if (slackEventLogReady) {
    return slackEventLogReady;
  }

  slackEventLogReady = mkdir(path.dirname(resolveSlackEventLogPath()), { recursive: true }).catch(() => undefined);
  return slackEventLogReady;
};

export const appendSlackEventLog = async (kind: string, data: Record<string, unknown>): Promise<void> => {
  try {
    await ensureSlackEventLogDir();
    await appendFile(
      resolveSlackEventLogPath(),
      `${new Date().toISOString()} ${kind} ${JSON.stringify(data)}\n`,
      "utf8"
    );
    slackEventLogLastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    slackEventLogLastError = `${new Date().toISOString()} ${message}`;
  }
};
