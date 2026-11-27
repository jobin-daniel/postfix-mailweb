import { NextRequest } from "next/server";
import { getAppConfig } from "@/lib/config";
import { clearLogCache, getParsedLogs } from "@/lib/postfix/cache";
import { createLogTailer } from "@/lib/postfix/tailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatSseEvent(event: string, data: unknown): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function GET(request: NextRequest) {
  const config = getAppConfig();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      safeEnqueue(
        formatSseEvent("ready", {
          source: config.logSource,
          connectedAt: new Date().toISOString(),
        }),
      );

      let stopStream: (() => void) | null = null;

      if (config.logSource === "journald") {
        let lastSeenTs = "";
        const pollTimer = setInterval(async () => {
          try {
            const snapshot = await getParsedLogs();
            const newest = snapshot.result.messages[0]?.lastTimestamp ?? "";
            if (newest && newest !== lastSeenTs) {
              const updates = lastSeenTs
                ? snapshot.result.messages.filter((m) => m.lastTimestamp > lastSeenTs)
                : [];
              lastSeenTs = newest;
              if (updates.length > 0) {
                safeEnqueue(
                  formatSseEvent("update", {
                    messages: updates.slice(0, 20),
                    rotated: false,
                  }),
                );
              }
            }
          } catch (err) {
            safeEnqueue(
              formatSseEvent("error", {
                message: err instanceof Error ? err.message : "Stream poll error",
              }),
            );
          }
        }, 3000);
        stopStream = () => clearInterval(pollTimer);
      } else {
        const tailer = createLogTailer((ev) => {
          if (ev.type === "rotated") {
            clearLogCache();
            safeEnqueue(formatSseEvent("update", { messages: [], rotated: true }));
          } else if (ev.type === "messages" && ev.messages) {
            clearLogCache();
            safeEnqueue(
              formatSseEvent("update", {
                messages: ev.messages,
                rotated: false,
              }),
            );
          } else if (ev.type === "error") {
            safeEnqueue(
              formatSseEvent("error", { message: ev.error ?? "Tailer error" }),
            );
          }
        });
        void tailer.start();
        stopStream = tailer.stop;
      }

      const heartbeatTimer = setInterval(() => {
        safeEnqueue(
          formatSseEvent("heartbeat", { ts: new Date().toISOString() }),
        );
      }, 15000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        if (stopStream) stopStream();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      request.signal.addEventListener("abort", () => {
        cleanup?.();
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
