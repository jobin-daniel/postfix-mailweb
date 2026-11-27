import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "@/lib/config";
import { clearLogCache, filterAndPaginateMessages, getParsedLogs } from "../cache";
import { readConfiguredLogs } from "../reader";
import { computeMailStats } from "../stats";
import { createLogTailer, type TailEvent } from "../tailer";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mail-log-viewer-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  clearLogCache();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("log file parsing, filtering, and stats integration", () => {
  it("parses log lines into all expected statuses and computes 24h stats", async () => {
    const dir = await makeTempDir();
    const logFile = path.join(dir, "mail.log");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const ts = `${months[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2, " ")} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:00`;

    await fs.writeFile(
      logFile,
      [
        `${ts} mail postfix/qmgr[1]: 4F3A001001A: from=<a@example.com>, size=1024, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[2]: 4F3A001001A: to=<u1@gmail.com>, relay=mx.google.com[1.2.3.4]:25, delay=0.9, delays=0.1/0/0.3/0.5, dsn=2.0.0, status=sent (250 OK)`,
        `${ts} mail postfix/qmgr[1]: 4F3A001002B: from=<b@example.com>, size=512, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[3]: 4F3A001002B: to=<u2@yahoo.com>, relay=mx.yahoo.com[2.3.4.5]:25, delay=1.4, delays=0.1/0/0.5/0.8, dsn=4.7.1, status=deferred (451 4.7.1 Greylisted)`,
        `${ts} mail postfix/qmgr[1]: 4F3A001003C: from=<c@example.com>, size=512, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[4]: 4F3A001003C: to=<u3@outlook.com>, relay=mx.outlook.com[3.4.5.6]:25, delay=0.8, delays=0.1/0/0.3/0.4, dsn=5.1.1, status=bounced (550 5.1.1 User unknown)`,
        `${ts} mail postfix/qmgr[1]: 4F3A001004D: from=<d@example.com>, size=256, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtpd[5]: NOQUEUE: reject: RCPT from unknown[185.220.101.45]: 554 5.7.1 Service unavailable; Client host [185.220.101.45] blocked using zen.spamhaus.org; from=<spam@evil.biz> to=<admin@example.com> proto=ESMTP`,
      ].join("\n"),
      "utf8",
    );

    const config: AppConfig = {
      logSource: "file",
      logPath: logFile,
      includeRotated: false,
      journaldMaxLines: 5000,
      timezone: "UTC",
    };

    const { result, cacheHit } = await getParsedLogs(config);
    expect(cacheHit).toBe(false);
    expect(result.totalLines).toBe(8);

    const second = await getParsedLogs(config);
    expect(second.cacheHit).toBe(true);

    const stats = computeMailStats(result.messages, { timezone: "UTC", now });
    expect(stats.counts.delivered).toBe(1);
    expect(stats.counts.deferred).toBe(1);
    expect(stats.counts.bounced).toBe(1);
    expect(stats.counts.rejected).toBe(1);
    expect(stats.counts.inQueue).toBe(1);
    expect(stats.hourly).toHaveLength(24);
    expect(stats.topRecipientDomains.length).toBeGreaterThan(0);
    expect(stats.topReasons.length).toBeGreaterThan(0);

    const bouncedOnly = filterAndPaginateMessages(result.messages, {
      status: "bounced",
      page: 1,
      pageSize: 10,
    });
    expect(bouncedOnly.items.every((m) => m.status === "bounced")).toBe(true);
    expect(bouncedOnly.total).toBe(1);

    const spamhausSearch = filterAndPaginateMessages(result.messages, {
      q: "spamhaus",
    });
    expect(spamhausSearch.total).toBe(1);
  });
});

describe("rotated & gzipped log reading + cache invalidation", () => {
  it("reads .2.gz, .1, and active mail.log in chronological order and invalidates cache on append", async () => {
    const dir = await makeTempDir();
    const active = path.join(dir, "mail.log");
    const rot1 = path.join(dir, "mail.log.1");
    const rot2gz = path.join(dir, "mail.log.2.gz");

    const lineOld =
      "Nov 26 08:00:00 mail postfix/qmgr[1]: 1111111111: from=<old@test>, size=100, nrcpt=1 (queue active)\n" +
      "Nov 26 08:00:01 mail postfix/smtp[2]: 1111111111: to=<r1@example.com>, relay=mx[1.1.1.1]:25, delay=0.2, dsn=2.0.0, status=sent (250 OK)\n";
    const lineMid =
      "Nov 27 09:00:00 mail postfix/qmgr[1]: 2222222222: from=<mid@test>, size=200, nrcpt=1 (queue active)\n" +
      "Nov 27 09:00:01 mail postfix/smtp[2]: 2222222222: to=<r2@example.com>, relay=mx[1.1.1.1]:25, delay=0.3, dsn=5.1.1, status=bounced (550 Bad)\n";
    const lineNew =
      "Nov 27 10:00:00 mail postfix/qmgr[1]: 3333333333: from=<new@test>, size=300, nrcpt=1 (queue active)\n";

    await fs.writeFile(rot2gz, zlib.gzipSync(Buffer.from(lineOld, "utf8")));
    await fs.writeFile(rot1, lineMid, "utf8");
    await fs.writeFile(active, lineNew, "utf8");

    const config: AppConfig = {
      logSource: "file",
      logPath: active,
      includeRotated: true,
      journaldMaxLines: 5000,
      timezone: "UTC",
    };

    const rawOut = await readConfiguredLogs(config);
    expect(rawOut.files.map((f) => path.basename(f.path))).toEqual([
      "mail.log.2.gz",
      "mail.log.1",
      "mail.log",
    ]);

    const first = await getParsedLogs(config);
    expect(first.cacheHit).toBe(false);
    expect(first.result.byQueueId["1111111111"]?.status).toBe("delivered");
    expect(first.result.byQueueId["2222222222"]?.status).toBe("bounced");
    expect(first.result.byQueueId["3333333333"]?.status).toBe("in-queue");

    // Cache hit before mutation
    const second = await getParsedLogs(config);
    expect(second.cacheHit).toBe(true);

    // Append delivery line to active file -> cache must invalidate
    await fs.appendFile(
      active,
      "Nov 27 10:00:05 mail postfix/smtp[2]: 3333333333: to=<r3@example.com>, relay=mx[1.1.1.1]:25, delay=0.4, dsn=2.0.0, status=sent (250 OK)\n",
      "utf8",
    );
    const third = await getParsedLogs(config);
    expect(third.cacheHit).toBe(false);
    expect(third.result.byQueueId["3333333333"]?.status).toBe("delivered");
  });
});

describe("createLogTailer", () => {
  it("emits newly appended messages and detects file truncation/rotation", async () => {
    const dir = await makeTempDir();
    const logFile = path.join(dir, "mail.log");
    await fs.writeFile(logFile, "", "utf8");

    const config: AppConfig = {
      logSource: "file",
      logPath: logFile,
      includeRotated: false,
      journaldMaxLines: 5000,
      timezone: "UTC",
    };

    const events: TailEvent[] = [];
    const tailer = createLogTailer((ev) => events.push(ev), config);
    await tailer.start();

    try {
      await fs.appendFile(
        logFile,
        "Nov 27 12:00:00 mail postfix/smtp[9]: 9999AAAA11: to=<live@example.com>, relay=mx[1.1.1.1]:25, delay=0.1, dsn=2.0.0, status=sent (250 OK)\n",
        "utf8",
      );

      await new Promise((r) => setTimeout(r, 1800));
      expect(events.some((e) => e.type === "messages" && e.messages?.[0]?.queueId === "9999AAAA11")).toBe(
        true,
      );

      // Simulate rotation via truncation + new content
      await fs.writeFile(
        logFile,
        "Nov 27 12:01:00 mail postfix/smtp[9]: 8888BBBB22: to=<rot@example.com>, relay=mx[1.1.1.1]:25, delay=0.1, dsn=2.0.0, status=sent (250 OK)\n",
        "utf8",
      );
      await new Promise((r) => setTimeout(r, 1800));
      expect(events.some((e) => e.type === "rotated")).toBe(true);
    } finally {
      tailer.stop();
    }
  });
});
