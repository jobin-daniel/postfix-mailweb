import { NextRequest, NextResponse } from "next/server";
import { filterAndPaginateMessages, getParsedLogs } from "@/lib/postfix/cache";
import { deleteMessagesByQueueIds, isValidQueueId } from "@/lib/postfix/delete";

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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const rawQueueIds = body && typeof body === "object" ? (body as { queueIds?: unknown }).queueIds : null;

    if (!Array.isArray(rawQueueIds) || rawQueueIds.length === 0) {
      return NextResponse.json(
        { error: "Request body must include a non-empty queueIds array" },
        { status: 400 },
      );
    }

    const queueIds: string[] = [];
    for (const item of rawQueueIds) {
      if (typeof item !== "string" || !isValidQueueId(item.trim())) {
        return NextResponse.json(
          { error: `Invalid queue ID format: ${String(item)}` },
          { status: 400 },
        );
      }
      queueIds.push(item.trim());
    }

    const result = await deleteMessagesByQueueIds(queueIds);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
