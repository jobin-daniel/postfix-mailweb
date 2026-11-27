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

describe("sample-data/mail.log integration", () => {
  it("reads at least 200 lines and produces all expected statuses and stats", async () => {
    const config: AppConfig = {
      logSource: "sample",
      logPath: "/var/log/mail.log",
      sampleLogPath: path.resolve(process.cwd(), "sample-data", "mail.log"),
      includeRotated: false,
      journaldMaxLines: 5000,
      timezone: "UTC",
    };

    const { result, cacheHit } = await getParsedLogs(config);
    expect(cacheHit).toBe(false);
    expect(result.totalLines).toBeGreaterThanOrEqual(200);

    // Second read hits cache
    const second = await getParsedLogs(config);
    expect(second.cacheHit).toBe(true);

    const stats = computeMailStats(result.messages);
    expect(stats.counts.delivered).toBeGreaterThan(0);
    expect(stats.counts.deferred).toBeGreaterThan(0);
    expect(stats.counts.bounced).toBeGreaterThan(0);
    expect(stats.counts.rejected).toBeGreaterThan(0);
    expect(stats.counts.inQueue).toBeGreaterThan(0);
    expect(stats.hourly).toHaveLength(24);
    expect(stats.topRecipientDomains.length).toBeGreaterThan(0);
    expect(stats.topReasons.length).toBeGreaterThan(0);

    // Filtering & pagination
    const bouncedOnly = filterAndPaginateMessages(result.messages, {
      status: "bounced",
      page: 1,
      pageSize: 10,
    });
    expect(bouncedOnly.items.every((m) => m.status === "bounced")).toBe(true);
    expect(bouncedOnly.total).toBe(stats.counts.bounced);

    const spamhausSearch = filterAndPaginateMessages(result.messages, {
      q: "spamhaus",
    });
    expect(spamhausSearch.total).toBeGreaterThan(0);
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
      sampleLogPath: active,
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
      sampleLogPath: logFile,
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
