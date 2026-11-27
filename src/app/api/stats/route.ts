import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { getParsedLogs } from "@/lib/postfix/cache";
import { computeMailStats } from "@/lib/postfix/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getAppConfig();
    const snapshot = await getParsedLogs();
    const stats = computeMailStats(snapshot.result.messages, {
      timezone: config.timezone,
      logSource: config.logSource,
    });

    return NextResponse.json({
      ...stats,
      source: snapshot.source,
      filesRead: snapshot.filesRead.length,
      cacheHit: snapshot.cacheHit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute mail stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
