import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLogCache } from "@/lib/postfix/cache";
import { GET as getMessageDetail } from "../messages/[queueId]/route";
import { GET as getMessages } from "../messages/route";
import { GET as getStats } from "../stats/route";
import { GET as getStream } from "../stream/route";

describe("API Route Handlers (sample mode)", () => {
  const prevSource = process.env.MAIL_LOG_SOURCE;

  beforeEach(() => {
    process.env.MAIL_LOG_SOURCE = "sample";
    clearLogCache();
  });

  afterEach(() => {
    process.env.MAIL_LOG_SOURCE = prevSource;
    clearLogCache();
  });

  it("GET /api/stats returns counts, 24h hourly buckets, domains, and reasons", async () => {
    const res = await getStats();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("sample");
    expect(data.counts.total).toBeGreaterThan(20);
    expect(data.counts.delivered).toBeGreaterThan(0);
    expect(data.counts.deferred).toBeGreaterThan(0);
    expect(data.counts.bounced).toBeGreaterThan(0);
    expect(data.counts.rejected).toBeGreaterThan(0);
    expect(data.hourly).toHaveLength(24);
    expect(data.topRecipientDomains.length).toBeGreaterThan(0);
    expect(data.topReasons.length).toBeGreaterThan(0);
  });

  it("GET /api/messages supports filtering, pagination, and newest-first order", async () => {
    const reqAll = new NextRequest("http://localhost:3000/api/messages?page=1&pageSize=5");
    const resAll = await getMessages(reqAll);
    expect(resAll.status).toBe(200);
    const allData = await resAll.json();
    expect(allData.items).toHaveLength(5);
    expect(allData.page).toBe(1);
    expect(allData.pageSize).toBe(5);
    expect(allData.totalPages).toBeGreaterThan(1);
    expect(allData.items[0].lastTimestampMs).toBeGreaterThanOrEqual(
      allData.items[1].lastTimestampMs,
    );

    const reqFiltered = new NextRequest(
      "http://localhost:3000/api/messages?status=rejected&q=spamhaus",
    );
    const resFiltered = await getMessages(reqFiltered);
    expect(resFiltered.status).toBe(200);
    const filteredData = await resFiltered.json();
    expect(filteredData.total).toBeGreaterThan(0);
    expect(filteredData.items.every((m: { status: string }) => m.status === "rejected")).toBe(true);
  });

  it("GET /api/messages/[queueId] returns detail or 404", async () => {
    const reqAll = new NextRequest("http://localhost:3000/api/messages?page=1&pageSize=1");
    const listRes = await getMessages(reqAll);
    const listJson = await listRes.json();
    const firstId = listJson.items[0].queueId as string;

    const detailRes = await getMessageDetail(
      new NextRequest(`http://localhost:3000/api/messages/${encodeURIComponent(firstId)}`),
      { params: Promise.resolve({ queueId: firstId }) },
    );
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();
    expect(detailJson.message.queueId).toBe(firstId);
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
});
