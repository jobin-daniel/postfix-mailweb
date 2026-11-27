"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MailStats } from "@/lib/postfix/types";
import { StatusBadge } from "./StatusBadge";

interface StatsResponse extends MailStats {
  source: string;
  filesRead: number;
  cacheHit: boolean;
}

export function DashboardClient() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data: StatsResponse = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    let active = true;
    fetch("/api/stats", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return (await res.json()) as StatsResponse;
      })
      .then((data) => {
        if (active) {
          setStats(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load statistics");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Unable to read mail logs</h2>
            <p className="mt-1 text-sm opacity-90">{error}</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const counts = stats?.counts ?? {
    total: 0,
    delivered: 0,
    deferred: 0,
    bounced: 0,
    inQueue: 0,
    rejected: 0,
  };

  const statCards = [
    {
      label: "Total Events",
      value: counts.total,
      href: "/messages",
      icon: Mail,
      accent: "text-indigo-600 dark:text-indigo-400",
      sub: counts.inQueue > 0 ? `${counts.inQueue} currently in queue` : "All queued & rejected",
    },
    {
      label: "Delivered",
      value: counts.delivered,
      href: "/messages?status=delivered",
      icon: CheckCircle2,
      accent: "text-emerald-600 dark:text-emerald-400",
      sub: counts.total > 0 ? `${Math.round((counts.delivered / counts.total) * 100)}% of total` : "—",
    },
    {
      label: "Deferred",
      value: counts.deferred,
      href: "/messages?status=deferred",
      icon: Clock,
      accent: "text-amber-600 dark:text-amber-400",
      sub: "Temporary delays / retries",
    },
    {
      label: "Bounced",
      value: counts.bounced,
      href: "/messages?status=bounced",
      icon: XCircle,
      accent: "text-rose-600 dark:text-rose-400",
      sub: "Permanent delivery failures",
    },
    {
      label: "Rejected",
      value: counts.rejected,
      href: "/messages?status=rejected",
      icon: ShieldAlert,
      accent: "text-purple-600 dark:text-purple-400",
      sub: "NOQUEUE RBL / policy blocks",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mail Flow Overview</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Last 24 hours activity and delivery diagnostics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {stats.filesRead} log source{stats.filesRead === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-xs transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-xs transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {card.label}
                </span>
                <Icon className={`h-4 w-4 ${card.accent}`} />
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">
                {loading && !stats ? "—" : card.value.toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{card.sub}</p>
            </Link>
          );
        })}
      </div>

      {/* 24h Hourly Volume Chart */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">24-Hour Mail Volume</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Messages grouped by hour and outcome
            </p>
          </div>
          <Link
            href="/messages"
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Inspect all messages →
          </Link>
        </div>

        <div className="h-72 w-full">
          {mounted && stats ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.hourly}
                margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#71717a" strokeOpacity={0.2} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(24, 24, 27, 0.92)",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                    color: "#f4f4f5",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="delivered" name="Delivered" stackId="a" fill="#10b981" />
                <Bar dataKey="deferred" name="Deferred" stackId="a" fill="#f59e0b" />
                <Bar dataKey="bounced" name="Bounced" stackId="a" fill="#f43f5e" />
                <Bar
                  dataKey="rejected"
                  name="Rejected"
                  stackId="a"
                  fill="#a855f7"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">
              Loading chart…
            </div>
          )}
        </div>
      </div>

      {/* Bottom panels: Top Failure Reasons + Top Recipient Domains */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <h2 className="text-base font-semibold">Top Bounce, Deferral & Reject Reasons</h2>
          </div>
          {!stats || stats.topReasons.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No bounce, deferral, or rejection events recorded.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {stats.topReasons.map((item) => (
                <div
                  key={`${item.status}:${item.reason}`}
                  className="flex items-start justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-zinc-800 dark:text-zinc-200">
                      {item.reason}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Top Recipient Domains</h2>
          {!stats || stats.topRecipientDomains.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No recipient domains found.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.topRecipientDomains.map((item) => {
                const maxCount = stats.topRecipientDomains[0]?.count || 1;
                const widthPct = Math.max(8, Math.round((item.count / maxCount) * 100));
                return (
                  <div key={item.domain} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {item.domain}
                      </span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {item.count}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
