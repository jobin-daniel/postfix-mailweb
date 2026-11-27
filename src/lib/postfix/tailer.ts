import fs from "node:fs";
import fsp from "node:fs/promises";
import { getAppConfig, type AppConfig } from "@/lib/config";
import { parsePostfixLogs } from "./parser";
import type { MailMessage } from "./types";

export interface TailEvent {
  type: "messages" | "rotated" | "error";
  messages?: MailMessage[];
  lineCount?: number;
  error?: string;
}

export interface LogTailerHandle {
  start: () => Promise<void>;
  stop: () => void;
}

export function createLogTailer(
  onEvent: (event: TailEvent) => void,
  overrideConfig?: Partial<AppConfig>,
  pollIntervalMs = 500,
): LogTailerHandle {
  const config: AppConfig = { ...getAppConfig(), ...overrideConfig };
  const targetPath = config.logPath;

  let stopped = false;
  let offset = 0;
  let currentIno: number | null = null;
  let remainder = "";
  let reading = false;
  let watcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const readNewBytes = async () => {
    if (stopped || reading) return;
    reading = true;
    try {
      const st = await fsp.stat(targetPath);

      if (currentIno === null) {
        currentIno = st.ino;
        offset = st.size;
        return;
      }

      let rotated = false;
      if (st.ino !== currentIno || st.size < offset) {
        rotated = true;
        currentIno = st.ino;
        offset = 0;
        remainder = "";
        onEvent({ type: "rotated" });
      }

      if (st.size === offset) {
        return;
      }

      const bytesToRead = st.size - offset;
      const handle = await fsp.open(targetPath, "r");
      try {
        const buffer = Buffer.alloc(bytesToRead);
        await handle.read(buffer, 0, bytesToRead, offset);
        offset = st.size;

        const chunk = remainder + buffer.toString("utf8");
        const lines = chunk.split(/\r?\n/);
        remainder = lines.pop() ?? "";

        const completeText = lines.join("\n");
        if (completeText.trim()) {
          const parsed = parsePostfixLogs(completeText, { timezone: config.timezone });
          if (parsed.messages.length > 0) {
            onEvent({
              type: "messages",
              messages: parsed.messages,
              lineCount: parsed.totalLines,
            });
          } else if (rotated) {
            onEvent({ type: "messages", messages: [], lineCount: 0 });
          }
        }
      } finally {
        await handle.close();
      }
    } catch (err) {
      if (!stopped) {
        onEvent({
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      reading = false;
    }
  };

  return {
    start: async () => {
      if (config.logSource === "journald") {
        // journald mode does not tail a filesystem path via fs.watch
        return;
      }
      await readNewBytes();
      if (stopped) return;
      try {
        watcher = fs.watch(targetPath, { persistent: false }, () => {
          void readNewBytes();
        });
        watcher.on("error", () => {
          // Polling fallback continues safely during rotation
        });
      } catch {
        // Polling fallback handles missing/rotating files
      }
      timer = setInterval(() => {
        void readNewBytes();
      }, pollIntervalMs);
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}
