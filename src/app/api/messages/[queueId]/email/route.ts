import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { findAttachmentInArchive, findEmailInArchive } from "@/lib/mail/archive";
import { getParsedLogs } from "@/lib/postfix/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n/]/g, "_").trim() || "attachment";
}

export async function GET(
  request: NextRequest,
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

    const { archiveDir } = getAppConfig();
    const resolvedArchiveDir = archiveDir ?? null;
    const attachmentParam = request.nextUrl.searchParams.get("attachment");

    if (attachmentParam !== null) {
      const partIndex = Number.parseInt(attachmentParam, 10);
      if (!Number.isFinite(partIndex) || partIndex < 0) {
        return NextResponse.json({ error: "Invalid attachment index" }, { status: 400 });
      }
      const attachment = await findAttachmentInArchive(
        resolvedArchiveDir,
        message.messageId,
        partIndex,
      );
      if (!attachment) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(attachment.content), {
        status: 200,
        headers: {
          "Content-Type": attachment.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(attachment.filename)}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    const lookup = await findEmailInArchive(resolvedArchiveDir, message.messageId);
    if (lookup.status === "not_configured") {
      return NextResponse.json({ available: false, reason: "not_configured" });
    }
    if (lookup.status === "not_found") {
      return NextResponse.json({ available: false, reason: "not_found" });
    }

    return NextResponse.json({
      available: true,
      email: lookup.email,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load email body";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
