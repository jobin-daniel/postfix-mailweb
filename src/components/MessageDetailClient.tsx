"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MailMessage, MessageEvent } from "@/lib/postfix/types";
import { EmailViewer } from "./EmailViewer";
import { StatusBadge } from "./StatusBadge";

const EVENT_DOT_CLASS: Record<MessageEvent["kind"], string> = {
  client: "bg-zinc-400",
  tls: "bg-emerald-500",
  cleanup: "bg-indigo-500",
  qmgr: "bg-sky-500",
  delivery: "bg-emerald-500",
  bounce: "bg-rose-500",
  timeout: "bg-amber-500",
  reject: "bg-purple-500",
  other: "bg-zinc-400",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function MessageDetailClient({ queueId }: { queueId: string }) {
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/messages/${encodeURIComponent(queueId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load message (${res.status})`);
        }
        const json = await res.json();
        if (active) setMessage(json.message);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load message");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [queueId]);

  const copyRawLogs = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.rawLines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-HTTPS contexts
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-zinc-400">
        Loading message {queueId}…
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="space-y-4">
        <Link
          href="/messages"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to messages
        </Link>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          <h2 className="font-semibold">Message unavailable</h2>
          <p className="mt-1 text-sm">{error ?? "Message not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/messages"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to messages
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {message.queueId}
            </h1>
            <StatusBadge status={message.status} />
          </div>
        </div>
      </div>

      {/* Real Email Body Viewer */}
      <EmailViewer queueId={message.queueId} />

      {/* Metadata Summary */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-xs sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">From</dt>
          <dd className="mt-1 font-mono text-sm break-all text-zinc-900 dark:text-zinc-100">
            {message.from ? `<${message.from}>` : "<> (bounce/null sender)"}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Recipients ({message.to.length})
          </dt>
          <dd className="mt-1 space-y-0.5 font-mono text-sm break-all text-zinc-900 dark:text-zinc-100">
            {message.to.length === 0
              ? "—"
              : message.to.map((r) => <div key={r}>&lt;{r}&gt;</div>)}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Message-ID</dt>
          <dd className="mt-1 font-mono text-xs break-all text-zinc-700 dark:text-zinc-300">
            {message.messageId ? `<${message.messageId}>` : "—"}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Client / Size
          </dt>
          <dd className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {message.client ?? "—"} · {formatBytes(message.size)}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            First / Last Seen
          </dt>
          <dd className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {new Date(message.firstTimestamp).toLocaleString()} →{" "}
            {new Date(message.lastTimestamp).toLocaleString()}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            TLS Transport
          </dt>
          <dd className="mt-1 flex items-start gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            {message.tlsInfo ? (
              <>
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="break-words">{message.tlsInfo}</span>
              </>
            ) : (
              <span className="text-zinc-400">No TLS line recorded</span>
            )}
          </dd>
        </div>
      </div>

      {/* Delivery Attempts */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="text-base font-semibold">
            Delivery Attempts ({message.attempts.length})
          </h2>
        </div>

        {message.attempts.length === 0 ? (
          <div className="px-5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {message.primaryDetail
              ? message.primaryDetail
              : "No delivery attempts logged yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase dark:bg-zinc-900/80 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2.5">Recipient</th>
                  <th className="px-4 py-2.5">Relay</th>
                  <th className="px-4 py-2.5">Delay</th>
                  <th className="px-4 py-2.5">DSN</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {message.attempts.map((a, idx) => (
                  <tr key={`${a.timestamp}-${a.recipient}-${idx}`}>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      &lt;{a.recipient}&gt;
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                      {a.relay}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {a.delay !== null ? `${a.delay}s` : "—"}
                      {a.delays && (
                        <div className="text-[10px] text-zinc-400">
                          {a.delays}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                      {a.dsn ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs break-words text-zinc-700 dark:text-zinc-300">
                      {a.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-base font-semibold">Event Timeline</h2>
        <ol className="relative ml-2 space-y-4 border-l border-zinc-200 pl-5 dark:border-zinc-800">
          {message.events.map((ev, idx) => (
            <li key={`${ev.timestamp}-${idx}`} className="relative">
              <span
                className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-zinc-900 ${
                  EVENT_DOT_CLASS[ev.kind] ?? "bg-zinc-400"
                }`}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-mono">
                  {new Date(ev.timestamp).toLocaleString()}
                </span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {ev.process}
                  {ev.pid !== null ? `[${ev.pid}]` : ""}
                </span>
              </div>
              <p className="mt-1 text-sm break-words text-zinc-800 dark:text-zinc-200">
                {ev.summary}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {/* Collapsible Raw Log Viewer */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between px-5 py-3.5">
          <button
            type="button"
            onClick={() => setRawOpen((v) => !v)}
            aria-expanded={rawOpen}
            className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {rawOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Terminal className="h-4 w-4 text-zinc-500" />
            <span>Raw Syslog Lines ({message.rawLines.length})</span>
          </button>

          <button
            type="button"
            onClick={() => void copyRawLogs()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy raw logs
              </>
            )}
          </button>
        </div>

        {rawOpen && (
          <div className="border-t border-zinc-200 bg-zinc-950 p-4 dark:border-zinc-800">
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-zinc-200">
              {message.rawLines.join("\n")}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
