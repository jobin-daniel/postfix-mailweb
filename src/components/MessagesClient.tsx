"use client";

import {
  ChevronLeft,
  ChevronRight,
  Radio,
  RotateCcw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageSummary } from "@/lib/postfix/query";
import { StatusBadge } from "./StatusBadge";

interface MessagesApiResponse {
  items: MessageSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  source: string;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDelay(delay: number | null): string {
  if (delay === null) return "—";
  if (delay >= 60) {
    const mins = Math.floor(delay / 60);
    const secs = Math.round(delay % 60);
    return `${mins}m ${secs}s`;
  }
  return `${delay.toFixed(delay < 10 ? 2 : 1)}s`;
}

export function MessagesClient() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") ?? "all";
  const initialQ = searchParams.get("q") ?? "";

  const [searchInput, setSearchInput] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [data, setData] = useState<MessagesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveEventCount, setLiveEventCount] = useState(0);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQ(searchInput);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchInput]);

  const buildQueryString = useCallback(() => {
    const qs = new URLSearchParams();
    if (debouncedQ.trim()) qs.set("q", debouncedQ.trim());
    if (status && status !== "all") qs.set("status", status);
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    return qs.toString();
  }, [debouncedQ, status, dateFrom, dateTo, page, pageSize]);

  const refreshMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages?${buildQueryString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json: MessagesApiResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    let active = true;
    fetch(`/api/messages?${buildQueryString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return (await res.json()) as MessagesApiResponse;
      })
      .then((json) => {
        if (active) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load messages");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [buildQueryString]);

  const isLiveConnected = liveEnabled && liveConnected;

  // SSE Auto-refresh stream
  useEffect(() => {
    if (!liveEnabled) {
      return;
    }

    const es = new EventSource("/api/stream");

    es.addEventListener("ready", () => {
      setLiveConnected(true);
    });

    es.addEventListener("update", () => {
      setLiveEventCount((c) => c + 1);
      void refreshMessages();
    });

    es.onerror = () => {
      setLiveConnected(false);
    };

    return () => {
      es.close();
    };
  }, [liveEnabled, refreshMessages]);

  const resetFilters = () => {
    setSearchInput("");
    setDebouncedQ("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Search and filter Postfix queue deliveries and NOQUEUE rejections
          </p>
        </div>

        {/* Live SSE Toggle */}
        <button
          type="button"
          onClick={() => {
            if (liveEnabled) setLiveConnected(false);
            setLiveEnabled(!liveEnabled);
          }}
          aria-pressed={liveEnabled}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            liveEnabled
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            {isLiveConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                liveEnabled
                  ? isLiveConnected
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                  : "bg-zinc-400"
              }`}
            />
          </span>
          <Radio className="h-3.5 w-3.5" />
          <span>{liveEnabled ? "Live" : "Auto-refresh"}</span>
          {liveEnabled && liveEventCount > 0 && (
            <span className="rounded bg-emerald-200/70 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-emerald-900/70">
              +{liveEventCount}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-12 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="relative lg:col-span-5">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search queue ID, sender, recipient, relay, detail…"
            aria-label="Search messages"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pr-3 pl-9 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-400 dark:focus:bg-zinc-900"
          />
        </div>

        <div className="lg:col-span-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="all">All statuses</option>
            <option value="delivered">Delivered</option>
            <option value="deferred">Deferred</option>
            <option value="bounced">Bounced</option>
            <option value="in-queue">In Queue</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="lg:col-span-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>

        <div className="lg:col-span-2">
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>

        <div className="flex items-center lg:col-span-1">
          <button
            type="button"
            onClick={resetFilters}
            title="Reset filters"
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="lg:hidden">Reset</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium tracking-wider text-zinc-500 uppercase dark:bg-zinc-900/80 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Time</th>
                <th className="px-4 py-3 whitespace-nowrap">Queue ID</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3 whitespace-nowrap">Status</th>
                <th className="px-4 py-3">Relay</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Delay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                    Loading messages…
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400">
                    No messages match your filters.
                  </td>
                </tr>
              ) : (
                data.items.map((msg) => (
                  <tr
                    key={msg.queueId}
                    className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                      {formatTimestamp(msg.lastTimestamp)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/messages/${encodeURIComponent(msg.queueId)}`}
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {msg.queueId}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {msg.from ? `<${msg.from}>` : "<>"}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {msg.to.length === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : msg.to.length === 1 ? (
                        <span className="block truncate">&lt;{msg.to[0]}&gt;</span>
                      ) : (
                        <span className="block truncate" title={msg.to.join(", ")}>
                          &lt;{msg.to[0]}&gt;{" "}
                          <span className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            +{msg.to.length - 1}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={msg.status} />
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {msg.primaryRelay ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {formatDelay(msg.primaryDelay)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
            <div>
              Showing{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
              </span>
              –
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {Math.min(data.page * data.pageSize, data.total)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {data.total}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number.parseInt(e.target.value, 10));
                  setPage(1);
                }}
                aria-label="Rows per page"
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2">
                  Page {data.page} of {data.totalPages}
                </span>
                <button
                  type="button"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  aria-label="Next page"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
