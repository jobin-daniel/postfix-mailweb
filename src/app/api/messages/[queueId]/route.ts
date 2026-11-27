import { NextRequest, NextResponse } from "next/server";
import { getParsedLogs } from "@/lib/postfix/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ queueId: string }> },
) {
  try {
    const { queueId } = await context.params;
    const decodedId = decodeURIComponent(queueId);

    if (!/^[0-9A-Za-z_-]{4,32}$/.test(decodedId)) {
      return NextResponse.json({ error: "Invalid queue ID format" }, { status: 400 });
    }

    const snapshot = await getParsedLogs();
    const message = snapshot.result.byQueueId[decodedId];

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({
      message,
      source: snapshot.source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load message detail";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
