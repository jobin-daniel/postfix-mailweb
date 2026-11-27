import type { MailMessage, OverallMessageStatus } from "./types";

export interface MessageQueryParams {
  q?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: number;
  pageSize?: number;
}

export interface MessageSummary {
  kind: MailMessage["kind"];
  queueId: string;
  messageId: string | null;
  from: string;
  to: string[];
  size: number | null;
  client: string | null;
  tlsInfo: string | null;
  firstTimestamp: string;
  lastTimestamp: string;
  status: OverallMessageStatus;
  primaryRelay: string | null;
  primaryDelay: number | null;
  primaryDetail: string | null;
  attemptCount: number;
}

export interface PaginatedMessagesResult {
  items: MessageSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const VALID_STATUSES = new Set<OverallMessageStatus>([
  "delivered",
  "deferred",
  "bounced",
  "in-queue",
  "rejected",
]);

function parseDateBound(raw: string | null | undefined, endOfDay: boolean): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Date-only input YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const ms = Date.parse(`${trimmed}${suffix}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

export function queryMessages(
  messages: MailMessage[],
  params: MessageQueryParams,
): PaginatedMessagesResult {
  const q = params.q?.trim().toLowerCase() ?? "";
  const fromFilter = params.from?.trim().toLowerCase() ?? "";
  const toFilter = params.to?.trim().toLowerCase() ?? "";
  const rawStatus = params.status?.trim().toLowerCase() ?? "";
  const statusSet = new Set<OverallMessageStatus>();

  if (rawStatus && rawStatus !== "all") {
    for (const part of rawStatus.split(",")) {
      const s = part.trim() as OverallMessageStatus;
      if (VALID_STATUSES.has(s)) {
        statusSet.add(s);
      }
    }
  }

  const dateFromMs = parseDateBound(params.dateFrom, false);
  const dateToMs = parseDateBound(params.dateTo, true);

  const filtered = messages.filter((msg) => {
    if (statusSet.size > 0 && !statusSet.has(msg.status)) {
      return false;
    }

    if (fromFilter && !msg.from.toLowerCase().includes(fromFilter)) {
      return false;
    }

    if (toFilter && !msg.to.some((rcpt) => rcpt.toLowerCase().includes(toFilter))) {
      return false;
    }

    if (dateFromMs !== null && msg.lastTimestampMs < dateFromMs) {
      return false;
    }

    if (dateToMs !== null && msg.lastTimestampMs > dateToMs) {
      return false;
    }

    if (q) {
      const matchesQueue = msg.queueId.toLowerCase().includes(q);
      const matchesMsgId = msg.messageId?.toLowerCase().includes(q) ?? false;
      const matchesFrom = msg.from.toLowerCase().includes(q);
      const matchesTo = msg.to.some((rcpt) => rcpt.toLowerCase().includes(q));
      const matchesRelay = msg.primaryRelay?.toLowerCase().includes(q) ?? false;
      const matchesDetail =
        (msg.primaryDetail?.toLowerCase().includes(q) ?? false) ||
        msg.attempts.some(
          (a) =>
            a.detail.toLowerCase().includes(q) || a.relay.toLowerCase().includes(q),
        );

      if (
        !matchesQueue &&
        !matchesMsgId &&
        !matchesFrom &&
        !matchesTo &&
        !matchesRelay &&
        !matchesDetail
      ) {
        return false;
      }
    }

    return true;
  });

  const pageSize = Math.max(1, Math.min(params.pageSize ?? 20, 100));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(params.page ?? 1, totalPages));
  const start = (page - 1) * pageSize;

  const items: MessageSummary[] = filtered
    .slice(start, start + pageSize)
    .map((msg) => ({
      kind: msg.kind,
      queueId: msg.queueId,
      messageId: msg.messageId,
      from: msg.from,
      to: msg.to,
      size: msg.size,
      client: msg.client,
      tlsInfo: msg.tlsInfo,
      firstTimestamp: msg.firstTimestamp,
      lastTimestamp: msg.lastTimestamp,
      status: msg.status,
      primaryRelay: msg.primaryRelay,
      primaryDelay: msg.primaryDelay,
      primaryDetail: msg.primaryDetail,
      attemptCount: msg.attempts.length,
    }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}
