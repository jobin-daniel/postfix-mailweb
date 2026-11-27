import path from "node:path";

export type LogSourceMode = "file" | "sample" | "journald";

export interface AppConfig {
  logSource: LogSourceMode;
  logPath: string;
  sampleLogPath: string;
  includeRotated: boolean;
  journaldMaxLines: number;
  timezone: string;
}

const DEFAULT_LOG_PATH = "/var/log/mail.log";
const DEFAULT_MAX_JOURNAL_LINES = 5000;

export function getAppConfig(): AppConfig {
  const rawSource = (process.env.MAIL_LOG_SOURCE ?? "sample").trim().toLowerCase();
  let logSource: LogSourceMode = "sample";
  if (rawSource === "file" || rawSource === "sample" || rawSource === "journald") {
    logSource = rawSource;
  }

  const logPath = process.env.MAIL_LOG_PATH?.trim() || DEFAULT_LOG_PATH;
  const sampleLogPath = path.resolve(process.cwd(), "sample-data", "mail.log");

  const includeRotated =
    (process.env.MAIL_LOG_INCLUDE_ROTATED ?? "true").trim().toLowerCase() !== "false";

  const parsedMaxLines = Number.parseInt(process.env.MAIL_LOG_MAX_LINES ?? "", 10);
  const journaldMaxLines =
    Number.isFinite(parsedMaxLines) && parsedMaxLines > 0
      ? Math.min(parsedMaxLines, 50000)
      : DEFAULT_MAX_JOURNAL_LINES;

  const timezone = process.env.TZ?.trim() || "UTC";

  return {
    logSource,
    logPath,
    sampleLogPath,
    includeRotated,
    journaldMaxLines,
    timezone,
  };
}
