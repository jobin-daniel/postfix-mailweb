import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearArchiveCache,
  deleteEmailsFromArchive,
  findAttachmentInArchive,
  findEmailInArchive,
} from "../archive";
import { decodeMimeWords, parseRawEmail, sanitizeEmailHtml } from "../mime";

const SAMPLE_MULTIPART_EML = [
  "From: =?UTF-8?B?Sm9obiBEb2U=?= <john@example.com>",
  "To: Alice <alice@example.org>, bob@example.net",
  "Subject: =?UTF-8?Q?Quarterly_Report_=E2=80=94_Q4?=",
  "Date: Fri, 28 Nov 2026 09:30:00 +0000",
  "Message-ID: <abc-123@mail.example.com>",
  'Content-Type: multipart/mixed; boundary="outer-bound"',
  "",
  "--outer-bound",
  'Content-Type: multipart/alternative; boundary="inner-bound"',
  "",
  "--inner-bound",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Hello Alice,=0AHere is the quarterly=20report.",
  "--inner-bound",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(
    '<html><body><h1>Report</h1><p>Hello <b>Alice</b></p><script>alert(1)</script><a href="javascript:evil()">click</a></body></html>',
    "utf8",
  ).toString("base64"),
  "--inner-bound--",
  "--outer-bound",
  'Content-Type: application/pdf; name="report.pdf"',
  'Content-Disposition: attachment; filename="report.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 fake pdf bytes", "utf8").toString("base64"),
  "--outer-bound--",
  "",
].join("\r\n");

describe("MIME parser", () => {
  it("decodes RFC 2047 headers, multipart text/html, attachments, and sanitizes HTML", () => {
    const parsed = parseRawEmail(Buffer.from(SAMPLE_MULTIPART_EML, "utf8"));

    expect(parsed.messageId).toBe("abc-123@mail.example.com");
    expect(parsed.subject).toBe("Quarterly Report — Q4");
    expect(parsed.from).toEqual([{ name: "John Doe", address: "john@example.com" }]);
    expect(parsed.to).toEqual([
      { name: "Alice", address: "alice@example.org" },
      { name: null, address: "bob@example.net" },
    ]);
    expect(parsed.text).toContain("Hello Alice,\nHere is the quarterly report.");
    expect(parsed.html).toContain("<h1>Report</h1>");
    expect(parsed.sanitizedHtml).toContain("<h1>Report</h1>");
    expect(parsed.sanitizedHtml).not.toContain("<script>");
    expect(parsed.sanitizedHtml).not.toContain("javascript:");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      filename: "report.pdf",
      contentType: "application/pdf",
      partIndex: 0,
    });
  });

  it("decodes adjacent RFC 2047 words and strips dangerous event handlers", () => {
    expect(decodeMimeWords("=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?=")).toBe("HelloWorld");
    const safe = sanitizeEmailHtml('<img src="x" onerror="alert(1)" />');
    expect(safe).not.toContain("onerror");
  });
});

describe("Maildir archive lookup", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mail-archive-test-"));
    await fs.mkdir(path.join(tempDir, "cur"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "new"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "cur", "1732786200.M123P1.mail:2,S"),
      SAMPLE_MULTIPART_EML,
      "utf8",
    );
    clearArchiveCache();
  });

  afterEach(async () => {
    clearArchiveCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("finds archived email and attachment by Message-ID", async () => {
    const notConfigured = await findEmailInArchive(null, "abc-123@mail.example.com");
    expect(notConfigured.status).toBe("not_configured");

    const found = await findEmailInArchive(tempDir, "<abc-123@mail.example.com>");
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.email.subject).toBe("Quarterly Report — Q4");
    }

    const att = await findAttachmentInArchive(tempDir, "abc-123@mail.example.com", 0);
    expect(att?.filename).toBe("report.pdf");
    expect(att?.content.toString("utf8")).toBe("%PDF-1.4 fake pdf bytes");

    const missing = await findEmailInArchive(tempDir, "missing@example.com");
    expect(missing.status).toBe("not_found");
  });

  it("physically deletes archived email files by Message-ID", async () => {
    const filePath = path.join(tempDir, "cur", "1732786200.M123P1.mail:2,S");
    const result = await deleteEmailsFromArchive(tempDir, ["<abc-123@mail.example.com>"]);
    expect(result.errors).toEqual([]);
    expect(result.deletedFiles).toHaveLength(1);
    await expect(fs.stat(filePath)).rejects.toThrow();

    const afterDelete = await findEmailInArchive(tempDir, "abc-123@mail.example.com");
    expect(afterDelete.status).toBe("not_found");
  });
});
