import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SLACK_EVENT_LOG_PATH = path.resolve(process.cwd(), "logs", "slack-events.log");
let slackEventLogReady: Promise<void> | null = null;

export const resolveSlackEventLogPath = (): string =>
  process.env.SLACK_EVENT_LOG_PATH?.trim() || DEFAULT_SLACK_EVENT_LOG_PATH;

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
  } catch {
    // Never break Slack flows due to diagnostic logging failure.
  }
};
