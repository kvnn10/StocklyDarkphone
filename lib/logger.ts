/**
 * Logger Utility
 * Centralized logging utility for development-only console logs
 * Automatically sends errors to Sentry in production when configured
 */

import { isAxiosError, isExpectedClientError } from "@/lib/api/errors";
import { captureException, captureMessage } from "@/lib/monitoring/sentry";

type LogLevel = "log" | "error" | "warn" | "info" | "debug";

interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

function extractError(args: unknown[]): Error | null {
  if (args.length === 0) return null;

  const firstArg = args[0];
  if (firstArg instanceof Error) return firstArg;

  if (typeof firstArg === "string") return new Error(firstArg);

  if (typeof firstArg === "object" && firstArg !== null) {
    if ("error" in firstArg && firstArg.error instanceof Error) return firstArg.error;
    if ("message" in firstArg && typeof firstArg.message === "string") {
      return new Error(firstArg.message);
    }
  }

  return null;
}

function resolvePrimaryError(args: unknown[]): unknown {
  if (args.length > 1) {
    if (args[1] instanceof Error) return args[1];
    if (isAxiosError(args[1])) return args[1];
  }
  return extractError(args);
}

function getContext(args: unknown[]): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};

  if (typeof args[0] === "string") context.label = args[0];

  for (const arg of args.slice(1)) {
    if (arg && typeof arg === "object" && !(arg instanceof Error)) {
      Object.assign(context, arg as Record<string, unknown>);
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

const createLogger = (level: LogLevel): ((...args: unknown[]) => void) => {
  if (process.env.NODE_ENV === "production") {
    if (level === "error") {
      return (...args: unknown[]) => {
        const primary = resolvePrimaryError(args);
        if (isExpectedClientError(primary)) return;

        const context = getContext(args);

        if (primary instanceof Error) {
          captureException(primary, context);
        } else if (args.length > 0) {
          captureMessage(String(args[0]), "error", context);
        }
      };
    }

    if (level === "warn") {
      return (...args: unknown[]) => {
        if (args.length === 0) return;
        captureMessage(String(args[0]), "warning", getContext(args));
      };
    }

    return () => {};
  }

  return (...args: unknown[]) => {
    console[level](...args);
  };
};

export const logger: Logger = {
  log: createLogger("log"),
  error: createLogger("error"),
  warn: createLogger("warn"),
  info: createLogger("info"),
  debug: createLogger("debug"),
};
