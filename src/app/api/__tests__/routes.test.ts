import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearArchiveCache } from "@/lib/mail/archive";
import { clearLogCache } from "@/lib/postfix/cache";
import { GET as getHealth } from "../health/route";
import { GET as getMessageDetail } from "../messages/[queueId]/route";
import { GET as getMessageEmail } from "../messages/[queueId]/email/route";
import { GET as getMessages } from "../messages/route";
import { GET as getStats } from "../stats/route";
import { GET as getStream } from "../stream/route";

describe("API Route Handlers (file mode)", () => {
  const prevSource = process.env.MAIL_LOG_SOURCE;
  const prevPath = process.env.MAIL_LOG_PATH;
  const prevRotated = process.env.MAIL_LOG_INCLUDE_ROTATED;
  const prevTz = process.env.TZ;
  const prevArchiveDir = process.env.MAIL_ARCHIVE_DIR;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mail-log-api-test-"));
    const logPath = path.join(tempDir, "mail.log");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const ts = `${months[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2, " ")} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:00`;

    await fs.writeFile(
      logPath,
      [
        `${ts} mail postfix/cleanup[1]: 4F3A001001A: message-id=<msg-1@example.com>`,
        `${ts} mail postfix/qmgr[1]: 4F3A001001A: from=<a@example.com>, size=1024, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[2]: 4F3A001001A: to=<u1@gmail.com>, relay=mx.google.com[1.2.3.4]:25, delay=0.9, delays=0.1/0/0.3/0.5, dsn=2.0.0, status=sent (250 OK)`,
        `${ts} mail postfix/qmgr[1]: 4F3A001002B: from=<b@example.com>, size=512, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[3]: 4F3A001002B: to=<u2@yahoo.com>, relay=mx.yahoo.com[2.3.4.5]:25, delay=1.4, delays=0.1/0/0.5/0.8, dsn=4.7.1, status=deferred (451 4.7.1 Greylisted)`,
        `${ts} mail postfix/qmgr[1]: 4F3A001003C: from=<c@example.com>, size=512, nrcpt=1 (queue active)`,
        `${ts} mail postfix/smtp[4]: 4F3A001003C: to=<u3@outlook.com>, relay=mx.outlook.com[3.4.5.6]:25, delay=0.8, delays=0.1/0/0.3/0.4, dsn=5.1.1, status=bounced (550 5.1.1 User unknown)`,
        `${ts} mail postfix/smtpd[5]: NOQUEUE: reject: RCPT from unknown[185.220.101.45]: 554 5.7.1 Service unavailable; Client host [185.220.101.45] blocked using zen.spamhaus.org; from=<spam@evil.biz> to=<admin@example.com> proto=ESMTP`,
      ].join("\n"),
      "utf8",
    );

    process.env.MAIL_LOG_SOURCE = "file";
    process.env.MAIL_LOG_PATH = logPath;
    process.env.MAIL_LOG_INCLUDE_ROTATED = "false";
    process.env.TZ = "UTC";
    clearLogCache();
  });

  afterEach(async () => {
    process.env.MAIL_LOG_SOURCE = prevSource;
    process.env.MAIL_LOG_PATH = prevPath;
    process.env.MAIL_LOG_INCLUDE_ROTATED = prevRotated;
    process.env.TZ = prevTz;
    process.env.MAIL_ARCHIVE_DIR = prevArchiveDir;
    clearLogCache();
    clearArchiveCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("GET /api/health returns ok status", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.source).toBe("file");
  });

  it("GET /api/stats returns counts, 24h hourly buckets, domains, and reasons", async () => {
    const res = await getStats();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("file");
    expect(data.counts.total).toBe(4);
    expect(data.counts.delivered).toBe(1);
    expect(data.counts.deferred).toBe(1);
    expect(data.counts.bounced).toBe(1);
    expect(data.counts.rejected).toBe(1);
    expect(data.hourly).toHaveLength(24);
    expect(data.topRecipientDomains.length).toBeGreaterThan(0);
    expect(data.topReasons.length).toBeGreaterThan(0);
  });

  it("GET /api/messages supports filtering, pagination, and newest-first order", async () => {
    const reqAll = new NextRequest("http://localhost:3000/api/messages?page=1&pageSize=2");
    const resAll = await getMessages(reqAll);
    expect(resAll.status).toBe(200);
    const allData = await resAll.json();
    expect(allData.items).toHaveLength(2);
    expect(allData.page).toBe(1);
    expect(allData.pageSize).toBe(2);
    expect(allData.totalPages).toBe(2);

    const reqFiltered = new NextRequest(
      "http://localhost:3000/api/messages?status=rejected&q=spamhaus",
    );
    const resFiltered = await getMessages(reqFiltered);
    expect(resFiltered.status).toBe(200);
    const filteredData = await resFiltered.json();
    expect(filteredData.total).toBe(1);
    expect(filteredData.items[0].status).toBe("rejected");
  });

  it("GET /api/messages/[queueId] returns detail, 404, or 400", async () => {
    const detailRes = await getMessageDetail(
      new NextRequest("http://localhost:3000/api/messages/4F3A001001A"),
      { params: Promise.resolve({ queueId: "4F3A001001A" }) },
    );
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();
    expect(detailJson.message.queueId).toBe("4F3A001001A");
    expect(detailJson.message.rawLines.length).toBeGreaterThan(0);

    const missingRes = await getMessageDetail(
      new NextRequest("http://localhost:3000/api/messages/DOESNOTEXIST999"),
      { params: Promise.resolve({ queueId: "DOESNOTEXIST999" }) },
    );
    expect(missingRes.status).toBe(404);

    const invalidRes = await getMessageDetail(
      new NextRequest("http://localhost:3000/api/messages/bad$id!"),
      { params: Promise.resolve({ queueId: "../../etc/passwd" }) },
    );
    expect(invalidRes.status).toBe(400);
  });

  it("GET /api/stream returns SSE stream with ready event", async () => {
    const controller = new AbortController();
    const req = new NextRequest("http://localhost:3000/api/stream", {
      signal: controller.signal,
    });
    const res = await getStream(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader) {
      const firstChunk = await reader.read();
      const text = new TextDecoder().decode(firstChunk.value);
      expect(text).toContain("event: ready");
      controller.abort();
      await reader.cancel();
    }
  });

  it("GET /api/messages/[queueId]/email returns not_configured or parsed email from archive", async () => {
    delete process.env.MAIL_ARCHIVE_DIR;
    const unconfRes = await getMessageEmail(
      new NextRequest("http://localhost:3000/api/messages/4F3A001001A/email"),
      { params: Promise.resolve({ queueId: "4F3A001001A" }) },
    );
    expect(unconfRes.status).toBe(200);
    const unconfJson = await unconfRes.json();
    expect(unconfJson).toEqual({ available: false, reason: "not_configured" });

    const archiveDir = path.join(tempDir, "Maildir");
    await fs.mkdir(path.join(archiveDir, "cur"), { recursive: true });
    await fs.writeFile(
      path.join(archiveDir, "cur", "1732786200.M1.mail:2,S"),
      [
        "From: Sender <a@example.com>",
        "To: u1@gmail.com",
        "Subject: Test Email Body",
        "Message-ID: <msg-1@example.com>",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>Hello real email!</p>",
      ].join("\r\n"),
      "utf8",
    );
    process.env.MAIL_ARCHIVE_DIR = archiveDir;
    clearArchiveCache();

    const foundRes = await getMessageEmail(
      new NextRequest("http://localhost:3000/api/messages/4F3A001001A/email"),
      { params: Promise.resolve({ queueId: "4F3A001001A" }) },
    );
    expect(foundRes.status).toBe(200);
    const foundJson = await foundRes.json();
    expect(foundJson.available).toBe(true);
    expect(foundJson.email.subject).toBe("Test Email Body");
    expect(foundJson.email.sanitizedHtml).toContain("<p>Hello real email!</p>");
  });
});
