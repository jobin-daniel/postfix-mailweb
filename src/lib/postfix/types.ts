export type DeliveryStatus = "sent" | "deferred" | "bounced" | "expired";

export type OverallMessageStatus =
  | "delivered"
  | "deferred"
  | "bounced"
  | "in-queue"
  | "rejected";

export interface ParsedSyslogLine {
  lineNumber: number;
  raw: string;
  timestamp: string; // ISO-8601 UTC string
  timestampMs: number;
  host: string;
  process: string;
  pid: number | null;
  body: string;
  queueId: string | null;
}

export interface DeliveryAttempt {
  recipient: string;
  relay: string;
  delay: number | null; // seconds
  delays: string | null;
  dsn: string | null;
  status: DeliveryStatus;
  detail: string;
  timestamp: string;
  process: string;
}

export interface MessageEvent {
  timestamp: string;
  process: string;
  pid: number | null;
  summary: string;
  raw: string;
  kind:
    | "client"
    | "tls"
    | "cleanup"
    | "qmgr"
    | "delivery"
    | "bounce"
    | "timeout"
    | "reject"
    | "other";
}

export interface MailMessage {
  kind: "queued" | "rejected";
  queueId: string;
  messageId: string | null;
  from: string;
  to: string[];
  size: number | null;
  nrcpt: number | null;
  client: string | null;
  tlsInfo: string | null;
  firstTimestamp: string;
  lastTimestamp: string;
  firstTimestampMs: number;
  lastTimestampMs: number;
  status: OverallMessageStatus;
  attempts: DeliveryAttempt[];
  events: MessageEvent[];
  rawLines: string[];
  /** Primary relay shown in table summary (latest attempt or client for rejected) */
  primaryRelay: string | null;
  /** Primary delay in seconds shown in table summary (latest attempt) */
  primaryDelay: number | null;
  /** Primary detail text for rejections or latest non-sent attempt */
  primaryDetail: string | null;
  /** Rejection detail when kind === 'rejected' */
  rejectReason: string | null;
}

export interface ParseOptions {
  timezone?: string;
  tz?: string;
  /** Reference date used to resolve syslog year and Dec->Jan rollover */
  referenceDate?: Date;
}

export interface ParseResult {
  messages: MailMessage[];
  byQueueId: Record<string, MailMessage>;
  totalLines: number;
  totalLinesParsed: number;
  unparsedLines: number;
}

export interface HourlyBucket {
  hour: string;
  label: string;
  delivered: number;
  deferred: number;
  bounced: number;
  rejected: number;
  total: number;
}

export interface DomainStat {
  domain: string;
  count: number;
}

export interface ReasonStat {
  reason: string;
  count: number;
  status: "deferred" | "bounced" | "rejected";
}

export interface MailStats {
  counts: {
    total: number;
    delivered: number;
    deferred: number;
    bounced: number;
    inQueue: number;
    rejected: number;
  };
  hourly: HourlyBucket[];
  topRecipientDomains: DomainStat[];
  topReasons: ReasonStat[];
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
}
