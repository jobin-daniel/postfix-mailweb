import { getAppConfig, type AppConfig } from "@/lib/config";
import { parsePostfixLogs } from "./parser";
import {
  readConfiguredLogs,
  resolveLogFiles,
  statLogFiles,
  type FileFingerprint,
} from "./reader";
import type { MailMessage, ParseResult } from "./types";

interface CacheEntry {
  key: string;
  files: FileFingerprint[];
  result: ParseResult;
  source: AppConfig["logSource"];
  cachedAtMs: number;
}

const JOURNALD_CACHE_TTL_MS = 5000;

let cachedEntry: CacheEntry | null = null;

function fingerprintsMatch(a: FileFingerprint[], b: FileFingerprint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].path !== b[i].path ||
      a[i].mtimeMs !== b[i].mtimeMs ||
      a[i].size !== b[i].size ||
      a[i].ino !== b[i].ino
    ) {
      return false;
    }
  }
  return true;
}

function buildConfigKey(config: AppConfig): string {
  const target = config.logSource === "sample" ? config.sampleLogPath : config.logPath;
  return `${config.logSource}|${target}|${config.includeRotated}|${config.timezone}|${config.journaldMaxLines}`;
}

export interface ParsedLogsSnapshot {
  result: ParseResult;
  source: AppConfig["logSource"];
  filesRead: string[];
  cacheHit: boolean;
}

export function clearLogCache(): void {
  cachedEntry = null;
}

export async function getParsedLogs(
  overrideConfig?: Partial<AppConfig>,
): Promise<ParsedLogsSnapshot> {
  const config: AppConfig = { ...getAppConfig(), ...overrideConfig };
  const key = buildConfigKey(config);

  if (cachedEntry && cachedEntry.key === key) {
    if (config.logSource === "journald") {
      if (Date.now() - cachedEntry.cachedAtMs < JOURNALD_CACHE_TTL_MS) {
        return {
          result: cachedEntry.result,
          source: cachedEntry.source,
          filesRead: ["journalctl -u postfix -o short-iso"],
          cacheHit: true,
        };
      }
    } else {
      const targetPath =
        config.logSource === "sample" ? config.sampleLogPath : config.logPath;
      const includeRotated =
        config.logSource === "sample" ? false : config.includeRotated;
      const candidateFiles = await resolveLogFiles(targetPath, includeRotated);
      const currentFps = await statLogFiles(candidateFiles);
      if (fingerprintsMatch(cachedEntry.files, currentFps)) {
        return {
          result: cachedEntry.result,
          source: cachedEntry.source,
          filesRead: currentFps.map((f) => f.path),
          cacheHit: true,
        };
      }
    }
  }

  const loaded = await readConfiguredLogs(config);
  const result = parsePostfixLogs(loaded.text, {
    timezone: config.timezone,
  });

  cachedEntry = {
    key,
    files: loaded.files,
    result,
    source: loaded.source,
    cachedAtMs: Date.now(),
  };

  return {
    result,
    source: loaded.source,
    filesRead: loaded.files.map((f) => f.path),
    cacheHit: false,
  };
}

export interface MessageFilterParams {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedMessages {
  items: MailMessage[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function filterAndPaginateMessages(
  messages: MailMessage[],
  filters: MessageFilterParams = {},
): PaginatedMessages {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const status = filters.status?.trim().toLowerCase() ?? "";
  const fromFilter = filters.from?.trim().toLowerCase() ?? "";
  const toFilter = filters.to?.trim().toLowerCase() ?? "";

  const dateFromMs = filters.dateFrom ? Date.parse(filters.dateFrom) : NaN;
  const dateToMs = filters.dateTo ? Date.parse(filters.dateTo) : NaN;

  const filtered = messages.filter((msg) => {
    if (status && status !== "all" && msg.status !== status) {
      return false;
    }
    if (fromFilter && !msg.from.toLowerCase().includes(fromFilter)) {
      return false;
    }
    if (toFilter && !msg.to.some((addr) => addr.toLowerCase().includes(toFilter))) {
      return false;
    }
    if (Number.isFinite(dateFromMs) && msg.lastTimestampMs < dateFromMs) {
      return false;
    }
    if (Number.isFinite(dateToMs) && msg.lastTimestampMs > dateToMs) {
      return false;
    }
    if (q) {
      const haystacks = [
        msg.queueId,
        msg.messageId ?? "",
        msg.from,
        ...msg.to,
        msg.primaryRelay ?? "",
        msg.primaryDetail ?? "",
        msg.rejectReason ?? "",
        ...msg.attempts.map((a) => `${a.relay} ${a.detail}`),
      ];
      if (!haystacks.some((s) => s.toLowerCase().includes(q))) {
        return false;
      }
    }
    return true;
  });

  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), totalPages);
  const offset = (page - 1) * pageSize;

  return {
    items: filtered.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}
