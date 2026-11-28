import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAppConfig, type AppConfig } from "@/lib/config";
import { deleteEmailsFromArchive } from "@/lib/mail/archive";
import { clearLogCache, getParsedLogs } from "./cache";
import { resolveLogFiles, statLogFiles } from "./reader";

const QUEUE_ID_RE = /^[0-9A-Za-z_-]{4,32}$/;

export function isValidQueueId(queueId: string): boolean {
  return QUEUE_ID_RE.test(queueId);
}

export function resolveTombstonePath(config: AppConfig): string {
  const override = process.env.MAIL_DELETED_STORE?.trim();
  if (override) return override;
  if (config.archiveDir) {
    return path.join(config.archiveDir, ".deleted-queue-ids.json");
  }
  return path.join(os.tmpdir(), "mail-log-viewer-deleted.json");
}

export async function readDeletedQueueIds(config: AppConfig): Promise<Set<string>> {
  const storePath = resolveTombstonePath(config);
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // Missing or unreadable tombstone store means no tombstoned IDs
  }
  return new Set();
}

async function addDeletedQueueIds(
  config: AppConfig,
  queueIds: string[],
): Promise<string[]> {
  if (queueIds.length === 0) return [];
  const storePath = resolveTombstonePath(config);
  const existing = await readDeletedQueueIds(config);
  const added: string[] = [];
  for (const id of queueIds) {
    if (!existing.has(id)) {
      existing.add(id);
      added.push(id);
    }
  }
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(
    storePath,
    JSON.stringify(Array.from(existing), null, 2),
    "utf8",
  );
  return added;
}

async function removeLinesFromFile(
  filePath: string,
  targetLines: Set<string>,
): Promise<{ removed: number; writable: boolean }> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const hadTrailingNewline = content.endsWith("\n");
    const lines = content.split(/\r?\n/);
    if (hadTrailingNewline && lines[lines.length - 1] === "") {
      lines.pop();
    }

    let removed = 0;
    const kept: string[] = [];
    for (const line of lines) {
      if (targetLines.has(line)) {
        removed += 1;
      } else {
        kept.push(line);
      }
    }

    if (removed === 0) {
      return { removed: 0, writable: true };
    }

    const nextContent =
      kept.length === 0
        ? ""
        : kept.join("\n") + (hadTrailingNewline ? "\n" : "");
    await fs.writeFile(filePath, nextContent, "utf8");
    return { removed, writable: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      return { removed: 0, writable: false };
    }
    throw err;
  }
}

export interface DeleteMessagesResult {
  deletedQueueIds: string[];
  notFoundQueueIds: string[];
  deletedFiles: string[];
  deletedLogLines: number;
  tombstonedQueueIds: string[];
  archiveErrors: Array<{ filePath: string; error: string }>;
}

/**
 * Deletes one or more messages:
 * 1. Physically removes matching email files from `MAIL_ARCHIVE_DIR` (if configured).
 * 2. Physically removes matching log lines from writable uncompressed log files in `file` mode.
 * 3. Falls back to recording tombstoned queue IDs if log lines could not be physically removed
 *    (e.g. read-only log file, compressed `.gz` rotated file, or `journald` mode).
 */
export async function deleteMessagesByQueueIds(
  queueIds: string[],
): Promise<DeleteMessagesResult> {
  const uniqueIds = Array.from(new Set(queueIds.map((id) => id.trim()).filter(Boolean)));
  const config = getAppConfig();
  const snapshot = await getParsedLogs();

  const foundMessages = [];
  const notFoundQueueIds: string[] = [];

  for (const id of uniqueIds) {
    const msg = snapshot.result.byQueueId[id];
    if (msg) {
      foundMessages.push(msg);
    } else {
      notFoundQueueIds.push(id);
    }
  }

  if (foundMessages.length === 0) {
    return {
      deletedQueueIds: [],
      notFoundQueueIds,
      deletedFiles: [],
      deletedLogLines: 0,
      tombstonedQueueIds: [],
      archiveErrors: [],
    };
  }

  // 1. Delete physical email files from archive directory
  const messageIds = foundMessages
    .map((m) => m.messageId)
    .filter((id): id is string => Boolean(id));
  const archiveResult = await deleteEmailsFromArchive(
    config.archiveDir ?? null,
    messageIds,
  );

  // 2. Remove log lines from writable uncompressed log files (in file mode)
  let deletedLogLines = 0;
  const needTombstone = new Set<string>();

  if (config.logSource === "file") {
    const candidateFiles = await resolveLogFiles(
      config.logPath,
      config.includeRotated,
    );
    const existingFiles = await statLogFiles(candidateFiles);
    const uncompressedFiles = existingFiles.filter((f) => !f.path.endsWith(".gz"));

    const allTargetLines = new Set<string>();
    for (const msg of foundMessages) {
      for (const line of msg.rawLines) {
        allTargetLines.add(line);
      }
    }

    let anyReadOnly = false;
    for (const fp of uncompressedFiles) {
      const res = await removeLinesFromFile(fp.path, allTargetLines);
      deletedLogLines += res.removed;
      if (!res.writable) {
        anyReadOnly = true;
      }
    }

    // If any log file was read-only or lines lived in .gz archives, tombstone the deleted IDs
    const hasGzippedLogs = existingFiles.some((f) => f.path.endsWith(".gz"));
    if (anyReadOnly || hasGzippedLogs || deletedLogLines === 0) {
      for (const msg of foundMessages) {
        needTombstone.add(msg.queueId);
      }
    }
  } else {
    // journald logs are immutable; tombstone deleted IDs so they stay removed from UI
    for (const msg of foundMessages) {
      needTombstone.add(msg.queueId);
    }
  }

  let tombstonedQueueIds: string[] = [];
  if (needTombstone.size > 0) {
    tombstonedQueueIds = await addDeletedQueueIds(
      config,
      Array.from(needTombstone),
    );
  }

  clearLogCache();

  return {
    deletedQueueIds: foundMessages.map((m) => m.queueId),
    notFoundQueueIds,
    deletedFiles: archiveResult.deletedFiles,
    deletedLogLines,
    tombstonedQueueIds,
    archiveErrors: archiveResult.errors,
  };
}
