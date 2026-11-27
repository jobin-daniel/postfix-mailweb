import { describe, expect, it } from "vitest";
import { parseLine, parsePostfixLogs, parseSyslogTimestamp } from "../parser";

describe("parseSyslogTimestamp", () => {
  it("handles year rollover when December logs are read in January", () => {
    const janRef = new Date("2026-01-01T00:05:00Z");
    const parsed = parseSyslogTimestamp("Dec", 31, 23, 59, 58, {
      tz: "UTC",
      referenceDate: janRef,
    });
    expect(parsed.toISOString()).toBe("2025-12-31T23:59:58.000Z");
  });

  it("applies TZ env / timezone option accurately", () => {
    const ref = new Date("2026-11-27T12:00:00Z");
    // Asia/Dubai is UTC+4
    const parsed = parseSyslogTimestamp("Nov", 27, 14, 30, 0, {
      tz: "Asia/Dubai",
      referenceDate: ref,
    });
    expect(parsed.toISOString()).toBe("2026-11-27T10:30:00.000Z");
  });
});

describe("parseLine", () => {
  it("parses standard BSD syslog line with queue ID", () => {
    const line =
      "Nov 27 10:15:02 qa-mail01 postfix/cleanup[1234]: 4F3A21234AB: message-id=<abc@example.com>";
    const parsed = parseLine(line, {
      tz: "UTC",
      referenceDate: new Date("2026-11-27T12:00:00Z"),
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.timestamp).toBe("2026-11-27T10:15:02.000Z");
    expect(parsed?.host).toBe("qa-mail01");
    expect(parsed?.process).toBe("postfix/cleanup");
    expect(parsed?.pid).toBe(1234);
    expect(parsed?.queueId).toBe("4F3A21234AB");
    expect(parsed?.body).toBe("message-id=<abc@example.com>");
  });

  it("parses ISO-8601 journalctl short-iso lines and long queue IDs", () => {
    const line =
      "2026-11-27T10:15:02+0000 qa-mail01 postfix/qmgr[999]: 4XwZ123456z89Ab: from=<a@b.test>, size=512, nrcpt=1 (queue active)";
    const parsed = parseLine(line);
    expect(parsed?.queueId).toBe("4XwZ123456z89Ab");
    expect(parsed?.process).toBe("postfix/qmgr");
    expect(parsed?.timestamp).toBe("2026-11-27T10:15:02.000Z");
  });
});

describe("parsePostfixLogs", () => {
  const ref = new Date("2026-11-27T18:00:00Z");

  it("parses successful delivery with TLS info and keeps raw lines", () => {
    const log = [
      "Nov 27 10:00:01 mail postfix/smtpd[100]: 4F3A21234AB: client=app[10.0.0.1]",
      "Nov 27 10:00:01 mail postfix/cleanup[101]: 4F3A21234AB: message-id=<ok-1@test>",
      "Nov 27 10:00:02 mail postfix/qmgr[102]: 4F3A21234AB: from=<sender@test>, size=2048, nrcpt=1 (queue active)",
      "Nov 27 10:00:02 mail postfix/smtp[103]: Trusted TLS connection established to mx.example.com[198.51.100.5]:25: TLSv1.3 with cipher TLS_AES_256_GCM_SHA384 (256/256 bits)",
      "Nov 27 10:00:03 mail postfix/smtp[103]: 4F3A21234AB: to=<rcpt@example.com>, relay=mx.example.com[198.51.100.5]:25, delay=1.42, delays=0.1/0.02/0.5/0.8, dsn=2.0.0, status=sent (250 2.0.0 OK)",
      "Nov 27 10:00:03 mail postfix/qmgr[102]: 4F3A21234AB: removed",
    ].join("\n");

    const res = parsePostfixLogs(log, { tz: "UTC", referenceDate: ref });
    expect(res.messages).toHaveLength(1);
    const msg = res.byQueueId["4F3A21234AB"];
    expect(msg.status).toBe("delivered");
    expect(msg.from).toBe("sender@test");
    expect(msg.to).toEqual(["rcpt@example.com"]);
    expect(msg.messageId).toBe("ok-1@test");
    expect(msg.size).toBe(2048);
    expect(msg.tlsInfo).toContain("TLSv1.3");
    expect(msg.attempts).toHaveLength(1);
    expect(msg.attempts[0].delay).toBe(1.42);
    expect(msg.attempts[0].dsn).toBe("2.0.0");
    expect(msg.rawLines.length).toBeGreaterThanOrEqual(5);
  });

  it("handles deferred then retried-sent transitions", () => {
    const log = [
      "Nov 27 10:00:00 mail postfix/qmgr[102]: A1B2C3D4E5: from=<a@test>, size=100, nrcpt=1 (queue active)",
      "Nov 27 10:00:30 mail postfix/smtp[103]: A1B2C3D4E5: to=<u@partner.net>, relay=mx.partner.net[203.0.113.1]:25, delay=30.1, delays=0.1/0/30/0, dsn=4.7.1, status=deferred (451 4.7.1 Greylisted)",
    ].join("\n");

    const res1 = parsePostfixLogs(log, { tz: "UTC", referenceDate: ref });
    expect(res1.byQueueId["A1B2C3D4E5"].status).toBe("deferred");

    const logWithRetry =
      log +
      "\nNov 27 10:06:00 mail postfix/smtp[109]: A1B2C3D4E5: to=<u@partner.net>, relay=mx.partner.net[203.0.113.1]:25, delay=360.5, delays=359/0.1/0.4/1.0, dsn=2.0.0, status=sent (250 OK)";
    const res2 = parsePostfixLogs(logWithRetry, { tz: "UTC", referenceDate: ref });
    expect(res2.byQueueId["A1B2C3D4E5"].status).toBe("delivered");
    expect(res2.byQueueId["A1B2C3D4E5"].attempts).toHaveLength(2);
  });

  it("handles multi-recipient bounced and expired messages", () => {
    const log = [
      "Nov 27 11:00:00 mail postfix/qmgr[102]: BBB111222: from=<a@test>, size=500, nrcpt=2 (queue active)",
      "Nov 27 11:00:01 mail postfix/smtp[103]: BBB111222: to=<ok@domain.com>, relay=mx[1.1.1.1]:25, delay=0.5, dsn=2.0.0, status=sent (250 OK)",
      "Nov 27 11:00:02 mail postfix/smtp[103]: BBB111222: to=<bad@domain.com>, relay=mx[1.1.1.1]:25, delay=0.8, dsn=5.1.1, status=bounced (550 5.1.1 User unknown)",
      "Nov 27 11:00:05 mail postfix/qmgr[102]: CCC111222: from=<a@test>, size=500, nrcpt=1 (queue active)",
      "Nov 27 11:00:06 mail postfix/qmgr[102]: CCC111222: to=<old@domain.com>, relay=none, delay=432000, dsn=4.4.7, status=expired (Cannot start TLS, giving up)",
      "Nov 27 11:00:10 mail postfix/qmgr[102]: DDD111222: from=<a@test>, size=500, nrcpt=1 (queue active)",
    ].join("\n");

    const res = parsePostfixLogs(log, { tz: "UTC", referenceDate: ref });
    expect(res.byQueueId["BBB111222"].status).toBe("bounced");
    expect(res.byQueueId["BBB111222"].to).toEqual(["ok@domain.com", "bad@domain.com"]);
    expect(res.byQueueId["CCC111222"].status).toBe("bounced");
    expect(res.byQueueId["CCC111222"].attempts[0].status).toBe("expired");
    expect(res.byQueueId["DDD111222"].status).toBe("in-queue");
  });

  it("parses NOQUEUE rejected events separately with inbound TLS info", () => {
    const log = [
      "Nov 27 12:00:00 mail postfix/smtpd[200]: Anonymous TLS connection established from unknown[185.220.101.42]: TLSv1.2 with cipher ECDHE-RSA-AES128-GCM-SHA256 (128/128 bits)",
      "Nov 27 12:00:01 mail postfix/smtpd[200]: NOQUEUE: reject: RCPT from unknown[185.220.101.42]: 554 5.7.1 Service unavailable; Client host [185.220.101.42] blocked using zen.spamhaus.org; from=<spam@bad.biz> to=<qa@gmail.com> proto=ESMTP helo=<spam.local>",
      "Nov 27 12:01:00 mail postfix/smtpd[201]: NOQUEUE: reject: RCPT from scanner.evil[45.155.205.88]: 554 5.7.1 <ext@target.org>: Relay access denied; from=<a@b.com> to=<ext@target.org> proto=ESMTP helo=<evil>",
    ].join("\n");

    const res = parsePostfixLogs(log, { tz: "UTC", referenceDate: ref });
    expect(res.messages).toHaveLength(2);
    const rbl = res.messages.find((m) => m.rejectReason?.includes("zen.spamhaus.org"));
    expect(rbl?.status).toBe("rejected");
    expect(rbl?.kind).toBe("rejected");
    expect(rbl?.queueId).toMatch(/^NOQUEUE-/);
    expect(rbl?.from).toBe("spam@bad.biz");
    expect(rbl?.to).toEqual(["qa@gmail.com"]);
    expect(rbl?.tlsInfo).toContain("TLSv1.2");
  });
});
