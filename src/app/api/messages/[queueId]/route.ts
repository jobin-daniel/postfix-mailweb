import { NextRequest, NextResponse } from "next/server";
import { getParsedLogs } from "@/lib/postfix/cache";
import { deleteMessagesByQueueIds, isValidQueueId } from "@/lib/postfix/delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ queueId: string }> },
) {
  try {
    const { queueId } = await context.params;
    const decodedId = decodeURIComponent(queueId);

    if (!isValidQueueId(decodedId)) {
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

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ queueId: string }> },
) {
  try {
    const { queueId } = await context.params;
    const decodedId = decodeURIComponent(queueId);

    if (!isValidQueueId(decodedId)) {
      return NextResponse.json({ error: "Invalid queue ID format" }, { status: 400 });
    }

    const result = await deleteMessagesByQueueIds([decodedId]);
    if (result.deletedQueueIds.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
