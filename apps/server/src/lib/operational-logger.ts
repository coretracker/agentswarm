import type { FastifyBaseLogger } from "fastify";

type OperationalLogLevel = "info" | "warn" | "error";
type OperationalLogData = Record<string, unknown>;

export interface OperationalLogger {
  info(type: string, event: string, message: string, data?: OperationalLogData): void;
  warn(type: string, event: string, message: string, data?: OperationalLogData): void;
  error(type: string, event: string, message: string, data?: OperationalLogData): void;
}

export function createOperationalLogger(logger: FastifyBaseLogger): OperationalLogger {
  const write = (level: OperationalLogLevel, type: string, event: string, message: string, data: OperationalLogData = {}): void => {
    logger[level]({ type, event, data }, message);
  };

  return {
    info: (type, event, message, data) => write("info", type, event, message, data),
    warn: (type, event, message, data) => write("warn", type, event, message, data),
    error: (type, event, message, data) => write("error", type, event, message, data)
  };
}
