import { describe, expect, it } from "vitest";
import { parsePostfixLogs } from "../parser";
import { queryMessages } from "../query";

const REF_DATE = new Date("2026-11-27T23:59:59Z");

describe("queryMessages", () => {
  const sampleLog = [
    "Nov 26 10:00:00 h postfix/cleanup[1]: 4F3A0000001: message-id=<id-one@qa.example>",
    "Nov 26 10:00:00 h postfix/qmgr[2]: 4F3A0000001: from=<alice@qa.example>, size=100, nrcpt=1",
    "Nov 26 10:00:01 h postfix/smtp[3]: 4F3A0000001: to=<bob@gmail.com>, relay=mx.gmail[1.1.1.1]:25, delay=1.0, delays=0.1/0/0.4/0.5, dsn=2.0.0, status=sent (250 OK)",
    "Nov 27 12:00:00 h postfix/cleanup[1]: 4F3A0000002: message-id=<id-two@qa.example>",
    "Nov 27 12:00:00 h postfix/qmgr[2]: 4F3A0000002: from=<carol@qa.example>, size=200, nrcpt=1",
    "Nov 27 12:00:01 h postfix/smtp[3]: 4F3A0000002: to=<dave@outlook.com>, relay=mx.outlook[2.2.2.2]:25, delay=2.5, delays=0.1/0/1.0/1.4, dsn=4.7.1, status=deferred (451 4.7.1 Greylisted <script>alert(1)</script>)",
    "Nov 27 15:00:00 h postfix/smtpd[4]: NOQUEUE: reject: RCPT from bad[1.2.3.4]: 554 5.7.1 Blocked via RBL; from=<spam@evil.biz> to=<admin@qa.example> proto=ESMTP",
  ].join("\n");

  const parsed = parsePostfixLogs(sampleLog, {
    timezone: "UTC",
    referenceDate: REF_DATE,
  });

  it("filters by from, to, dateFrom, dateTo, and q across messageId and detail", () => {
    expect(queryMessages(parsed.messages, { from: "alice" }).total).toBe(1);
    expect(queryMessages(parsed.messages, { to: "outlook.com" }).total).toBe(1);
    expect(
      queryMessages(parsed.messages, { dateFrom: "2026-11-27", dateTo: "2026-11-27" })
        .total,
    ).toBe(2);
    expect(queryMessages(parsed.messages, { q: "id-one@qa.example" }).total).toBe(1);
    expect(queryMessages(parsed.messages, { q: "Greylisted" }).total).toBe(1);
  });

  it("supports comma-separated status filters and clamps page/pageSize safely", () => {
    const multi = queryMessages(parsed.messages, {
      status: "deferred,rejected",
      page: 99,
      pageSize: 500,
    });
    expect(multi.total).toBe(2);
    expect(multi.pageSize).toBe(100);
    expect(multi.page).toBe(1);
    expect(multi.items.map((i) => i.status)).toEqual(["rejected", "deferred"]);
  });
});
