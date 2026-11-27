import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getAppConfig();
  return NextResponse.json({
    status: "ok",
    source: config.logSource,
    timestamp: new Date().toISOString(),
  });
}
