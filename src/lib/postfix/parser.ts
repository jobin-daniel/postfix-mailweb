import crypto from "node:crypto";
import type {
  DeliveryAttempt,
  DeliveryStatus,
  MailMessage,
  MessageEvent,
  OverallMessageStatus,
  ParsedSyslogLine,
  ParseOptions,
  ParseResult,
} from "./types";

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const BSD_SYSLOG_RE =
  /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\S+)\s+([^\s[:]+)(?:\[(\d+)\])?:\s*(.*)$/;

const ISO_SYSLOG_RE =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\S+)\s+([^\s[:]+)(?:\[(\d+)\])?:\s*(.*)$/;

const QUEUE_LINE_RE = /^([0-9A-Za-z]{6,20}):\s+(.*)$/;
const NOQUEUE_REJECT_RE = /^NOQUEUE:\s*reject:\s*([A-Z]+)\s+from\s+(\S+):\s*(.*)$/;

const DELIVERY_RE =
  /^to=<([^>]*)>,\s*(?:orig_to=<([^>]*)>,\s*)?relay=([^,]+),\s*(?:conn_use=\d+,\s*)?delay=([^,]+),\s*(?:delays=([^,]+),\s*)?dsn=([^,]+),\s*status=(sent|deferred|bounced|expired)\s*\((.*)\)$/;

const MESSAGE_ID_RE = /\bmessage-id=<([^>]*)>/;
const QMGR_FROM_RE = /^from=<([^>]*)>,\s*size=(\d+)(?:,\s*nrcpt=(\d+))?/;
const CLIENT_RE = /^client=(\S+)/;
const TLS_RE = /^(Anonymous|Trusted|Verified)\s+TLS connection established\s+(.+)$/;
const TIMEOUT_RE = /^connect to\s+([^:]+:\d+):\s*(.+)$/;
const BOUNCE_DSN_RE = /^sender non-delivery notification:\s*([0-9A-Za-z]+)/;
const FROM_TAG_RE = /\bfrom=<([^>]*)>/;
const TO_TAG_RE = /\bto=<([^>]*)>/;

const NON_QUEUE_TOKENS = new Set([
  "NOQUEUE",
  "warning",
  "fatal",
  "panic",
  "connect",
  "disconnect",
  "Anonymous",
  "Trusted",
  "Verified",
  "statistics",
  "daemon",
  "timeout",
]);

function isLikelyQueueId(token: string): boolean {
  if (NON_QUEUE_TOKENS.has(token)) return false;
  if (/^[0-9A-F]{8,16}$/.test(token)) return true;
  if (/^[0-9A-Za-z]{10,20}$/.test(token) && /\d/.test(token)) return true;
  return false;
}

function zonedTimeToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  const naiveUtc = Date.UTC(year, monthIndex, day, hour, minute, second);
  if (timezone.toUpperCase() === "UTC" || timezone === "Etc/UTC") {
    return naiveUtc;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return naiveUtc;
  }

  const getLocalMs = (epochMs: number): number => {
    const parts = formatter.formatToParts(new Date(epochMs));
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== "literal") {
        map[p.type] = Number.parseInt(p.value, 10);
      }
    }
    const h = map.hour === 24 ? 0 : map.hour;
    return Date.UTC(map.year, map.month - 1, map.day, h, map.minute, map.second);
  };

  const firstOffset = getLocalMs(naiveUtc) - naiveUtc;
  const candidate = naiveUtc - firstOffset;
  const secondOffset = getLocalMs(candidate) - candidate;
  return naiveUtc - secondOffset;
}

function getYearInTimezone(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(date);
    const yearPart = parts.find((p) => p.type === "year");
    if (yearPart) return Number.parseInt(yearPart.value, 10);
  } catch {
    // Fallback to UTC year
  }
  return date.getUTCFullYear();
}

export function parseSyslogTimestamp(
  monthName: string,
  day: number,
  hour: number,
  minute: number,
  second: number,
  options: ParseOptions = {},
): Date {
  const monthIndex = MONTHS[monthName];
  if (monthIndex === undefined) {
    throw new Error(`Invalid syslog month: ${monthName}`);
  }
  const timezone = options.tz ?? options.timezone ?? process.env.TZ ?? "UTC";
  const referenceDate = options.referenceDate ?? new Date();
  const refYear = getYearInTimezone(referenceDate, timezone);

  let utcMs = zonedTimeToUtcMs(refYear, monthIndex, day, hour, minute, second, timezone);
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (utcMs - referenceDate.getTime() > oneDayMs) {
    utcMs = zonedTimeToUtcMs(refYear - 1, monthIndex, day, hour, minute, second, timezone);
  }

  return new Date(utcMs);
}

export function parseIsoTimestamp(tsText: string): number | null {
  let normalized = tsText.trim().replace(" ", "T");
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function parseLine(
  rawLine: string,
  options: ParseOptions = {},
  lineNumber = 1,
): ParsedSyslogLine | null {
  const raw = rawLine.trimEnd();
  if (!raw) return null;

  const timezone = options.tz ?? options.timezone ?? process.env.TZ ?? "UTC";
  const referenceDate = options.referenceDate ?? new Date();

  let timestampMs: number | null = null;
  let host = "";
  let processName = "";
  let pidStr: string | undefined;
  let body = "";

  const bsdMatch = raw.match(BSD_SYSLOG_RE);
  if (bsdMatch) {
    const dt = parseSyslogTimestamp(
      bsdMatch[1],
      Number.parseInt(bsdMatch[2], 10),
      Number.parseInt(bsdMatch[3], 10),
      Number.parseInt(bsdMatch[4], 10),
      Number.parseInt(bsdMatch[5], 10),
      { timezone, referenceDate },
    );
    timestampMs = dt.getTime();
    host = bsdMatch[6];
    processName = bsdMatch[7];
    pidStr = bsdMatch[8];
    body = bsdMatch[9];
  } else {
    const isoMatch = raw.match(ISO_SYSLOG_RE);
    if (!isoMatch) return null;
    timestampMs = parseIsoTimestamp(isoMatch[1]);
    host = isoMatch[2];
    processName = isoMatch[3];
    pidStr = isoMatch[4];
    body = isoMatch[5];
  }

  if (timestampMs === null) return null;

  const pid = pidStr ? Number.parseInt(pidStr, 10) : null;
  let queueId: string | null = null;
  let normalizedBody = body;
  const qMatch = body.match(QUEUE_LINE_RE);
  if (qMatch && isLikelyQueueId(qMatch[1])) {
    queueId = qMatch[1];
    normalizedBody = qMatch[2];
  }

  return {
    lineNumber,
    raw,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    host,
    process: processName,
    pid: pid !== null && Number.isFinite(pid) ? pid : null,
    body: normalizedBody,
    queueId,
  };
}

export function parseSyslogLine(
  rawLine: string,
  lineNumber: number,
  options: ParseOptions = {},
): ParsedSyslogLine | null {
  return parseLine(rawLine, options, lineNumber);
}

function deriveOverallStatus(
  attempts: DeliveryAttempt[],
  nrcpt: number | null,
  removed: boolean,
): OverallMessageStatus {
  if (attempts.length === 0) {
    return "in-queue";
  }

  const latestByRecipient = new Map<string, DeliveryAttempt>();
  for (const attempt of attempts) {
    latestByRecipient.set(attempt.recipient || "__unknown__", attempt);
  }

  const statuses = Array.from(latestByRecipient.values()).map((a) => a.status);
  if (statuses.some((s) => s === "bounced" || s === "expired")) {
    return "bounced";
  }
  if (statuses.some((s) => s === "deferred")) {
    return "deferred";
  }
  if (nrcpt !== null && latestByRecipient.size < nrcpt && !removed) {
    return "in-queue";
  }
  if (statuses.every((s) => s === "sent")) {
    return "delivered";
  }
  return "in-queue";
}

interface PendingProcessContext {
  tlsInfo?: string;
  connectEvent?: MessageEvent;
  tlsEvent?: MessageEvent;
  timeoutEvent?: MessageEvent;
  lastTimestampMs: number;
}

interface MutableQueuedMessage {
  queueId: string;
  messageId: string | null;
  from: string;
  toSet: Set<string>;
  size: number | null;
  nrcpt: number | null;
  client: string | null;
  tlsInfo: string | null;
  firstTimestampMs: number;
  lastTimestampMs: number;
  attempts: DeliveryAttempt[];
  events: MessageEvent[];
  rawLines: string[];
  removed: boolean;
}

function makeRejectId(raw: string, lineNumber: number): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${lineNumber}:${raw}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `NOQUEUE-${hash}`;
}

export function parsePostfixLogs(
  logText: string,
  options: ParseOptions = {},
): ParseResult {
  const lines = logText.split(/\r?\n/);
  const queuedMap = new Map<string, MutableQueuedMessage>();
  const rejectedMessages: MailMessage[] = [];
  const processContext = new Map<string, PendingProcessContext>();

  let totalLines = 0;
  let totalLinesParsed = 0;
  let unparsedLines = 0;

  const getOrCreateQueued = (
    queueId: string,
    timestampMs: number,
  ): MutableQueuedMessage => {
    let msg = queuedMap.get(queueId);
    if (!msg) {
      msg = {
        queueId,
        messageId: null,
        from: "",
        toSet: new Set<string>(),
        size: null,
        nrcpt: null,
        client: null,
        tlsInfo: null,
        firstTimestampMs: timestampMs,
        lastTimestampMs: timestampMs,
        attempts: [],
        events: [],
        rawLines: [],
        removed: false,
      };
      queuedMap.set(queueId, msg);
    } else {
      if (timestampMs < msg.firstTimestampMs) msg.firstTimestampMs = timestampMs;
      if (timestampMs > msg.lastTimestampMs) msg.lastTimestampMs = timestampMs;
    }
    return msg;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    totalLines++;

    const parsed = parseLine(rawLine, options, i + 1);
    if (!parsed) {
      unparsedLines++;
      continue;
    }

    if (!parsed.process.startsWith("postfix")) {
      continue;
    }

    totalLinesParsed++;
    const procKey = `${parsed.host}:${parsed.process}:${parsed.pid ?? "0"}`;

    if (!parsed.queueId) {
      const noqueueMatch = parsed.body.match(NOQUEUE_REJECT_RE);
      if (noqueueMatch) {
        const stage = noqueueMatch[1];
        const client = noqueueMatch[2];
        const rest = noqueueMatch[3];
        const fromMatch = rest.match(FROM_TAG_RE);
        const toMatch = rest.match(TO_TAG_RE);
        const detailText = rest.split(/;\s*from=/)[0].trim();

        const ctx = processContext.get(procKey);
        const events: MessageEvent[] = [];
        const rawLines: string[] = [];

        if (ctx && Math.abs(parsed.timestampMs - ctx.lastTimestampMs) <= 120_000) {
          if (ctx.connectEvent) {
            events.push(ctx.connectEvent);
            rawLines.push(ctx.connectEvent.raw);
          }
          if (ctx.tlsEvent) {
            events.push(ctx.tlsEvent);
            rawLines.push(ctx.tlsEvent.raw);
          }
        }

        events.push({
          timestamp: parsed.timestamp,
          process: parsed.process,
          pid: parsed.pid,
          summary: `Rejected (${stage}): ${detailText}`,
          raw: parsed.raw,
          kind: "reject",
        });
        rawLines.push(parsed.raw);

        const toList = toMatch && toMatch[1] ? [toMatch[1]] : [];
        rejectedMessages.push({
          kind: "rejected",
          queueId: makeRejectId(parsed.raw, parsed.lineNumber),
          messageId: null,
          from: fromMatch?.[1] ?? "",
          to: toList,
          size: null,
          nrcpt: toList.length || null,
          client,
          tlsInfo: ctx?.tlsInfo ?? null,
          firstTimestamp: parsed.timestamp,
          lastTimestamp: parsed.timestamp,
          firstTimestampMs: parsed.timestampMs,
          lastTimestampMs: parsed.timestampMs,
          status: "rejected",
          attempts: [],
          events,
          rawLines,
          primaryRelay: client,
          primaryDelay: null,
          primaryDetail: detailText,
          rejectReason: detailText,
        });
        continue;
      }

      if (parsed.body.startsWith("connect from ")) {
        processContext.set(procKey, {
          connectEvent: {
            timestamp: parsed.timestamp,
            process: parsed.process,
            pid: parsed.pid,
            summary: parsed.body,
            raw: parsed.raw,
            kind: "client",
          },
          lastTimestampMs: parsed.timestampMs,
        });
      } else if (parsed.body.startsWith("disconnect from ")) {
        processContext.delete(procKey);
      } else {
        const tlsMatch = parsed.body.match(TLS_RE);
        if (tlsMatch) {
          const prev = processContext.get(procKey) ?? { lastTimestampMs: parsed.timestampMs };
          prev.tlsInfo = `${tlsMatch[1]} TLS ${tlsMatch[2]}`;
          prev.lastTimestampMs = parsed.timestampMs;
          prev.tlsEvent = {
            timestamp: parsed.timestamp,
            process: parsed.process,
            pid: parsed.pid,
            summary: parsed.body,
            raw: parsed.raw,
            kind: "tls",
          };
          processContext.set(procKey, prev);
        } else {
          const timeoutMatch = parsed.body.match(TIMEOUT_RE);
          if (timeoutMatch) {
            const prev = processContext.get(procKey) ?? { lastTimestampMs: parsed.timestampMs };
            prev.timeoutEvent = {
              timestamp: parsed.timestamp,
              process: parsed.process,
              pid: parsed.pid,
              summary: parsed.body,
              raw: parsed.raw,
              kind: "timeout",
            };
            prev.lastTimestampMs = parsed.timestampMs;
            processContext.set(procKey, prev);
          }
        }
      }
      continue;
    }

    const queueId = parsed.queueId;
    const msg = getOrCreateQueued(queueId, parsed.timestampMs);
    const bodyAfterQueue = parsed.body;

    const ctx = processContext.get(procKey);
    if (ctx && Math.abs(parsed.timestampMs - ctx.lastTimestampMs) <= 120_000) {
      if (ctx.tlsInfo && !msg.tlsInfo) {
        msg.tlsInfo = ctx.tlsInfo;
      }
      if (ctx.timeoutEvent && !msg.events.some((e) => e.raw === ctx.timeoutEvent!.raw)) {
        msg.events.push(ctx.timeoutEvent);
        msg.rawLines.push(ctx.timeoutEvent.raw);
        ctx.timeoutEvent = undefined;
      }
      if (ctx.tlsEvent && !msg.events.some((e) => e.raw === ctx.tlsEvent!.raw)) {
        msg.events.push(ctx.tlsEvent);
        msg.rawLines.push(ctx.tlsEvent.raw);
        ctx.tlsEvent = undefined;
      }
      if (
        parsed.process === "postfix/smtpd" &&
        ctx.connectEvent &&
        !msg.events.some((e) => e.raw === ctx.connectEvent!.raw)
      ) {
        msg.events.push(ctx.connectEvent);
        msg.rawLines.push(ctx.connectEvent.raw);
      }
    }

    msg.rawLines.push(parsed.raw);

    const clientMatch = bodyAfterQueue.match(CLIENT_RE);
    const msgIdMatch = bodyAfterQueue.match(MESSAGE_ID_RE);
    const qmgrFromMatch = bodyAfterQueue.match(QMGR_FROM_RE);
    const deliveryMatch = bodyAfterQueue.match(DELIVERY_RE);
    const bounceMatch = bodyAfterQueue.match(BOUNCE_DSN_RE);

    if (clientMatch) {
      msg.client = clientMatch[1];
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: `Client connected: ${clientMatch[1]}`,
        raw: parsed.raw,
        kind: "client",
      });
    } else if (msgIdMatch) {
      msg.messageId = msgIdMatch[1];
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: `Message-ID: <${msgIdMatch[1]}>`,
        raw: parsed.raw,
        kind: "cleanup",
      });
    } else if (qmgrFromMatch) {
      msg.from = qmgrFromMatch[1];
      msg.size = Number.parseInt(qmgrFromMatch[2], 10);
      if (qmgrFromMatch[3]) {
        msg.nrcpt = Number.parseInt(qmgrFromMatch[3], 10);
      }
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: `Queued from <${msg.from || "MAILER-DAEMON"}> (${msg.size} bytes)`,
        raw: parsed.raw,
        kind: "qmgr",
      });
    } else if (bodyAfterQueue === "removed") {
      msg.removed = true;
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: "Removed from queue",
        raw: parsed.raw,
        kind: "qmgr",
      });
    } else if (deliveryMatch) {
      const recipient = deliveryMatch[1];
      const relay = deliveryMatch[3].trim();
      const delayNum = Number.parseFloat(deliveryMatch[4]);
      const delays = deliveryMatch[5]?.trim() ?? null;
      const dsn = deliveryMatch[6].trim();
      const status = deliveryMatch[7] as DeliveryStatus;
      const detail = deliveryMatch[8].trim();

      if (recipient) msg.toSet.add(recipient);
      const attempt: DeliveryAttempt = {
        recipient,
        relay,
        delay: Number.isFinite(delayNum) ? delayNum : null,
        delays,
        dsn,
        status,
        detail,
        timestamp: parsed.timestamp,
        process: parsed.process,
      };
      msg.attempts.push(attempt);
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: `${status.toUpperCase()} to <${recipient}> via ${relay}: ${detail}`,
        raw: parsed.raw,
        kind: "delivery",
      });
    } else if (bounceMatch) {
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: `Generated bounce notification ${bounceMatch[1]}`,
        raw: parsed.raw,
        kind: "bounce",
      });
    } else {
      msg.events.push({
        timestamp: parsed.timestamp,
        process: parsed.process,
        pid: parsed.pid,
        summary: bodyAfterQueue,
        raw: parsed.raw,
        kind: "other",
      });
    }
  }

  const queuedMessages: MailMessage[] = Array.from(queuedMap.values()).map((m) => {
    const status = deriveOverallStatus(m.attempts, m.nrcpt, m.removed);
    const latestAttempt = m.attempts.length > 0 ? m.attempts[m.attempts.length - 1] : null;
    const failureAttempt =
      [...m.attempts].reverse().find((a) => a.status !== "sent") ?? latestAttempt;

    m.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      kind: "queued",
      queueId: m.queueId,
      messageId: m.messageId,
      from: m.from,
      to: Array.from(m.toSet),
      size: m.size,
      nrcpt: m.nrcpt,
      client: m.client,
      tlsInfo: m.tlsInfo,
      firstTimestamp: new Date(m.firstTimestampMs).toISOString(),
      lastTimestamp: new Date(m.lastTimestampMs).toISOString(),
      firstTimestampMs: m.firstTimestampMs,
      lastTimestampMs: m.lastTimestampMs,
      status,
      attempts: m.attempts,
      events: m.events,
      rawLines: m.rawLines,
      primaryRelay: latestAttempt?.relay ?? null,
      primaryDelay: latestAttempt?.delay ?? null,
      primaryDetail: failureAttempt?.detail ?? null,
      rejectReason: null,
    };
  });

  const allMessages = [...queuedMessages, ...rejectedMessages].sort(
    (a, b) => b.lastTimestampMs - a.lastTimestampMs,
  );

  const byQueueId: Record<string, MailMessage> = {};
  for (const msg of allMessages) {
    byQueueId[msg.queueId] = msg;
  }

  return {
    messages: allMessages,
    byQueueId,
    totalLines,
    totalLinesParsed,
    unparsedLines,
  };
}
