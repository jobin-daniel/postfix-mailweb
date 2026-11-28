"use client";

import {
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Mail,
  Maximize2,
  Minimize2,
  Paperclip,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EmailAddress, ParsedEmail } from "@/lib/mail/types";

type EmailResponse =
  | { available: true; email: ParsedEmail }
  | { available: false; reason: "not_configured" | "not_found" };

type ViewMode = "html" | "text" | "headers";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}

function getInitials(addr: EmailAddress | undefined): string {
  if (!addr) return "?";
  const source = (addr.name || addr.address).trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || "?";
}

function buildIframeSrcDoc(sanitizedHtml: string): string {
  const hasHtmlTag = /<html[\s>]/i.test(sanitizedHtml);
  const baseTag = '<base target="_blank" rel="noopener noreferrer" />';
  if (hasHtmlTag) {
    return sanitizedHtml.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${baseTag}
<style>
  body {
    margin: 0;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #18181b;
    background: #ffffff;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-x: auto; }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
}

export function EmailViewer({ queueId }: { queueId: string }) {
  const [data, setData] = useState<EmailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("html");
  const [expanded, setExpanded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/messages/${encodeURIComponent(queueId)}/email`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load email (${res.status})`);
        }
        const json: EmailResponse = await res.json();
        if (!active) return;
        setData(json);
        if (json.available) {
          if (json.email.sanitizedHtml) {
            setViewMode("html");
          } else if (json.email.text) {
            setViewMode("text");
          } else {
            setViewMode("headers");
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load email body");
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

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Checking email archive for message body…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
        {error}
      </div>
    );
  }

  if (!data || !data.available) {
    if (data?.reason === "not_configured") {
      return (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-5 shadow-xs dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Email Body Archive Not Configured
                </h2>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  Postfix logs only contain delivery metadata. Set{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900/40">
                    MAIL_ARCHIVE_DIR
                  </code>{" "}
                  to a Maildir archive (populated via Postfix{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900/40">
                    always_bcc
                  </code>
                  ) to view incoming and outgoing email bodies here.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSetupOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
            >
              {setupOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Setup guide
            </button>
          </div>

          {setupOpen && (
            <div className="mt-4 space-y-2 border-t border-amber-200/80 pt-3 text-xs text-zinc-700 dark:border-amber-900/50 dark:text-zinc-300">
              <p className="font-medium">
                1. Archive all incoming &amp; outgoing mail in Postfix (
                <code className="font-mono">/etc/postfix/main.cf</code>):
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
{`always_bcc = archive@localhost
home_mailbox = Maildir/`}
              </pre>
              <p className="font-medium">
                2. Point <code className="font-mono">.env</code> to that Maildir and restart:
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
{`MAIL_ARCHIVE_DIR=/home/archive/Maildir`}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2.5 text-sm text-zinc-500 dark:text-zinc-400">
          <Mail className="h-4 w-4 shrink-0" />
          <span>
            No archived email body found in <code className="font-mono text-xs">MAIL_ARCHIVE_DIR</code>{" "}
            matching this Message-ID.
          </span>
        </div>
      </div>
    );
  }

  const { email } = data;
  const sender = email.from[0];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      {/* Email Subject & View Controls */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
            <Mail className="h-3.5 w-3.5" />
            <span>Email Message</span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {formatBytes(email.rawSize)}
            </span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight break-words text-zinc-900 dark:text-zinc-50">
            {email.subject}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            {email.sanitizedHtml && (
              <button
                type="button"
                onClick={() => setViewMode("html")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "html"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                HTML
              </button>
            )}
            {email.text && (
              <button
                type="button"
                onClick={() => setViewMode("text")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "text"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Plain Text
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode("headers")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                viewMode === "headers"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Headers ({email.headers.length})
            </button>
          </div>

          {viewMode === "html" && email.sanitizedHtml && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Compact height" : "Expand height"}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Email Envelope Header (Gmail-style) */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 bg-zinc-50/60 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
            {getInitials(sender)}
          </div>
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {sender?.name || sender?.address || "Unknown Sender"}
              </span>
              {sender?.name && (
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  &lt;{sender.address}&gt;
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-500">To: </span>
              <span className="break-all">
                {email.to.length > 0 ? email.to.map(formatAddress).join(", ") : "—"}
              </span>
            </div>
            {email.cc.length > 0 && (
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-500">Cc: </span>
                <span className="break-all">
                  {email.cc.map(formatAddress).join(", ")}
                </span>
              </div>
            )}
          </div>
        </div>

        {email.date && (
          <div className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
            {new Date(email.date).toLocaleString()}
          </div>
        )}
      </div>

      {/* Attachments Bar */}
      {email.attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/40 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Paperclip className="h-3.5 w-3.5" />
            Attachments ({email.attachments.length}):
          </span>
          {email.attachments.map((att) => (
            <a
              key={`${att.partIndex}-${att.filename}`}
              href={`/api/messages/${encodeURIComponent(queueId)}/email?attachment=${att.partIndex}`}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-indigo-700 dark:hover:bg-zinc-700"
            >
              <span className="max-w-[180px] truncate">{att.filename}</span>
              <span className="text-[11px] text-zinc-400">
                {formatBytes(att.size)}
              </span>
              <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            </a>
          ))}
        </div>
      )}

      {/* Email Body Content */}
      <div>
        {viewMode === "html" && email.sanitizedHtml && (
          <iframe
            title={`Email body for ${email.subject}`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={buildIframeSrcDoc(email.sanitizedHtml)}
            className={`w-full border-0 bg-white transition-all ${
              expanded ? "h-[820px]" : "h-[540px]"
            }`}
          />
        )}

        {viewMode === "text" && (
          <div className="p-6">
            <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">
              {email.text || "No plain text body available."}
            </pre>
          </div>
        )}

        {viewMode === "headers" && (
          <div className="max-h-[540px] overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {email.headers.map((h, idx) => (
                  <tr key={`${h.name}-${idx}`}>
                    <td className="w-48 px-6 py-2 align-top font-mono font-semibold whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                      {h.name}
                    </td>
                    <td className="px-6 py-2 font-mono break-all text-zinc-600 dark:text-zinc-400">
                      {h.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
