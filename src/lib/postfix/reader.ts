import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { getAppConfig, type AppConfig } from "@/lib/config";

const execFileAsync = promisify(execFile);

export interface FileFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
  ino: number;
}

export interface LoadedLogContent {
  text: string;
  files: FileFingerprint[];
  source: AppConfig["logSource"];
}

export async function resolveLogFiles(
  activePath: string,
  includeRotated: boolean,
): Promise<string[]> {
  if (!includeRotated) {
    return [activePath];
  }

  const dir = path.dirname(activePath);
  const base = path.basename(activePath);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [activePath];
  }

  const rotated: Array<{ filePath: string; index: number }> = [];
  for (const name of entries) {
    if (name === base) continue;
    if (!name.startsWith(`${base}.`)) continue;
    const suffix = name.slice(base.length + 1);
    const match = suffix.match(/^(\d+)(?:\.gz)?$/);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      rotated.push({ filePath: path.join(dir, name), index });
    }
  }

  rotated.sort((a, b) => b.index - a.index);
  return [...rotated.map((r) => r.filePath), activePath];
}

export async function statLogFiles(filePaths: string[]): Promise<FileFingerprint[]> {
  const results: FileFingerprint[] = [];
  for (const filePath of filePaths) {
    try {
      const st = await fs.stat(filePath);
      if (st.isFile()) {
        results.push({
          path: filePath,
          mtimeMs: st.mtimeMs,
          size: st.size,
          ino: st.ino,
        });
      }
    } catch {
      // Ignore missing optional rotated files
    }
  }
  return results;
}

async function readSingleLogFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  if (filePath.endsWith(".gz")) {
    return zlib.gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}

async function readJournaldLogs(maxLines: number): Promise<string> {
  const args = ["-u", "postfix", "-o", "short-iso", "-n", String(maxLines), "--no-pager"];
  const { stdout } = await execFileAsync("journalctl", args, {
    maxBuffer: 25 * 1024 * 1024,
  });
  return stdout;
}

export async function readConfiguredLogs(
  overrideConfig?: Partial<AppConfig>,
): Promise<LoadedLogContent> {
  const config: AppConfig = { ...getAppConfig(), ...overrideConfig };

  if (config.logSource === "journald") {
    const text = await readJournaldLogs(config.journaldMaxLines);
    return {
      text,
      files: [],
      source: "journald",
    };
  }

  const targetPath =
    config.logSource === "sample" ? config.sampleLogPath : config.logPath;
  const includeRotated =
    config.logSource === "sample" ? false : config.includeRotated;

  const candidateFiles = await resolveLogFiles(targetPath, includeRotated);
  const files = await statLogFiles(candidateFiles);

  if (files.length === 0) {
    throw new Error(
      `Configured mail log file not found or unreadable: ${targetPath}`,
    );
  }

  const chunks: string[] = [];
  for (const fp of files) {
    const content = await readSingleLogFile(fp.path);
    if (content) {
      chunks.push(content);
    }
  }

  return {
    text: chunks.join("\n"),
    files,
    source: config.logSource,
  };
}
