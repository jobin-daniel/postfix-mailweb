import { getAppConfig, type LogSourceMode } from "@/lib/config";
import type {
  DomainStat,
  HourlyBucket,
  MailMessage,
  MailStats,
  ReasonStat,
} from "./types";

function extractDomain(email: string): string | null {
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 0 || atIdx === email.length - 1) return null;
  return email.slice(atIdx + 1).toLowerCase();
}

function normalizeFailureReason(detail: string): string {
  let clean = detail
    .replace(/\s*\(in reply to [^)]+\)\s*$/i, "")
    .replace(/^host\s+\S+\s+said:\s*/i, "")
    .trim();
  if (clean.length > 120) {
    clean = `${clean.slice(0, 117)}...`;
  }
  return clean || "Unknown failure";
}

function formatHourLabel(epochMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(epochMs));
  } catch {
    const d = new Date(epochMs);
    return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  }
}

export interface ComputeStatsOptions {
  timezone?: string;
  now?: Date;
  logSource?: LogSourceMode;
}

export function computeMailStats(
  messages: MailMessage[],
  options: ComputeStatsOptions = {},
): MailStats {
  const config = getAppConfig();
  const timezone = options.timezone ?? config.timezone;
  const logSource = options.logSource ?? config.logSource;
  const nowDate = options.now ?? new Date();

  let delivered = 0;
  let deferred = 0;
  let bounced = 0;
  let inQueue = 0;
  let rejected = 0;

  const domainCounts = new Map<string, number>();
  const reasonCounts = new Map<
    string,
    { count: number; status: "deferred" | "bounced" | "rejected" }
  >();

  for (const msg of messages) {
    switch (msg.status) {
      case "delivered":
        delivered++;
        break;
      case "deferred":
        deferred++;
        break;
      case "bounced":
        bounced++;
        break;
      case "in-queue":
        inQueue++;
        break;
      case "rejected":
        rejected++;
        break;
    }

    for (const rcpt of msg.to) {
      const domain = extractDomain(rcpt);
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }

    if (msg.status === "rejected" && msg.primaryDetail) {
      const reason = normalizeFailureReason(msg.primaryDetail);
      const existing = reasonCounts.get(reason);
      reasonCounts.set(reason, {
        count: (existing?.count ?? 0) + 1,
        status: existing?.status ?? "rejected",
      });
    } else {
      for (const attempt of msg.attempts) {
        if (
          attempt.status === "deferred" ||
          attempt.status === "bounced" ||
          attempt.status === "expired"
        ) {
          const reason = normalizeFailureReason(attempt.detail);
          const mappedStatus = attempt.status === "deferred" ? "deferred" : "bounced";
          const existing = reasonCounts.get(reason);
          reasonCounts.set(reason, {
            count: (existing?.count ?? 0) + 1,
            status: existing?.status ?? mappedStatus,
          });
        }
      }
    }
  }

  let windowEndMs = nowDate.getTime();
  const hourMs = 60 * 60 * 1000;
  const window24hMs = 24 * hourMs;
  if (
    logSource === "sample" &&
    messages.length > 0 &&
    !messages.some(
      (m) => m.lastTimestampMs >= windowEndMs - window24hMs && m.lastTimestampMs <= windowEndMs,
    )
  ) {
    windowEndMs = Math.max(...messages.map((m) => m.lastTimestampMs));
  }

  const endHourStartMs = Math.floor(windowEndMs / hourMs) * hourMs;
  const startHourMs = endHourStartMs - 23 * hourMs;

  const buckets: HourlyBucket[] = [];
  for (let i = 0; i < 24; i++) {
    const bucketStart = startHourMs + i * hourMs;
    buckets.push({
      hour: new Date(bucketStart).toISOString(),
      label: formatHourLabel(bucketStart, timezone),
      delivered: 0,
      deferred: 0,
      bounced: 0,
      rejected: 0,
      total: 0,
    });
  }

  for (const msg of messages) {
    const ts = msg.lastTimestampMs;
    if (ts < startHourMs || ts >= endHourStartMs + hourMs) continue;
    const idx = Math.floor((ts - startHourMs) / hourMs);
    const bucket = buckets[idx];
    if (!bucket) continue;

    bucket.total++;
    if (msg.status === "delivered") bucket.delivered++;
    else if (msg.status === "deferred") bucket.deferred++;
    else if (msg.status === "bounced") bucket.bounced++;
    else if (msg.status === "rejected") bucket.rejected++;
  }

  const topRecipientDomains: DomainStat[] = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, 8);

  const topReasons: ReasonStat[] = Array.from(reasonCounts.entries())
    .map(([reason, info]) => ({ reason, count: info.count, status: info.status }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 8);

  return {
    counts: {
      total: messages.length,
      delivered,
      deferred,
      bounced,
      inQueue,
      rejected,
    },
    hourly: buckets,
    topRecipientDomains,
    topReasons,
    generatedAt: nowDate.toISOString(),
    windowStart: new Date(startHourMs).toISOString(),
    windowEnd: new Date(endHourStartMs + hourMs).toISOString(),
  };
}
