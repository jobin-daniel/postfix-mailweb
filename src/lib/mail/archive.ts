import fs from "node:fs/promises";
import path from "node:path";
import { extractAttachment, extractHeaderMessageId, normalizeMessageId, parseRawEmail } from "./mime";
import type { ExtractedAttachment } from "./mime";
import type { ParsedEmail } from "./types";

const HEADER_PEEK_BYTES = 24 * 1024;
const INDEX_TTL_MS = 5000;
const MAX_SCAN_DEPTH = 3;

interface ArchiveIndex {
  dir: string;
  builtAt: number;
  byMessageId: Map<string, string>;
}

let cachedIndex: ArchiveIndex | null = null;

async function collectCandidateFiles(
  rootDir: string,
  depth = 0,
  out: string[] = [],
): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return out;
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      // Skip Maildir tmp/ directory (in-flight deliveries)
      if (entry.name === "tmp") continue;
      await collectCandidateFiles(fullPath, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

async function readFileHead(filePath: string, maxBytes: number): Promise<Buffer> {
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function getArchiveIndex(archiveDir: string): Promise<ArchiveIndex> {
  const now = Date.now();
  if (
    cachedIndex &&
    cachedIndex.dir === archiveDir &&
    now - cachedIndex.builtAt < INDEX_TTL_MS
  ) {
    return cachedIndex;
  }

  const files = await collectCandidateFiles(archiveDir);
  const byMessageId = new Map<string, string>();

  for (const filePath of files) {
    try {
      const head = await readFileHead(filePath, HEADER_PEEK_BYTES);
      const msgId = extractHeaderMessageId(head);
      if (msgId && !byMessageId.has(msgId)) {
        byMessageId.set(msgId, filePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  cachedIndex = { dir: archiveDir, builtAt: now, byMessageId };
  return cachedIndex;
}

export function clearArchiveCache(): void {
  cachedIndex = null;
}

export type ArchiveLookupResult =
  | { status: "found"; email: ParsedEmail; filePath: string }
  | { status: "not_configured" }
  | { status: "not_found" };

export async function findEmailInArchive(
  archiveDir: string | null,
  messageId: string | null,
): Promise<ArchiveLookupResult> {
  if (!archiveDir) {
    return { status: "not_configured" };
  }

  const normalizedId = normalizeMessageId(messageId);
  if (!normalizedId) {
    return { status: "not_found" };
  }

  const index = await getArchiveIndex(archiveDir);
  const filePath = index.byMessageId.get(normalizedId);
  if (!filePath) {
    return { status: "not_found" };
  }

  const rawBuffer = await fs.readFile(filePath);
  const email = parseRawEmail(rawBuffer);
  return { status: "found", email, filePath };
}

export async function findAttachmentInArchive(
  archiveDir: string | null,
  messageId: string | null,
  partIndex: number,
): Promise<ExtractedAttachment | null> {
  if (!archiveDir) return null;
  const normalizedId = normalizeMessageId(messageId);
  if (!normalizedId) return null;

  const index = await getArchiveIndex(archiveDir);
  const filePath = index.byMessageId.get(normalizedId);
  if (!filePath) return null;

  const rawBuffer = await fs.readFile(filePath);
  return extractAttachment(rawBuffer, partIndex);
}
