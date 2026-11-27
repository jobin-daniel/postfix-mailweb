import { NextRequest, NextResponse } from "next/server";
import { filterAndPaginateMessages, getParsedLogs } from "@/lib/postfix/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const pageRaw = Number.parseInt(sp.get("page") ?? "1", 10);
    const pageSizeRaw = Number.parseInt(sp.get("pageSize") ?? "25", 10);

    const snapshot = await getParsedLogs();
    const paginated = filterAndPaginateMessages(snapshot.result.messages, {
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      dateFrom: sp.get("dateFrom") ?? undefined,
      dateTo: sp.get("dateTo") ?? undefined,
      page: Number.isFinite(pageRaw) ? pageRaw : 1,
      pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25,
    });

    return NextResponse.json({
      ...paginated,
      source: snapshot.source,
      cacheHit: snapshot.cacheHit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load mail logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
