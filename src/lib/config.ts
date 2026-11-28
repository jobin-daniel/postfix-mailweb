export type LogSourceMode = "file" | "journald";

export interface AppConfig {
  logSource: LogSourceMode;
  logPath: string;
  includeRotated: boolean;
  journaldMaxLines: number;
  timezone: string;
  archiveDir?: string | null;
}

const DEFAULT_LOG_PATH = "/var/log/mail.log";
const DEFAULT_MAX_JOURNAL_LINES = 5000;

export function getAppConfig(): AppConfig {
  const rawSource = (process.env.MAIL_LOG_SOURCE ?? "file").trim().toLowerCase();
  const logSource: LogSourceMode = rawSource === "journald" ? "journald" : "file";

  const logPath = process.env.MAIL_LOG_PATH?.trim() || DEFAULT_LOG_PATH;

  const includeRotated =
    (process.env.MAIL_LOG_INCLUDE_ROTATED ?? "true").trim().toLowerCase() !== "false";

  const parsedMaxLines = Number.parseInt(process.env.MAIL_LOG_MAX_LINES ?? "", 10);
  const journaldMaxLines =
    Number.isFinite(parsedMaxLines) && parsedMaxLines > 0
      ? Math.min(parsedMaxLines, 50000)
      : DEFAULT_MAX_JOURNAL_LINES;

  const timezone = process.env.TZ?.trim() || "UTC";
  const archiveDir = process.env.MAIL_ARCHIVE_DIR?.trim() || null;

  return {
    logSource,
    logPath,
    includeRotated,
    journaldMaxLines,
    timezone,
    archiveDir,
  };
}
